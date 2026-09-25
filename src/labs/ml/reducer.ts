import type { NodeState } from "@/types/execution";
import type { AnyMLEvent, MLEventType, MLLabEvent } from "./events";
import { ML_NODE_ORDER } from "./layout";
import type { TreeNode, TreeSplitStep } from "@shared/ml";
import type { MLStageId } from "./stages";
import type { MLTimelineEntry, MLVisualState } from "./state";

/**
 * Pure reducer: applies one execution event to the visual state. No timers, no
 * side effects. Replaying the same log always draws the same run.
 */
export function applyMLEvent(state: MLVisualState, event: AnyMLEvent): MLVisualState {
  let next: MLVisualState = {
    ...state,
    nodes: { ...state.nodes },
    nodeSources: { ...state.nodeSources },
    pulses: { ...state.pulses },
    appliedEvents: state.appliedEvents + 1,
    lastEvent: event,
  };
  next = applyGenericTransition(next, event);
  const handler = HANDLERS[event.type] as (s: MLVisualState, e: AnyMLEvent) => MLVisualState;
  return handler(next, event);
}

type Handlers = { [K in MLEventType]: (s: MLVisualState, event: MLLabEvent<K>) => MLVisualState };

const HANDLERS: Handlers = {
  RUN_STARTED: (s, { data: d }) => ({ ...s, config: d.config }),
  DATASET_LOADED: (s, { data: d }) => ({ ...s, dataset: d.dataset }),
  INSPECTED: (s, { data: d }) => ({ ...s, inspection: { columns: d.columns, targetCorrelations: d.targetCorrelations } }),
  IDENTIFIED: (s, { data: d }) => ({ ...s, identified: d }),
  CLEANED: (s, { data: d }) => ({ ...s, cleaned: d }),
  IMPUTED: (s, { data: d }) => ({ ...s, imputed: d }),
  ENCODED: (s, { data: d }) => ({ ...s, encoded: d }),
  SCALED: (s, { data: d }) => ({ ...s, scaled: d }),
  ENGINEERED: (s, { data: d }) => ({ ...s, engineered: d }),
  SPLIT: (s, { data: d }) => ({ ...s, split: d }),
  MODEL_SELECTED: (s, { data: d }) => {
    const skipped = d.skippedStages as MLStageId[];
    return { ...s, model: { algorithm: d.algorithm, task: d.task, hyperparameters: d.hyperparameters, family: d.family }, skipped, skipReason: d.skipReason };
  },
  MODEL_INITIALIZED: (s, { data: d }) => ({ ...s, init: d, params: d.params.count ? d.params : s.params }),
  FORWARD: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "forward" }),
  LOSS: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "loss", lossTrace: appendLoss(s.lossTrace, d.step) }),
  GRADIENT: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "gradient", gradient: d.step.gradient }),
  BACKPROP: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "backprop" }),
  UPDATE: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "update", params: d.step.update.params }),
  ITERATE: (s, { data: d }) => ({ ...s, step: d.step, stepPhase: "iterate", stepsSeen: s.stepsSeen + 1, stride: d.stride }),
  TREE_SPLIT: (s, { data: d }) => ({ ...s, treeSplits: [...s.treeSplits, d.step], stepsSeen: s.stepsSeen + 1, tree: d.step.treeIndex === 0 ? growTree(s.tree, d.step) : s.tree }),
  TREE_BUILT: (s, { data: d }) => ({ ...s, trees: [...s.trees, { treeIndex: d.treeIndex, nodes: d.nodes, depth: d.depth, leaves: d.leaves, oobScore: d.oobScore, ms: d.ms }], tree: d.tree ?? s.tree }),
  KNN_INDEXED: (s, { data: d }) => ({ ...s, knn: { stored: d.stored, features: d.features, k: d.k, queries: [] } }),
  KNN_QUERY: (s, { data: d }) => ({ ...s, knn: s.knn ? { ...s.knn, queries: [...s.knn.queries, d.step].slice(-60) } : s.knn, stepsSeen: s.stepsSeen + 1 }),
  NB_CLASS_FITTED: (s, { data: d }) => ({ ...s, naiveBayes: [...s.naiveBayes, d.step], stepsSeen: s.stepsSeen + 1 }),
  EPOCH_COMPLETED: (s, { data: d }) => ({ ...s, epochs: [...s.epochs, d.report] }),
  VALIDATED: (s, { data: d }) => ({ ...s, validation: d }),
  CANDIDATE_STARTED: (s, { data: d }) => ({ ...s, candidateRunning: d.candidate }),
  CANDIDATE_FINISHED: (s, { data: d }) => ({ ...s, candidates: [...s.candidates, d.result], candidateRunning: undefined }),
  HYPERPARAMETERS_EVALUATED: (s, { data: d }) => ({ ...s, sweep: d, candidates: d.candidates }),
  BEST_SELECTED: (s, { data: d }) => ({ ...s, best: d }),
  TESTED: (s, { data: d }) => ({ ...s, test: d }),
  EVALUATED: (s, { data: d }) => ({ ...s, evaluation: d }),
  MODEL_SAVED: (s, { data: d }) => ({ ...s, saved: d, params: d.params.count ? d.params : s.params, tree: d.tree ?? s.tree }),
  RUN_COMPLETED: (s, { data: d }) => ({ ...s, completion: d }),
  INFERRED: (s, { data: d }) => ({ ...s, inference: { input: d.input, trace: d.trace } }),
  PREDICTED: (s, { data: d }) => ({ ...s, inference: s.inference ? { ...s.inference, trace: d.trace } : { input: {}, trace: d.trace } }),
  NOTICE: (s, event) => ({ ...s, notices: [...s.notices, { level: event.data.level, message: event.data.message, at: event.timestamp }] }),
  EXECUTION_ERROR: (s, { data: d }) => ({ ...s, error: { message: d.message } }),
  EXECUTION_STOPPED: (s) => ({ ...s, stopped: true }),
};

/**
 * The tree as it stands after one more split, so the viewer can watch it grow.
 * A split fills in its node and adds two child placeholders; a leaf fills in
 * its value. Nodes are kept sorted by id so the layout is stable.
 */
function growTree(tree: TreeNode[] | undefined, step: TreeSplitStep): TreeNode[] {
  const nodes = new Map<number, TreeNode>((tree ?? []).map((n) => [n.id, n]));
  const existing = nodes.get(step.nodeId);
  const node: TreeNode = { ...(existing ?? { id: step.nodeId, depth: step.depth, samples: step.samples }), impurity: step.impurityBefore, samples: step.samples, depth: step.depth };
  if (step.chosen) {
    node.feature = step.chosen.feature;
    node.threshold = step.chosen.threshold;
    node.left = step.chosen.leftId;
    node.right = step.chosen.rightId;
    if (!nodes.has(step.chosen.leftId)) nodes.set(step.chosen.leftId, { id: step.chosen.leftId, depth: step.depth + 1, samples: step.chosen.left, impurity: step.chosen.impurityAfter });
    if (!nodes.has(step.chosen.rightId)) nodes.set(step.chosen.rightId, { id: step.chosen.rightId, depth: step.depth + 1, samples: step.chosen.right, impurity: step.chosen.impurityAfter });
  } else if (step.leaf) {
    node.value = step.leaf.value;
    node.classCounts = step.leaf.classCounts;
  }
  nodes.set(node.id, node);
  return [...nodes.values()].sort((a, b) => a.id - b.id);
}

function appendLoss(trace: MLVisualState["lossTrace"], step: { iteration: number; loss: { value: number } }): MLVisualState["lossTrace"] {
  const next = [...trace, { iteration: step.iteration, loss: step.loss.value }];
  return next.length > 600 ? next.slice(next.length - 600) : next;
}

/** Node state and timeline bookkeeping shared by every event type. */
function applyGenericTransition(state: MLVisualState, event: AnyMLEvent): MLVisualState {
  const stage = event.stage;
  const nodes = state.nodes;
  const timeline = [...state.timeline];

  if (event.status !== "info") {
    if (event.status === "started" || event.status === "progress") {
      const idx = ML_NODE_ORDER.indexOf(stage);
      for (let i = 0; i < idx; i++) {
        const id = ML_NODE_ORDER[i]!;
        if (nodes[id] === "idle" && !state.skipped.includes(id)) nodes[id] = "queued";
      }
    }
    nodes[stage] = nodeStateFor(event.status, nodes[stage]);
    state.nodeSources[stage] = event.source;
    if (event.status === "completed") state.pulses[stage] += 1;
  }
  if (event.status === "error") nodes[stage] = "error";

  if (event.status !== "info") {
    let openIdx = -1;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const t = timeline[i]!;
      if (t.stage === stage) {
        if (t.status !== "completed" && t.status !== "error") openIdx = i;
        break;
      }
    }
    const open = openIdx >= 0 ? timeline[openIdx] : undefined;
    // The training loop revisits its stages hundreds of times; each pass is its own
    // completed row, but consecutive rows for the same stage fold into one with a count.
    // Only a non-loop row (an epoch summary, a validation) ends a fold, so the six
    // stages of a thousand iterations stay six rows.
    let foldIdx = -1;
    if (!open && isLoopStage(stage) && event.status === "completed") {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const t = timeline[i]!;
        if (t.stage === stage) {
          foldIdx = i;
          break;
        }
        if (!isLoopStage(t.stage)) break;
      }
    }
    if (open) {
      timeline[openIdx] = { ...open, status: event.status, source: event.source, count: open.count + 1, endedAt: event.status === "completed" || event.status === "error" ? event.timestamp : open.endedAt, label: event.status === "completed" ? event.label : open.label };
    } else if (foldIdx >= 0) {
      const fold = timeline[foldIdx]!;
      timeline[foldIdx] = { ...fold, count: fold.count + 1, label: event.label, endedAt: event.timestamp, source: event.source };
    } else {
      const entry: MLTimelineEntry = { id: event.id, stage, label: event.label, status: event.status, source: event.source, startedAt: event.timestamp, endedAt: event.status === "completed" || event.status === "error" ? event.timestamp : undefined, count: 1 };
      timeline.push(entry);
      if (timeline.length > 900) timeline.splice(0, timeline.length - 900);
    }
  }
  return { ...state, nodes, timeline, currentStage: event.status === "info" ? state.currentStage : stage };
}

function isLoopStage(stage: MLStageId): boolean {
  return stage === "forward" || stage === "loss" || stage === "gradient" || stage === "backprop" || stage === "update" || stage === "iterate";
}

function nodeStateFor(status: AnyMLEvent["status"], current: NodeState): NodeState {
  switch (status) {
    case "started":
      return "active";
    case "progress":
      return "processing";
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return current;
  }
}
