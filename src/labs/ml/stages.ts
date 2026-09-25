import type { DataSource } from "@shared/llm";

/** Execution order of the ML pipeline: data, then the training loop, then evaluation, then deployment. */
export const ML_STAGE_IDS = [
  "ingest",
  "inspect",
  "identify",
  "clean",
  "missing",
  "encode",
  "scale",
  "engineer",
  "split",
  "selectModel",
  "init",
  "forward",
  "loss",
  "gradient",
  "backprop",
  "update",
  "iterate",
  "epoch",
  "validate",
  "hyperparams",
  "selectBest",
  "test",
  "evaluate",
  "save",
  "infer",
  "predict",
] as const;

export type MLStageId = (typeof ML_STAGE_IDS)[number];

export interface MLStageDefinition {
  id: MLStageId;
  label: string;
  shortLabel: string;
  defaultSource: DataSource;
  caption: string;
  beginner: string;
  advanced: string;
  sourceNote: string;
}

export const ML_STAGES: Record<MLStageId, MLStageDefinition> = {
  ingest: { id: "ingest", label: "Dataset Ingestion", shortLabel: "Ingest", defaultSource: "live", caption: "Rows arrive", beginner: "Your file is read into a table of rows and columns.", advanced: "CSV is parsed with quoting and a sniffed delimiter; JSON as an array of flat objects. Values stay as strings until types are inferred.", sourceNote: "Live: your real rows, exactly as parsed." },
  inspect: { id: "inspect", label: "Data Inspection", shortLabel: "Inspect", defaultSource: "live", caption: "Types, gaps, shapes", beginner: "Each column is looked at: is it a number, a category, a yes/no? How many values are missing? What does its distribution look like?", advanced: "Type inference by value patterns (≥90% numeric → numeric; ≤20 distinct strings → categorical; unique-per-row → id). Per-column stats, 12-bin histograms and Pearson correlation with the target.", sourceNote: "Live: every count, statistic and histogram is computed from the rows." },
  identify: { id: "identify", label: "Features & Target", shortLabel: "Target", defaultSource: "live", caption: "What predicts what", beginner: "One column is the thing to predict (the target); the others are the clues (features). The kind of target decides whether this is classification or regression.", advanced: "The chosen or last usable column becomes the target. A numeric target with more than 12 distinct values makes a regression problem; anything else, classification with the sorted distinct values as classes.", sourceNote: "Live: the decision and its reason are stated from the data." },
  clean: { id: "clean", label: "Data Cleaning", shortLabel: "Clean", defaultSource: "live", caption: "Drop what cannot help", beginner: "Rows with no target, duplicate rows, and columns that carry no pattern (ids, constants, free text) are removed.", advanced: "Exact-duplicate rows are dropped after projecting onto the kept columns; id-like, constant and high-cardinality text columns are excluded with the reason recorded.", sourceNote: "Live: the counts are what was actually removed." },
  missing: { id: "missing", label: "Missing Values", shortLabel: "Impute", defaultSource: "live", caption: "Fill the gaps", beginner: "Empty cells are filled with a sensible stand-in: the middle value for numbers, the most common value for categories.", advanced: "Median, mean or mode per column (or drop rows). The fill value is fitted here and reused at prediction time so new rows are treated the same way.", sourceNote: "Live: fill values and counts from the real columns." },
  encode: { id: "encode", label: "Categorical Encoding", shortLabel: "Encode", defaultSource: "live", caption: "Words → numbers", beginner: "Models only understand numbers, so each category becomes its own 0/1 column and yes/no becomes 1/0.", advanced: "One-hot encoding for categoricals, 1/0 for booleans, pass-through for numerics. Class labels become indices 0…K−1 in sorted order.", sourceNote: "Live: the produced columns are the model's real inputs." },
  scale: { id: "scale", label: "Feature Scaling", shortLabel: "Scale", defaultSource: "live", caption: "Same footing", beginner: "Features measured in different units are put on the same scale so no single one dominates.", advanced: "Standardization (z-scores) or min-max, with statistics fitted on the training rows only, so validation and test never leak into the model.", sourceNote: "Live: the means and standard deviations shown are the fitted ones." },
  engineer: { id: "engineer", label: "Feature Engineering", shortLabel: "Engineer", defaultSource: "live", caption: "New clues from old", beginner: "Optionally, new features are built from existing ones, like a value squared, so a straight-line model can bend.", advanced: "Squares of every numeric feature plus pairwise products of the first three, computed after scaling. Off by default.", sourceNote: "Live: the added columns are real derived values." },
  split: { id: "split", label: "Train / Validation / Test", shortLabel: "Split", defaultSource: "live", caption: "Hold some back", beginner: "The rows are dealt into three piles: one to learn from, one to tune with, one kept sealed for the final exam.", advanced: "Seeded shuffle; stratified by class for classification so every split has every class. Very large tables are subsampled for training with a notice.", sourceNote: "Live: real counts and real rows in each split." },
  selectModel: { id: "selectModel", label: "Model Selection", shortLabel: "Algorithm", defaultSource: "live", caption: "Which learner", beginner: "You choose how the machine should learn: a straight line, a tree of questions, a vote of neighbours, a network of neurons.", advanced: "The algorithm family decides which training stages exist: gradient models loop over forward/loss/gradient/update; trees grow splits; KNN stores rows; Naive Bayes fits statistics in one pass.", sourceNote: "Live: the chosen algorithm and its hyperparameters." },
  init: { id: "init", label: "Model Initialization", shortLabel: "Init", defaultSource: "live", caption: "Starting point", beginner: "The model starts blank: random small weights, an empty tree, or nothing at all.", advanced: "Gradient models draw weights from a scaled normal (He or Xavier scale) with the run's seed and zero biases. Trees begin as a root holding every training row.", sourceNote: "Live: the seed and the initial parameters are real." },
  forward: { id: "forward", label: "Forward Prediction", shortLabel: "Forward", defaultSource: "live", caption: "Guess", beginner: "The model looks at a batch of rows and makes its current best guesses.", advanced: "A mini-batch flows through the layers: weighted sums, activations, then a softmax or a raw value. For trees this stage is evaluating candidate splits at a node.", sourceNote: "Live: the predictions shown are the model's real outputs on real rows." },
  loss: { id: "loss", label: "Loss Calculation", shortLabel: "Loss", defaultSource: "live", caption: "How wrong", beginner: "The guesses are compared with the true answers and summed into one number: the loss. Lower is better.", advanced: "Mean squared error for regression, cross-entropy for softmax classifiers, hinge for the SVM, plus any L1/L2 penalty. For trees, the impurity (Gini or variance) plays this role.", sourceNote: "Live: the loss value is computed from the batch." },
  gradient: { id: "gradient", label: "Gradient Calculation", shortLabel: "Gradient", defaultSource: "live", caption: "Which way is down", beginner: "For every weight, the model works out which direction would reduce the loss.", advanced: "∂loss/∂output for the output layer (p − y for softmax cross-entropy), then the chain rule through each layer gives ∂loss/∂W and ∂loss/∂b. Norms are clipped at 10.", sourceNote: "Live: real gradient values and norms." },
  backprop: { id: "backprop", label: "Backpropagation", shortLabel: "Backprop", defaultSource: "live", caption: "Blame flows back", beginner: "The error signal travels backwards through the network, layer by layer, so every layer learns its share of the mistake.", advanced: "δ for layer l is (W_{l+1}ᵀ δ_{l+1}) ⊙ σ′(z_l); each layer's gradient is x_lᵀ δ_l. The per-layer norms shown are those δ and gradient norms.", sourceNote: "Live: per-layer norms from the real backward pass." },
  update: { id: "update", label: "Parameter Update", shortLabel: "Update", defaultSource: "live", caption: "Nudge the weights", beginner: "Every weight moves a small step in its downhill direction. The learning rate sets the step size.", advanced: "SGD: w ← w − η∇. Momentum keeps a running velocity. Adam scales each weight's step by running estimates of its gradient's mean and variance, with bias correction.", sourceNote: "Live: the parameter snapshot after the update is the real state." },
  iterate: { id: "iterate", label: "Next Iteration", shortLabel: "Iterate", defaultSource: "live", caption: "Again", beginner: "Take the next batch and repeat: guess, measure, adjust.", advanced: "One iteration is one mini-batch. Steps beyond the drawing budget are still computed; the graph shows every nth.", sourceNote: "Live: the iteration counter counts real steps." },
  epoch: { id: "epoch", label: "Epoch Completion", shortLabel: "Epoch", defaultSource: "live", caption: "One full pass", beginner: "When every training row has been seen once, an epoch ends and the model is checked against the validation pile.", advanced: "Training loss is averaged over the epoch's batches; validation loss and the headline metric are computed on held-out rows. The best epoch's parameters are kept.", sourceNote: "Live: per-epoch losses and metrics." },
  validate: { id: "validate", label: "Validation", shortLabel: "Validate", defaultSource: "live", caption: "Tune-time check", beginner: "The model is scored on rows it did not train on, to see whether it learned patterns or just memorised.", advanced: "Full metrics on the validation split: accuracy, macro precision/recall/F1, log loss, confusion matrix and one-vs-rest ROC/PR; or MSE, RMSE, MAE and R².", sourceNote: "Live: every metric from real predictions on held-out rows." },
  hyperparams: { id: "hyperparams", label: "Hyperparameter Evaluation", shortLabel: "Sweep", defaultSource: "live", caption: "Try the knobs", beginner: "Different settings are tried and compared on the validation pile.", advanced: "With a sweep, each candidate value trains a real model on the same split (quietly) and is scored on validation. Without one, the epochs of this run are compared as checkpoints.", sourceNote: "Live: every candidate was really trained and scored." },
  selectBest: { id: "selectBest", label: "Best Model Selection", shortLabel: "Best", defaultSource: "live", caption: "Keep the winner", beginner: "The setting that scored best on validation is the one kept.", advanced: "Highest accuracy or lowest RMSE on validation wins. The winning candidate's fitted model is used as is; nothing is retrained.", sourceNote: "Live: the choice and its reason." },
  test: { id: "test", label: "Final Testing", shortLabel: "Test", defaultSource: "live", caption: "The sealed exam", beginner: "The chosen model is scored once on the test pile it has never seen. This is the honest estimate of how it will do on new data.", advanced: "Same metrics as validation, on the test split. Because no decision was made using these rows, the estimate is unbiased.", sourceNote: "Live: real predictions on the test rows." },
  evaluate: { id: "evaluate", label: "Model Evaluation", shortLabel: "Evaluate", defaultSource: "live", caption: "Why it works", beginner: "Which features mattered most, and what the model's decision regions look like.", advanced: "Native importance (coefficients or impurity decrease) or permutation importance on validation rows. The decision surface is a grid of real predictions over two features, with the rest held at their mean when there are more than two.", sourceNote: "Live for importance and metrics. The 2-D decision surface is a labelled simplification when the model has more than two features." },
  save: { id: "save", label: "Saved Model", shortLabel: "Save", defaultSource: "live", caption: "Frozen", beginner: "The trained model and its preprocessing are stored so they can be used on new data.", advanced: "Parameters, tree nodes or stored rows plus the fitted imputers, encoders, scaler and engineered-feature recipe are serialised to JSON.", sourceNote: "Live: the saved parameters are the trained ones." },
  infer: { id: "infer", label: "Inference on New Data", shortLabel: "Infer", defaultSource: "live", caption: "A fresh row", beginner: "You type in a new example. It goes through the same cleaning, encoding and scaling as the training rows.", advanced: "Imputers fill gaps, encoders map categories to the training-time columns, engineered features are recomputed, the scaler applies training statistics. Unknown categories become all zeros.", sourceNote: "Live: the transformed vector is what the model receives." },
  predict: { id: "predict", label: "Prediction", shortLabel: "Predict", defaultSource: "live", caption: "The answer", beginner: "The model gives its answer for your example, with how confident it is where that applies.", advanced: "Networks show every layer's activations; trees show the path of decisions; KNN shows the neighbours that voted; Naive Bayes shows per-class log-likelihoods.", sourceNote: "Live: a real prediction with its real trace." },
};

export const DATA_STAGES: MLStageId[] = ["ingest", "inspect", "identify", "clean", "missing", "encode", "scale", "engineer", "split"];
export const TRAIN_STAGES: MLStageId[] = ["selectModel", "init", "forward", "loss", "gradient", "backprop", "update", "iterate", "epoch"];
export const EVAL_STAGES: MLStageId[] = ["validate", "hyperparams", "selectBest", "test", "evaluate"];
export const DEPLOY_STAGES: MLStageId[] = ["save", "infer", "predict"];
