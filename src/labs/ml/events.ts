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
import type { ExecutionEvent } from "@/types/execution";
import type { MLStageId } from "./stages";

/**
 * The ML lab's execution vocabulary. The training loop turns each server
 * `train_step` into a forward → loss → gradient → backprop → update → iterate
 * run of events so the loop is watched one computation at a time.
 */
export interface MLEventDataMap {
  RUN_STARTED: { config: MLConfig; dataset: { id: string; name: string; rows: number; columns: number } };
  DATASET_LOADED: { dataset: DatasetSummary; ms: number };
  INSPECTED: { columns: ColumnSummary[]; targetCorrelations: { feature: string; correlation: number }[] | null };
  IDENTIFIED: { features: string[]; target: string; task: MLTask; classes: string[] | null; reason: string };
  CLEANED: { rowsBefore: number; rowsAfter: number; droppedRows: { emptyTarget: number; duplicates: number }; droppedColumns: { name: string; reason: string }[] };
  IMPUTED: { reports: ImputeReport[]; rowsDropped: number };
  ENCODED: { reports: EncodeReport[]; featureNames: string[]; targetEncoding: { method: "label" | "numeric"; classes?: string[] } };
  SCALED: { reports: ScaleReport[] };
  ENGINEERED: { added: string[]; method: string; featureNames: string[] };
  SPLIT: { report: SplitReport; subsampled: { from: number; to: number } | null };
  MODEL_SELECTED: { algorithm: Algorithm; task: MLTask; hyperparameters: Hyperparameters; family: "gradient" | "tree" | "instance" | "probabilistic"; skippedStages: string[]; skipReason: string | null };
  MODEL_INITIALIZED: { params: ParamSnapshot; architecture: NetworkArchitecture | null; seed: number; note: string };
  FORWARD: { step: TrainStep };
  LOSS: { step: TrainStep };
  GRADIENT: { step: TrainStep };
  BACKPROP: { step: TrainStep };
  UPDATE: { step: TrainStep };
  ITERATE: { step: TrainStep; detailed: boolean; stride: number };
  TREE_SPLIT: { step: TreeSplitStep };
  TREE_BUILT: { treeIndex: number; nodes: number; depth: number; leaves: number; oobScore: number | null; ms: number; tree: TreeNode[] | null };
  KNN_INDEXED: { stored: number; features: number; k: number };
  KNN_QUERY: { step: KnnQueryStep; detailed: boolean };
  NB_CLASS_FITTED: { step: NaiveBayesStep };
  EPOCH_COMPLETED: { report: EpochReport };
  VALIDATED: { metrics: Metrics; predictionsSample: { index: number; predicted: number; target: number; probabilities?: number[] }[] };
  CANDIDATE_STARTED: { candidate: { index: number; parameter: string; value: number } };
  CANDIDATE_FINISHED: { result: CandidateResult };
  HYPERPARAMETERS_EVALUATED: { candidates: CandidateResult[]; checkpoints: { epoch: number; validationMetric: number }[] | null; metricName: string; higherIsBetter: boolean };
  BEST_SELECTED: { choice: string; reason: string; retrained: boolean };
  TESTED: { metrics: Metrics; predictions: { index: number; predicted: number; target: number; probabilities?: number[] }[] };
  EVALUATED: { importance: FeatureImportance | null; surface: DecisionSurface | null; lossCurve: { epoch: number; train: number; validation: number | null }[] };
  MODEL_SAVED: { modelId: string; bytes: number; params: ParamSnapshot; tree: TreeNode[] | null; forest: { trees: number; nodes: number } | null; architecture: NetworkArchitecture | null };
  RUN_COMPLETED: { totalMs: number; iterations: number; epochs: number };
  INFERRED: { input: Record<string, string | number | boolean | null>; trace: PredictionTrace };
  PREDICTED: { trace: PredictionTrace };
  NOTICE: { level: "info" | "warn"; message: string };
  EXECUTION_ERROR: { message: string; retryable: boolean };
  EXECUTION_STOPPED: Record<string, never>;
}

export type MLEventType = keyof MLEventDataMap;

export type MLLabEvent<T extends MLEventType = MLEventType> = Omit<ExecutionEvent<T, MLStageId, MLEventDataMap[T]>, "data"> & { data: MLEventDataMap[T] };

export type AnyMLEvent = { [K in MLEventType]: MLLabEvent<K> }[MLEventType];
