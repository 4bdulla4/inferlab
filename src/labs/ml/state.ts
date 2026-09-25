import type { DataSource } from "@shared/llm";
import type {
  Algorithm,
  CandidateResult,
  ColumnSummary,
  DatasetSummary,
  DecisionSurface,
  EncodeReport,
  EpochReport,
  FeatureImportance,
  Hyperparameters,
  ImputeReport,
  KnnQueryStep,
  Metrics,
  MLConfig,
  MLTask,
  NaiveBayesStep,
  NetworkArchitecture,
  ParamSnapshot,
  PredictionTrace,
  ScaleReport,
  SplitReport,
  TrainStep,
  TreeNode,
  TreeSplitStep,
} from "@shared/ml";
import type { EventStatus, NodeState, PlaybackState, RunStatus } from "@/types/execution";
import type { AnyMLEvent } from "./events";
import { ML_STAGE_IDS, ML_STAGES, type MLStageId } from "./stages";

export interface MLTimelineEntry {
  id: string;
  stage: MLStageId;
  label: string;
  status: EventStatus;
  source: DataSource;
  startedAt: number;
  endedAt?: number;
  count: number;
}

/** Everything the visualizer draws for one run, rebuilt purely from applied events. */
export interface MLVisualState {
  nodes: Record<MLStageId, NodeState>;
  nodeSources: Record<MLStageId, DataSource>;
  pulses: Record<MLStageId, number>;
  /** Stages this algorithm never visits, drawn dimmed with the reason. */
  skipped: MLStageId[];
  skipReason: string | null;
  currentStage: MLStageId | null;

  config?: MLConfig;
  dataset?: DatasetSummary;
  inspection?: { columns: ColumnSummary[]; targetCorrelations: { feature: string; correlation: number }[] | null };
  identified?: { features: string[]; target: string; task: MLTask; classes: string[] | null; reason: string };
  cleaned?: { rowsBefore: number; rowsAfter: number; droppedRows: { emptyTarget: number; duplicates: number }; droppedColumns: { name: string; reason: string }[] };
  imputed?: { reports: ImputeReport[]; rowsDropped: number };
  encoded?: { reports: EncodeReport[]; featureNames: string[]; targetEncoding: { method: "label" | "numeric"; classes?: string[] } };
  scaled?: { reports: ScaleReport[] };
  engineered?: { added: string[]; method: string; featureNames: string[] };
  split?: { report: SplitReport; subsampled: { from: number; to: number } | null };

  model?: { algorithm: Algorithm; task: MLTask; hyperparameters: Hyperparameters; family: "gradient" | "tree" | "instance" | "probabilistic" };
  init?: { params: ParamSnapshot; architecture: NetworkArchitecture | null; seed: number; note: string };
  /** The step currently being drawn, and the sub-stage it has reached. */
  step?: TrainStep;
  stepPhase?: "forward" | "loss" | "gradient" | "backprop" | "update" | "iterate";
  stepsSeen: number;
  stride: number;
  /** Loss per drawn step, for the live curve. */
  lossTrace: { iteration: number; loss: number }[];
  /** Latest parameter snapshot (the model's weights right now). */
  params?: ParamSnapshot;
  gradient?: TrainStep["gradient"];
  epochs: EpochReport[];
  treeSplits: TreeSplitStep[];
  trees: { treeIndex: number; nodes: number; depth: number; leaves: number; oobScore: number | null; ms: number }[];
  tree?: TreeNode[];
  knn?: { stored: number; features: number; k: number; queries: KnnQueryStep[] };
  naiveBayes: NaiveBayesStep[];

  validation?: { metrics: Metrics; predictionsSample: { index: number; predicted: number; target: number; probabilities?: number[] }[] };
  candidates: CandidateResult[];
  candidateRunning?: { index: number; parameter: string; value: number };
  sweep?: { candidates: CandidateResult[]; checkpoints: { epoch: number; validationMetric: number }[] | null; metricName: string; higherIsBetter: boolean };
  best?: { choice: string; reason: string; retrained: boolean };
  test?: { metrics: Metrics; predictions: { index: number; predicted: number; target: number; probabilities?: number[] }[] };
  evaluation?: { importance: FeatureImportance | null; surface: DecisionSurface | null; lossCurve: { epoch: number; train: number; validation: number | null }[] };
  saved?: { modelId: string; bytes: number; params: ParamSnapshot; tree: TreeNode[] | null; forest: { trees: number; nodes: number } | null; architecture: NetworkArchitecture | null };
  completion?: { totalMs: number; iterations: number; epochs: number };
  inference?: { input: Record<string, string | number | boolean | null>; trace: PredictionTrace };

  notices: { level: "info" | "warn"; message: string; at: number }[];
  error?: { message: string };
  stopped: boolean;
  timeline: MLTimelineEntry[];
  appliedEvents: number;
  lastEvent?: AnyMLEvent;
}

export interface MLRunState {
  id: string;
  serverRunId: string | null;
  datasetId: string;
  datasetName: string;
  config: MLConfig;
  label: string;
  createdAt: number;
  status: RunStatus;
  liveDone: boolean;
  log: AnyMLEvent[];
  cursor: number;
  visual: MLVisualState;
  playback: PlaybackState;
  comparisonLabel?: string;
}

function record<T>(value: T): Record<MLStageId, T> {
  return Object.fromEntries(ML_STAGE_IDS.map((id) => [id, value])) as Record<MLStageId, T>;
}

export function createMLVisualState(): MLVisualState {
  const sources = record<DataSource>("live");
  for (const id of ML_STAGE_IDS) sources[id] = ML_STAGES[id].defaultSource;
  return {
    nodes: record<NodeState>("idle"),
    nodeSources: sources,
    pulses: record<number>(0),
    skipped: [],
    skipReason: null,
    currentStage: null,
    stepsSeen: 0,
    stride: 1,
    lossTrace: [],
    epochs: [],
    treeSplits: [],
    trees: [],
    naiveBayes: [],
    candidates: [],
    notices: [],
    stopped: false,
    timeline: [],
    appliedEvents: 0,
  };
}

export function createMLRun(params: { id: string; datasetId: string; datasetName: string; config: MLConfig; label: string; comparisonLabel?: string }): MLRunState {
  return {
    id: params.id,
    serverRunId: null,
    datasetId: params.datasetId,
    datasetName: params.datasetName,
    config: params.config,
    label: params.label,
    createdAt: Date.now(),
    status: "running",
    liveDone: false,
    log: [],
    cursor: 0,
    visual: createMLVisualState(),
    playback: "paused",
    comparisonLabel: params.comparisonLabel,
  };
}
