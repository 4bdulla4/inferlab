/**
 * Shared contract for the ML Engineering lab: how a dataset is described, how a
 * training run is configured, what the server can honestly report about every
 * step, and what the browser may treat as REAL COMPUTATION.
 *
 * `DataSource` on a value means:
 *   - "live"        → a number the server actually computed: a parsed row, a
 *                     fitted parameter, a loss, a gradient, a metric, a prediction
 *   - "simulation"  → a simplified picture: a decision boundary drawn on a 2-D
 *                     slice of a higher-dimensional space, or a layout chosen
 *                     for legibility rather than derived from the data
 */
import type { DataSource } from "./llm";

export type { DataSource };

/* ─────────────────────────────── dataset ────────────────────────────── */

export type ColumnType = "numeric" | "categorical" | "boolean" | "text" | "id" | "constant";

export interface ColumnSummary {
  name: string;
  type: ColumnType;
  missing: number;
  unique: number;
  /** Numeric columns. */
  stats?: { min: number; max: number; mean: number; std: number; median: number };
  /** Histogram of a numeric column (fixed bins) or counts of the top categories. */
  histogram?: { bins: { from: number; to: number; count: number }[] } | { categories: { value: string; count: number }[] };
  examples: string[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  /** "sample" datasets ship with the lab; "upload" came from the person. */
  origin: "sample" | "upload";
  /** Only sample datasets that were generated rather than collected carry this. */
  synthetic?: boolean;
  format: "csv" | "json";
  rows: number;
  columns: ColumnSummary[];
  /** The first rows, as strings, for the table. */
  sampleRows: string[][];
  bytes: number;
  addedAt: number;
  note: string;
}

export interface SampleDatasetInfo {
  id: string;
  name: string;
  description: string;
  task: MLTask;
  rows: number;
  synthetic: boolean;
  suggestedTarget: string;
}

/* ─────────────────────────────── config ─────────────────────────────── */

export type MLTask = "classification" | "regression";

export type Algorithm = "linear_regression" | "logistic_regression" | "decision_tree" | "random_forest" | "knn" | "svm" | "naive_bayes" | "neural_network";

export type Optimizer = "sgd" | "momentum" | "adam";
export type Activation = "relu" | "tanh" | "sigmoid";
export type ScalingMethod = "standard" | "minmax" | "none";
export type ImputeStrategy = "median" | "mean" | "mode" | "drop";
export type Regularization = "none" | "l2" | "l1";

export interface Hyperparameters {
  learningRate: number;
  epochs: number;
  batchSize: number;
  optimizer: Optimizer;
  regularization: Regularization;
  regularizationStrength: number;
  /** Neural network hidden layer widths, e.g. [16, 8]. */
  hiddenLayers: number[];
  activation: Activation;
  /** Trees and forests. */
  maxDepth: number;
  minSamplesLeaf: number;
  /** Random forest. */
  trees: number;
  /** KNN. */
  k: number;
  /** SVM margin penalty (C). */
  svmC: number;
}

export interface MLConfig {
  algorithm: Algorithm;
  /** Column to predict; null lets the lab pick the last non-id column. */
  target: string | null;
  /** Columns to exclude from the features. */
  excluded: string[];
  impute: ImputeStrategy;
  scaling: ScalingMethod;
  /** Add squares of numeric features and pairwise products of the first few. */
  polynomialFeatures: boolean;
  /** Fractions of the whole; test = 1 - train - validation. */
  trainFraction: number;
  validationFraction: number;
  stratify: boolean;
  seed: number;
  hyperparameters: Hyperparameters;
  /** Optional sweep over one hyperparameter; each candidate is trained for real. */
  sweep: { parameter: keyof Hyperparameters; values: number[] } | null;
}

export const DEFAULT_HYPERPARAMETERS: Hyperparameters = {
  learningRate: 0.05,
  epochs: 30,
  batchSize: 16,
  optimizer: "adam",
  regularization: "none",
  regularizationStrength: 0.001,
  hiddenLayers: [8],
  activation: "relu",
  maxDepth: 4,
  minSamplesLeaf: 2,
  trees: 12,
  k: 5,
  svmC: 1,
};

export const DEFAULT_ML_CONFIG: MLConfig = {
  algorithm: "logistic_regression",
  target: null,
  excluded: [],
  impute: "median",
  scaling: "standard",
  polynomialFeatures: false,
  trainFraction: 0.7,
  validationFraction: 0.15,
  stratify: true,
  seed: 42,
  hyperparameters: { ...DEFAULT_HYPERPARAMETERS },
  sweep: null,
};

export const ML_LIMITS = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxRows: 20_000,
  /** Rows above this are subsampled for training, with a notice. */
  maxTrainRows: 4000,
  maxColumns: 64,
  maxEpochs: 200,
  maxHiddenLayers: 4,
  maxHiddenWidth: 64,
  maxTrees: 60,
  maxDepth: 12,
  maxSweepValues: 4,
  /**
   * How many passes of the training loop are DRAWN. Every step is still
   * computed; beyond this budget the server strides, emitting every nth step
   * with a notice. Kept small because the loop is watched, not skimmed: a
   * budget a person cannot sit through forces the player to rush, which makes
   * the speed control meaningless.
   */
  maxDetailedSteps: 48,
};

export const ALGORITHMS: { id: Algorithm; name: string; tasks: MLTask[]; family: "gradient" | "tree" | "instance" | "probabilistic"; blurb: string }[] = [
  { id: "linear_regression", name: "Linear Regression", tasks: ["regression"], family: "gradient", blurb: "A weighted sum of the features, fitted by gradient descent on squared error." },
  { id: "logistic_regression", name: "Logistic Regression", tasks: ["classification"], family: "gradient", blurb: "A weighted sum squashed into probabilities, fitted by gradient descent on cross-entropy." },
  { id: "decision_tree", name: "Decision Tree", tasks: ["classification", "regression"], family: "tree", blurb: "Yes/no questions on one feature at a time, chosen greedily to purify the groups." },
  { id: "random_forest", name: "Random Forest", tasks: ["classification", "regression"], family: "tree", blurb: "Many trees on bootstrapped rows and random feature subsets; they vote." },
  { id: "knn", name: "K-Nearest Neighbours", tasks: ["classification", "regression"], family: "instance", blurb: "No training to speak of: a prediction is the vote or average of the K closest training rows." },
  { id: "svm", name: "Support Vector Machine", tasks: ["classification"], family: "gradient", blurb: "A linear boundary pushed to leave the widest margin, fitted by sub-gradient descent on hinge loss." },
  { id: "naive_bayes", name: "Naive Bayes", tasks: ["classification"], family: "probabilistic", blurb: "Per-class Gaussian statistics for every feature, combined as if the features were independent." },
  { id: "neural_network", name: "Neural Network", tasks: ["classification", "regression"], family: "gradient", blurb: "Layers of weighted sums and non-linearities, trained by backpropagation." },
];

/* ─────────────────────────── pipeline facts ─────────────────────────── */

export interface ImputeReport {
  column: string;
  strategy: ImputeStrategy;
  filled: number;
  /** The value written into the gaps, for numeric columns. */
  value?: number | string;
}

export interface EncodeReport {
  column: string;
  method: "one-hot" | "label" | "boolean" | "passthrough";
  categories?: string[];
  producedColumns: string[];
}

export interface ScaleReport {
  feature: string;
  method: ScalingMethod;
  /** Standardization. */
  mean?: number;
  std?: number;
  /** Min-max. */
  min?: number;
  max?: number;
}

export interface SplitReport {
  train: number;
  validation: number;
  test: number;
  stratified: boolean;
  seed: number;
  /** Class balance per split, for classification. */
  classCounts?: Record<string, { train: number; validation: number; test: number }>;
  /** A few rows from each split, already preprocessed, with their target. */
  samples: { split: "train" | "validation" | "test"; features: number[]; target: number }[];
}

/* ───────────────────────────── model facts ──────────────────────────── */

export interface ParamSnapshot {
  /** How many trainable numbers the model has. */
  count: number;
  /** L2 norm of all parameters. */
  norm: number;
  /** Per-layer / per-group description. */
  groups: { name: string; shape: number[]; values: number[]; truncated: boolean; norm: number }[];
}

export interface GradientSnapshot {
  norm: number;
  groups: { name: string; norm: number; values: number[]; truncated: boolean }[];
  /** Whether gradients were clipped this step. */
  clipped: boolean;
}

/** One forward/backward/update cycle of a gradient-trained model. */
export interface TrainStep {
  iteration: number;
  epoch: number;
  batch: number;
  batchesPerEpoch: number;
  batchSize: number;
  /** Real predictions on the first rows of the batch. */
  forward: { indices: number[]; predictions: number[][]; targets: number[]; activations?: { layer: string; values: number[]; truncated: boolean }[] };
  loss: { value: number; dataTerm: number; regularizationTerm: number; kind: string };
  gradient: GradientSnapshot;
  /** Per-layer gradient norms in backward order, for the backprop stage. */
  backward: { layer: string; gradNorm: number; deltaNorm: number }[];
  update: { optimizer: Optimizer; learningRate: number; stepNorm: number; params: ParamSnapshot };
  ms: number;
}

export interface EpochReport {
  epoch: number;
  trainLoss: number;
  validationLoss: number | null;
  validationMetric: { name: string; value: number } | null;
  ms: number;
  /** True when this epoch's validation score is the best so far and its parameters were kept. */
  bestSoFar: boolean;
}

/** One split found while growing a tree. */
export interface TreeSplitStep {
  treeIndex: number;
  nodeId: number;
  depth: number;
  samples: number;
  impurityBefore: number;
  /** The candidates evaluated at this node and the best one. */
  candidatesEvaluated: number;
  /** The best split, with the ids of the two child nodes it created. */
  chosen: { feature: string; threshold: number; impurityAfter: number; gain: number; left: number; right: number; leftId: number; rightId: number } | null;
  /** Set when the node became a leaf. */
  leaf: { value: number; classCounts?: number[] } | null;
  ms: number;
}

export interface TreeNode {
  id: number;
  depth: number;
  samples: number;
  impurity: number;
  feature?: string;
  threshold?: number;
  left?: number;
  right?: number;
  value?: number;
  classCounts?: number[];
}

export interface KnnQueryStep {
  queryIndex: number;
  neighbours: { index: number; distance: number; target: number }[];
  prediction: number;
  target: number;
  ms: number;
}

export interface NaiveBayesStep {
  classIndex: number;
  className: string;
  prior: number;
  featureStats: { feature: string; mean: number; variance: number }[];
  samples: number;
}

export interface NetworkArchitecture {
  layers: { name: string; units: number; activation: Activation | "linear" | "softmax" | "sigmoid" }[];
  paramCount: number;
}

/* ─────────────────────────────── metrics ────────────────────────────── */

export interface ClassificationMetrics {
  task: "classification";
  accuracy: number;
  precisionMacro: number;
  recallMacro: number;
  f1Macro: number;
  logLoss: number | null;
  confusion: { classes: string[]; matrix: number[][] };
  /** Per class, one-vs-rest. */
  roc: { className: string; points: { fpr: number; tpr: number }[]; auc: number }[] | null;
  pr: { className: string; points: { recall: number; precision: number }[]; ap: number }[] | null;
  n: number;
}

export interface RegressionMetrics {
  task: "regression";
  mse: number;
  rmse: number;
  mae: number;
  r2: number;
  n: number;
}

export type Metrics = ClassificationMetrics | RegressionMetrics;

export interface FeatureImportance {
  method: "coefficients" | "impurity decrease" | "permutation";
  source: DataSource;
  note: string;
  values: { feature: string; importance: number }[];
}

/**
 * Predictions on a 2-D grid so a boundary can be drawn. Exact when the model has
 * exactly two features; otherwise other features are held at their mean, which
 * is a simplification and is labelled one.
 */
export interface DecisionSurface {
  xFeature: string;
  yFeature: string;
  xs: number[];
  ys: number[];
  /** Row-major grid of predicted class index or regression value. */
  values: number[];
  source: DataSource;
  note: string;
  points: { x: number; y: number; target: number; predicted: number; split: "train" | "validation" | "test" }[];
}

export interface CandidateResult {
  index: number;
  parameter: string;
  value: number;
  validationMetric: { name: string; value: number };
  trainLoss: number | null;
  ms: number;
  best: boolean;
}

/* ─────────────────────────────── events ─────────────────────────────── */

export type MLEvent =
  | { type: "run_started"; at: number; runId: string; config: MLConfig; dataset: { id: string; name: string; rows: number; columns: number } }
  | { type: "dataset_loaded"; at: number; dataset: DatasetSummary; ms: number }
  | { type: "inspected"; at: number; columns: ColumnSummary[]; targetCorrelations: { feature: string; correlation: number }[] | null }
  | { type: "identified"; at: number; features: string[]; target: string; task: MLTask; classes: string[] | null; reason: string }
  | { type: "cleaned"; at: number; rowsBefore: number; rowsAfter: number; droppedRows: { emptyTarget: number; duplicates: number }; droppedColumns: { name: string; reason: string }[] }
  | { type: "imputed"; at: number; reports: ImputeReport[]; rowsDropped: number }
  | { type: "encoded"; at: number; reports: EncodeReport[]; featureNames: string[]; targetEncoding: { method: "label" | "numeric"; classes?: string[] } }
  | { type: "scaled"; at: number; reports: ScaleReport[]; fittedOn: "train" }
  | { type: "engineered"; at: number; added: string[]; method: string; featureNames: string[] }
  | { type: "split"; at: number; report: SplitReport; subsampled: { from: number; to: number } | null }
  | { type: "model_selected"; at: number; algorithm: Algorithm; task: MLTask; hyperparameters: Hyperparameters; family: "gradient" | "tree" | "instance" | "probabilistic"; skippedStages: string[]; skipReason: string | null }
  | { type: "model_initialized"; at: number; params: ParamSnapshot; architecture: NetworkArchitecture | null; seed: number; note: string }
  | { type: "train_step"; at: number; step: TrainStep; detailed: boolean; stride: number }
  | { type: "tree_split"; at: number; step: TreeSplitStep }
  | { type: "tree_built"; at: number; treeIndex: number; nodes: number; depth: number; leaves: number; oobScore: number | null; ms: number; tree: TreeNode[] | null }
  | { type: "knn_indexed"; at: number; stored: number; features: number; k: number }
  | { type: "knn_query"; at: number; step: KnnQueryStep; detailed: boolean }
  | { type: "nb_class_fitted"; at: number; step: NaiveBayesStep }
  | { type: "epoch_completed"; at: number; report: EpochReport }
  | { type: "validated"; at: number; metrics: Metrics; predictionsSample: { index: number; predicted: number; target: number; probabilities?: number[] }[] }
  | { type: "candidate_started"; at: number; candidate: { index: number; parameter: string; value: number } }
  | { type: "candidate_finished"; at: number; result: CandidateResult }
  | { type: "hyperparameters_evaluated"; at: number; candidates: CandidateResult[]; checkpoints: { epoch: number; validationMetric: number }[] | null; metricName: string; higherIsBetter: boolean }
  | { type: "best_selected"; at: number; choice: string; reason: string; retrained: boolean }
  | { type: "tested"; at: number; metrics: Metrics; predictions: { index: number; predicted: number; target: number; probabilities?: number[] }[] }
  | { type: "evaluated"; at: number; importance: FeatureImportance | null; surface: DecisionSurface | null; lossCurve: { epoch: number; train: number; validation: number | null }[] }
  | { type: "model_saved"; at: number; modelId: string; bytes: number; params: ParamSnapshot; tree: TreeNode[] | null; forest: { trees: number; nodes: number } | null; architecture: NetworkArchitecture | null }
  | { type: "run_completed"; at: number; totalMs: number; iterations: number; epochs: number }
  | { type: "notice"; at: number; level: "info" | "warn"; message: string }
  | { type: "error"; at: number; message: string; retryable: boolean };

/* ───────────────────────────── inference ────────────────────────────── */

export interface PredictRequestBody {
  /** Raw values keyed by original column name, as a person would type them. */
  input: Record<string, string | number | boolean | null>;
}

export interface PredictionTrace {
  modelId: string;
  algorithm: Algorithm;
  task: MLTask;
  /** The raw input after imputation and encoding, before scaling. */
  encoded: { feature: string; value: number }[];
  /** After scaling: what the model actually saw. */
  scaled: number[];
  /** Neural network: activations layer by layer. Linear models: the weighted sum. */
  layers?: { name: string; values: number[]; truncated: boolean }[];
  /** Tree models: the path of decisions taken. */
  path?: { treeIndex: number; nodeId: number; feature?: string; threshold?: number; value: number; went?: "left" | "right" }[];
  /** KNN: the neighbours that voted. */
  neighbours?: { index: number; distance: number; target: number }[];
  /** Naive Bayes: per-class log-likelihoods. */
  classScores?: { className: string; logScore: number }[];
  probabilities: number[] | null;
  prediction: number;
  label: string;
  ms: number;
}

/* ─────────────────────────── request bodies ─────────────────────────── */

/** A config as the browser sends it: any field may be missing, hyperparameters included. */
export type MLConfigInput = Omit<Partial<MLConfig>, "hyperparameters"> & { hyperparameters?: Partial<Hyperparameters> };

export interface StartMLRunBody {
  datasetId: string;
  config: MLConfigInput;
  sessionId: string;
}

export interface MLServiceStatus {
  samples: SampleDatasetInfo[];
  algorithms: typeof ALGORITHMS;
  limits: typeof ML_LIMITS;
}

export interface SavedModelInfo {
  modelId: string;
  runId: string;
  algorithm: Algorithm;
  task: MLTask;
  datasetName: string;
  features: string[];
  target: string;
  classes: string[] | null;
  /** Original column names and types the prediction form needs. */
  inputs: { name: string; type: ColumnType; categories?: string[]; example: string | number }[];
  metrics: Metrics | null;
  savedAt: number;
}
