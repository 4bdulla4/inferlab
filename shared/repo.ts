/**
 * Shared contract for the GitHub Product Analyzer lab.
 *
 * Every derived fact carries an `EvidenceKind`:
 *   - "verified"  → read directly from the repository (file exists, line matched)
 *   - "heuristic" → derived by deterministic rules from verified facts (e.g. "backend uses Prisma, so it talks to Postgres")
 *   - "ai"        → proposed by a language model, then checked against the repository index
 */

export type EvidenceKind = "verified" | "heuristic" | "ai";

export interface Evidence {
  kind: EvidenceKind;
  file?: string;
  line?: number;
  snippet?: string;
  note?: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit requested by the user (empty = default branch). */
  ref: string;
  url: string;
}

export interface RepoMeta {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  /** Commit SHA the analysis was performed on. */
  sha: string;
  stars: number;
  forks: number;
  primaryLanguage: string | null;
  license: string | null;
  homepage: string | null;
  topics: string[];
  htmlUrl: string;
  pushedAt: string | null;
  /** True when the repository is private and was read with the caller's GitHub token. */
  isPrivate: boolean;
}

export type Language =
  | "typescript" | "javascript" | "python" | "go" | "rust" | "java" | "kotlin" | "ruby" | "php"
  | "csharp" | "swift" | "dart" | "shell" | "sql" | "yaml" | "json" | "toml" | "markdown" | "html"
  | "css" | "prisma" | "graphql" | "dockerfile" | "other";

export type FileRole =
  | "frontend" | "backend" | "api-route" | "page" | "model" | "auth" | "config" | "infra" | "test"
  | "docs" | "worker" | "cron" | "webhook" | "ai" | "migration" | "entry" | "shared" | "styles" | "script";

export type SymbolKind = "function" | "class" | "method" | "component" | "hook" | "type" | "const" | "route-handler";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
  signature?: string;
}

export interface ImportRef {
  /** Import specifier as written. */
  source: string;
  /** Repository path when the import resolves to a file in the repo. */
  resolved?: string;
  external: boolean;
  line: number;
}

export interface RepoFile {
  path: string;
  size: number;
  language: Language;
  /** False when the file was listed in the tree but not fetched (budget / binary). */
  scanned: boolean;
  loc: number;
  symbols: CodeSymbol[];
  imports: ImportRef[];
  roles: FileRole[];
  /** Repo paths that import this file (reverse of imports). */
  importedBy: string[];
  /** Architecture node this file primarily belongs to (set after graph construction). */
  nodeId?: string;
}

export type RouteKind = "http" | "webhook" | "graphql" | "rpc" | "page";

export interface ApiRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: string;
  handler?: string;
  kind: RouteKind;
  evidence: Evidence;
}

export type EnvCategory = "secret" | "url" | "flag" | "config";

export interface EnvVar {
  name: string;
  category: EnvCategory;
  usages: { file: string; line: number }[];
  /** Files such as .env.example that declare the variable. */
  declaredIn: string[];
}

export type Ecosystem = "npm" | "pypi" | "go" | "cargo" | "maven" | "rubygems" | "composer" | "other";

export interface Dependency {
  name: string;
  version?: string;
  manifest: string;
  dev: boolean;
  ecosystem: Ecosystem;
}

export type IntegrationCategory =
  | "frontend-framework" | "backend-framework" | "api-style" | "database" | "orm" | "cache" | "auth" | "ai"
  | "vector-db" | "queue" | "worker" | "cron" | "payments" | "email" | "storage" | "analytics" | "monitoring"
  | "realtime" | "search" | "testing" | "build" | "deployment" | "external";

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  evidence: Evidence[];
  dependencies: string[];
  files: string[];
  envVars: string[];
}

export type InfraKind =
  | "dockerfile" | "compose" | "vercel" | "netlify" | "fly" | "render" | "procfile" | "kubernetes"
  | "github-actions" | "serverless" | "terraform" | "railway" | "heroku" | "app-engine" | "other";

export interface InfraConfig {
  kind: InfraKind;
  file: string;
  summary: string;
  details: Record<string, string | string[] | number | boolean>;
}

export type SchemaKind = "prisma" | "mongoose" | "sqlalchemy" | "django" | "typeorm" | "drizzle" | "sequelize" | "sql" | "other";

export interface SchemaModel {
  name: string;
  file: string;
  line: number;
  kind: SchemaKind;
  fields: string[];
}

export type JobKind = "cron" | "queue" | "worker" | "task";

export interface ScheduledJob {
  name: string;
  kind: JobKind;
  schedule?: string;
  file: string;
  line: number;
  library: string;
  evidence: Evidence;
}

export type NodeCategory = "client" | "frontend" | "api" | "auth" | "service" | "data" | "async" | "ai" | "external" | "infra";

export interface ArchNode {
  id: string;
  label: string;
  category: NodeCategory;
  /** Left-to-right column in the diagram. */
  layer: number;
  /** Verified one-line description built from repository facts. */
  summary: string;
  /** Optional model-generated role description (kind: ai). */
  aiSummary?: string;
  files: string[];
  routes: string[];
  symbols: { file: string; name: string; kind: SymbolKind; line: number }[];
  dependencies: string[];
  envVars: string[];
  integrations: string[];
  evidence: Evidence[];
}

export type EdgeKind = "imports" | "calls" | "http" | "reads-writes" | "enqueues" | "consumes" | "deploys" | "configures" | "uses" | "authenticates";

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
  evidence: Evidence;
  /** Number of concrete facts (e.g. import statements) supporting this edge. */
  weight: number;
}

export interface RepoStats {
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  truncatedTree: boolean;
  bytesRead: number;
  languages: Partial<Record<Language, number>>;
  totalLoc: number;
}

export interface RepoOverview {
  headline: string;
  stack: string[];
  /** Paragraph written by the model, when available. */
  aiOverview?: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AiStatus {
  available: boolean;
  model?: string;
  note: string;
  /** Tokens spent by the most recent model call for this analysis, when any. */
  usage?: AiUsage;
}

export interface RepoAnalysis {
  id: string;
  ref: RepoRef;
  meta: RepoMeta;
  scannedAt: number;
  durationMs: number;
  stats: RepoStats;
  files: RepoFile[];
  dependencies: Dependency[];
  integrations: Integration[];
  routes: ApiRoute[];
  envVars: EnvVar[];
  infra: InfraConfig[];
  schema: SchemaModel[];
  jobs: ScheduledJob[];
  graph: { nodes: ArchNode[]; edges: ArchEdge[] };
  overview: RepoOverview;
  ai: AiStatus;
  warnings: string[];
}

export type AnalyzeEvent =
  | { type: "phase"; at: number; phase: string; detail: string; progress: number }
  | { type: "log"; at: number; message: string }
  | { type: "analysis"; at: number; analysis: RepoAnalysis }
  | { type: "error"; at: number; message: string; status?: number };

export interface TraceStep {
  index: number;
  title: string;
  description: string;
  nodeId?: string;
  edgeId?: string;
  file?: string;
  line?: number;
  symbol?: string;
  kind: EvidenceKind;
  verification: { nodeExists: boolean; fileExists: boolean; symbolExists: boolean };
}

export interface TraceResult {
  id: string;
  analysisId: string;
  question: string;
  answer: string;
  steps: TraceStep[];
  source: "ai" | "heuristic";
  model?: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
  createdAt: number;
  /** Model tokens spent answering (AI traces only). */
  usage?: AiUsage;
}

export interface AnalyzeRequestBody {
  url: string;
  /** Run the model summarization pass during analysis. Off by default to keep API usage low. */
  withAi?: boolean;
}

export interface SummarizeRequestBody {
  analysisId: string;
}

export interface SummarizeResult {
  overview: RepoOverview;
  nodes: { id: string; aiSummary: string }[];
  ai: AiStatus;
}

export interface AskRequestBody {
  analysisId: string;
  question: string;
}

export interface RepoServiceStatus {
  githubTokenConfigured: boolean;
  ai: AiStatus;
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
}
