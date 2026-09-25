import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, FileCode2, FolderUp, GitBranch, Loader2, ShieldAlert, Sparkles, X } from "lucide-react";
import type { AgentBackendReport, DetectedTool, Evidence, Finding, FlowStep } from "@shared/agentReport";
import { CODE_ANALYSIS_LIMITS } from "@shared/agentReport";
import type { CodeFile } from "@shared/agentReport";
import { analyzeAgentCode, analyzeAgentRepo } from "@/api/agentClient";
import type { AgentRunState, AgentVisualState } from "@/labs/agent/state";
import { createAgentVisualState } from "@/labs/agent/state";
import type { AgentNodeKind } from "@/labs/agent/stages";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AgentGraph } from "./AgentGraph";
import { ToolIcon } from "./ToolGlyph";

const TEXT_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyi|go|rs|java|kt|rb|php|cs|swift|json|ya?ml|toml|md|mdx|txt|cfg|ini|sh)$/i;
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|\.next|coverage|target|vendor|__pycache__|\.venv|venv)(\/|$)/;

/**
 * Upload an agent's backend (files or a whole folder), or point at a GitHub
 * repository, and get a report on how it processes a request: framework,
 * model, tools, loop, memory, retrieval, resilience, human steps, security
 * notes and an inferred flow drawn on the same graph the lab uses for runs.
 * Files are read in the browser, sent once, analyzed statically and dropped.
 */
export function AgentCodeAnalyzer({ className }: { className?: string }) {
  const codeReport = useAgentStore((s) => s.codeReport);
  const setCodeReport = useAgentStore((s) => s.setCodeReport);
  const config = useAgentStore((s) => s.config);
  const status = useAgentStore((s) => s.status);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const provider = status?.providers.find((p) => p.id === config.llmProvider);
  const narrateWith = provider && provider.configured && !provider.mock ? config.llmProvider : undefined;

  const readFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      setCodeReport({ loading: true, error: null, stage: `Reading ${files.length} file${files.length === 1 ? "" : "s"}…` });
      const out: CodeFile[] = [];
      let skipped = 0;
      let bytes = 0;
      for (const f of files) {
        const path = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/^\.?\//, "");
        if (SKIP.test(path) || (!TEXT_EXT.test(path) && !/(^|\/)(Dockerfile|Procfile|requirements[\w.-]*\.txt|pyproject\.toml|package\.json|go\.mod|Cargo\.toml|Gemfile|\.env\.example)$/.test(path)) || f.size > CODE_ANALYSIS_LIMITS.maxFileBytes) {
          skipped += 1;
          continue;
        }
        if (bytes + f.size > CODE_ANALYSIS_LIMITS.maxTotalBytes || out.length >= CODE_ANALYSIS_LIMITS.maxFiles) {
          skipped += 1;
          continue;
        }
        out.push({ path, content: await f.text() });
        bytes += f.size;
      }
      if (out.length === 0) {
        setCodeReport({ loading: false, stage: null, error: "No source files were found in the selection. Pick the folder that holds the agent's code." });
        return;
      }
      const name = out[0]!.path.includes("/") ? out[0]!.path.split("/")[0]! : `${out.length} files`;
      setCodeReport({ stage: `Analyzing ${out.length} files (${skipped} skipped locally)…` });
      try {
        const report = await analyzeAgentCode({ files: out, name, llmProvider: narrateWith });
        setCodeReport({ loading: false, stage: null, result: report });
      } catch (err) {
        setCodeReport({ loading: false, stage: null, error: err instanceof Error ? err.message : "The code could not be analyzed." });
      }
    },
    [narrateWith, setCodeReport],
  );

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const items = Array.from(e.dataTransfer.items ?? []);
      const files: File[] = [];
      const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
          Object.defineProperty(file, "webkitRelativePath", { value: `${prefix}${file.name}` });
          files.push(file);
        } else if (entry.isDirectory) {
          if (SKIP.test(`${prefix}${entry.name}/`)) return;
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of entries) await walk(child, `${prefix}${entry.name}/`);
        }
      };
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await walk(entry, "");
        else {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) await readFiles(files);
    },
    [readFiles],
  );

  const analyzeRepo = async () => {
    if (!url.trim()) return;
    setCodeReport({ loading: true, error: null, stage: "Fetching the repository from GitHub…" });
    try {
      const report = await analyzeAgentRepo({ url: url.trim(), llmProvider: narrateWith });
      setCodeReport({ loading: false, stage: null, result: report });
    } catch (err) {
      setCodeReport({ loading: false, stage: null, error: err instanceof Error ? err.message : "The repository could not be analyzed." });
    }
  };

  const report = codeReport.result;

  return (
    <GlassPanel
      className={className}
      title="Analyze your agent's backend"
      subtitle="upload the code, get a report on how it processes a request"
      actions={
        <>
          {report ? <Badge tone={report.verdict === "agent" ? "ok" : report.verdict === "possible" ? "warn" : "neutral"}>{report.verdict === "agent" ? "agent detected" : report.verdict === "possible" ? "possibly an agent" : "not an agent"}</Badge> : null}
          {report ? (
            <Button size="sm" variant="ghost" icon={<X />} onClick={() => setCodeReport({ result: null, error: null })}>
              Clear
            </Button>
          ) : null}
        </>
      }
      bodyClassName="p-3.5 grid gap-3"
    >
      {!report ? (
        <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => void onDrop(e)}
            className={cn("rounded-xl border-2 border-dashed p-5 grid place-items-center gap-2 text-center min-h-[164px] transition-colors", dragging ? "border-accent bg-accent/[0.06]" : "border-line-strong surface-1")}
          >
            <FolderUp className="size-6 text-accent-soft" aria-hidden="true" />
            <p className="text-[13px] text-ink">Drop your agent's folder or files here</p>
            <p className="text-[11.5px] leading-snug text-muted max-w-md">Python, TypeScript, JavaScript, Go and more. Dependencies, build output and binaries are skipped in the browser. Nothing is executed and nothing is kept after the report.</p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button size="sm" variant="primary" icon={<FolderUp />} onClick={() => folderInput.current?.click()} disabled={codeReport.loading}>
                Choose folder
              </Button>
              <Button size="sm" variant="outline" icon={<FileCode2 />} onClick={() => fileInput.current?.click()} disabled={codeReport.loading}>
                Choose files
              </Button>
            </div>
            <input ref={folderInput} type="file" multiple className="hidden" aria-label="Choose a folder" onChange={(e) => e.target.files && void readFiles(e.target.files)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
            <input ref={fileInput} type="file" multiple className="hidden" aria-label="Choose files" onChange={(e) => e.target.files && void readFiles(e.target.files)} />
          </div>
          <form
            className="rounded-xl border border-line surface-1 p-4 grid gap-2 content-start"
            onSubmit={(e) => {
              e.preventDefault();
              void analyzeRepo();
            }}
          >
            <p className="flex items-center gap-2 text-[13px] text-ink">
              <GitBranch className="size-4 text-muted" aria-hidden="true" />
              Or point at a GitHub repository
            </p>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/agent-repo" aria-label="GitHub repository URL" className="h-9 w-full rounded-lg border border-line bg-bg-elevated/80 px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent/60" />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="outline" icon={codeReport.loading ? <Loader2 className="animate-spin" /> : <GitBranch />} disabled={!url.trim() || codeReport.loading}>
                Analyze repository
              </Button>
              <span className="text-[10.5px] text-muted">Public repos work as is; private ones need your GitHub token in Settings.</span>
            </div>
            <p className="text-[10.5px] leading-snug text-faint">
              {narrateWith ? `${provider!.name} will write the explanation from the report's facts; the findings themselves come from code.` : "Add a provider key to get a written explanation; the findings need no model."}
            </p>
          </form>
          {codeReport.loading ? (
            <p className="mono text-[11px] text-live flex items-center gap-2 @3xl:col-span-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              {codeReport.stage}
            </p>
          ) : null}
          {codeReport.error ? <p className="text-[12px] leading-snug text-err @3xl:col-span-2">{codeReport.error}</p> : null}
        </div>
      ) : (
        <ReportView report={report} />
      )}
    </GlassPanel>
  );
}

/* ─────────────────────────────── report ────────────────────────────── */

type Tab = "flow" | "tools" | "model" | "memory" | "resilience" | "security" | "files";

function ReportView({ report }: { report: AgentBackendReport }) {
  const [tab, setTab] = useState<Tab>("flow");
  const mode = useUIStore((s) => s.mode);
  const run = useMemo(() => reportToRun(report), [report]);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "flow", label: "How it processes a request" },
    { id: "tools", label: "Tools", count: report.tools.length },
    { id: "model", label: "Model & prompts", count: report.models.length + report.prompts.length },
    { id: "memory", label: "Memory & retrieval", count: report.memory.length + report.retrieval.length },
    { id: "resilience", label: "Resilience & control", count: report.resilience.length + report.humanInLoop.length + report.termination.length + report.parallelism.length },
    { id: "security", label: "Security", count: report.security.length },
    { id: "files", label: "Files", count: report.source.files },
  ];
  return (
    <div className="grid gap-3 min-w-0">
      <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-3 grid gap-1.5">
        <p className="flex flex-wrap items-center gap-2 min-w-0">
          <Sparkles className="size-4 text-accent-soft shrink-0" aria-hidden="true" />
          <span className="text-[13.5px] text-ink">{report.summary}</span>
        </p>
        <p className="mono text-[10.5px] text-muted">
          {report.source.kind === "github" ? "GitHub · " : "upload · "}
          {report.source.name} · {report.source.files} files · {formatNumber(Math.round(report.source.bytes / 1024))} KB · {Object.entries(report.source.languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(", ")} · analyzed in {formatMs(report.ms)} · {report.source.skipped} skipped
        </p>
        {report.warnings.map((w) => (
          <p key={w} className="text-[11.5px] leading-snug text-warn flex items-start gap-1.5">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" aria-hidden="true" />
            {w}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={cn("mono h-7 rounded-md border px-2.5 text-[10.5px] tracking-wide transition-colors inline-flex items-center gap-1.5", tab === t.id ? "border-line-strong surface-3 text-ink" : "border-line text-muted hover:text-ink-dim")}>
            {t.label}
            {t.count !== undefined ? <span className={cn("rounded px-1 text-[9.5px]", t.id === "security" && t.count ? "bg-err/20 text-err" : "surface-2 text-faint")}>{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "flow" ? (
        <div className="grid gap-3">
          <AgentGraph run={run} note="Inferred from the code, not from a run. Dashed clock icons mean 'declared but not executed here'. Run the agent to see real events." />
          <ol className="grid gap-1.5">
            {report.flow.map((s, i) => (
              <FlowRow key={s.id} step={s} index={i} />
            ))}
          </ol>
          <div className="rounded-lg border border-line surface-1 p-3 grid gap-1.5">
            <p className="label-caps flex items-center gap-2">
              Explanation
              <Badge tone={report.narrative.source === "ai" ? "live" : "neutral"}>{report.narrative.source === "ai" ? `written by ${report.narrative.model ?? "the model"} from the findings` : "assembled from the findings"}</Badge>
            </p>
            <p className="text-[12.5px] leading-relaxed text-ink-dim whitespace-pre-wrap">{report.narrative.text}</p>
          </div>
        </div>
      ) : null}

      {tab === "tools" ? (
        report.tools.length ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {report.tools.map((t) => (
              <ToolCard key={`${t.file}:${t.line}:${t.name}`} tool={t} />
            ))}
          </ul>
        ) : (
          <Empty>No tool declarations were recognised in the code.</Empty>
        )
      ) : null}

      {tab === "model" ? (
        <div className="grid gap-3">
          <Section title="Frameworks" items={report.frameworks} empty="No agent framework detected; the loop is hand-written or absent." />
          <div className="grid gap-1.5">
            <p className="label-caps">Model providers</p>
            {report.models.length ? report.models.map((m) => (
              <div key={m.provider} className="rounded-lg border border-line surface-1 px-3 py-2 grid gap-1">
                <p className="text-[12.5px] text-ink flex flex-wrap items-center gap-1.5">
                  {m.provider}
                  {m.models.map((x) => (
                    <Badge key={x}>{x}</Badge>
                  ))}
                </p>
                <EvidenceList evidence={m.evidence} />
              </div>
            )) : <Empty>No model client or model id found.</Empty>}
          </div>
          <div className="grid gap-1.5">
            <p className="label-caps">Prompts found in code</p>
            {report.prompts.length ? report.prompts.map((p) => (
              <div key={`${p.file}:${p.line}`} className="rounded-lg border border-line surface-1 px-3 py-2 grid gap-1">
                <p className="mono text-[10.5px] text-muted">
                  {p.role} · {p.file}:{p.line}
                </p>
                <p className="text-[12.5px] leading-snug text-ink-dim">“{p.excerpt}”</p>
              </div>
            )) : <Empty>No system prompt string was found; it may live in a file or be set by the framework.</Empty>}
          </div>
          <Section title="Streaming" items={report.streaming} empty="No streaming found; responses return whole." />
          <Section title="Entry points" items={report.entryPoints} empty="No HTTP server or main function found." />
          {report.envVars.length ? (
            <div className="grid gap-1">
              <p className="label-caps">Environment variables read (names only)</p>
              <p className="mono text-[11px] text-ink-dim break-words">{report.envVars.join(", ")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="grid gap-3">
          <Section title="Memory" items={report.memory} empty="No memory mechanism found; every request starts from scratch." />
          <Section title="Retrieval" items={report.retrieval} empty="No embeddings, vector store or retriever found." />
        </div>
      ) : null}

      {tab === "resilience" ? (
        <div className="grid gap-3">
          <Section title="Loop" items={report.loop ? [report.loop] : []} empty="No tool-calling loop was found." />
          <Section title="Termination" items={report.termination} empty="No iteration cap, budget or final-answer signal found." />
          <Section title="Failure handling" items={report.resilience} empty="No retries, fallbacks or timeouts found." />
          <Section title="Human in the loop" items={report.humanInLoop} empty="No approval or clarification step found." />
          <Section title="Parallelism" items={report.parallelism} empty="Calls run one after another." />
          <Section title="Observability" items={report.observability} empty="No tracing or logging integration found." />
        </div>
      ) : null}

      {tab === "security" ? (
        report.security.length ? (
          <ul className="grid gap-1.5">
            {report.security.map((s) => (
              <li key={`${s.file}:${s.line}:${s.title}`} className="rounded-lg border border-err/40 bg-err/[0.05] px-3 py-2 grid gap-0.5">
                <p className="text-[12.5px] text-err flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                  {s.title}
                  <span className="mono ml-auto text-[10px] text-muted">
                    {s.file}:{s.line}
                  </span>
                </p>
                <p className="text-[11.5px] leading-snug text-ink-dim">{s.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No credential-looking literals or .env files were found. Values were never read into this report either way.</Empty>
        )
      ) : null}

      {tab === "files" ? (
        <div className="grid gap-1.5">
          <p className="mono text-[11px] text-muted">
            {report.source.files} files analyzed · {report.source.skipped} skipped (dependencies, binaries, oversized) · {Object.entries(report.source.languages).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
          {mode === "advanced" ? <p className="text-[11px] text-muted">Findings cite file and line so you can check each one. Nothing in the report is derived from running the code.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FlowRow({ step, index }: { step: FlowStep; index: number }) {
  const selectNode = useAgentStore((s) => s.selectNode);
  return (
    <li className={cn("rounded-lg border px-3 py-2 grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 items-start", step.inferred ? "border-dashed border-line" : "border-line surface-1")}>
      <span className="mono text-[11px] text-faint mt-0.5">{index + 1}</span>
      <div className="min-w-0 grid gap-0.5">
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink">
          <button type="button" onClick={() => selectNode(step.id)} className="hover:text-accent-soft text-left">
            {step.label}
          </button>
          {step.inferred ? <Badge tone="sim">inferred</Badge> : <Badge tone="live">seen in code</Badge>}
          {step.category ? <Badge>{step.category}</Badge> : null}
        </p>
        <p className="text-[11.5px] leading-snug text-ink-dim">{step.detail}</p>
        {step.evidence.length ? <EvidenceList evidence={step.evidence} /> : null}
      </div>
    </li>
  );
}

function ToolCard({ tool }: { tool: DetectedTool }) {
  return (
    <li className="rounded-lg border border-line surface-1 px-3 py-2 grid gap-1 min-w-0">
      <p className="flex items-center gap-2 min-w-0">
        <ToolIcon category={tool.category} className="size-3.5 shrink-0 text-muted" />
        <span className="mono text-[12px] text-ink truncate">{tool.name}</span>
        <Badge>{tool.category}</Badge>
        <span className="mono ml-auto text-[10px] text-faint truncate">{tool.declaredWith}</span>
      </p>
      <p className="text-[11.5px] leading-snug text-ink-dim">{tool.description ?? <span className="text-muted">No description in code. The model only sees the name, which weakens tool choice.</span>}</p>
      <p className="mono text-[10px] text-faint truncate">
        {tool.file}:{tool.line}
      </p>
    </li>
  );
}

function Section({ title, items, empty }: { title: string; items: Finding[]; empty: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="label-caps">{title}</p>
      {items.length ? (
        items.map((f) => (
          <div key={f.id} className="rounded-lg border border-line surface-1 px-3 py-2 grid gap-1">
            <p className="flex items-center gap-2 text-[12.5px] text-ink">
              {f.title}
              <Badge tone={f.confidence === "high" ? "ok" : f.confidence === "medium" ? "neutral" : "warn"}>{f.confidence} confidence</Badge>
            </p>
            <p className="text-[11.5px] leading-snug text-ink-dim">{f.detail}</p>
            <EvidenceList evidence={f.evidence} />
          </div>
        ))
      ) : (
        <Empty>{empty}</Empty>
      )}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <ul className="grid gap-0.5">
      {evidence.map((e, i) => (
        <li key={`${e.file}:${e.line}:${i}`} className="mono text-[10.5px] text-muted truncate">
          <span className="text-faint">
            {e.file}:{e.line}
          </span>{" "}
          {e.snippet}
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mono text-[11px] text-muted">{children}</p>;
}

/** The inferred flow as a run-shaped object so the same graph component can draw it. */
export function reportToRun(report: AgentBackendReport): AgentRunState {
  const visual: AgentVisualState = createAgentVisualState();
  visual.nodes = report.graph.nodes.map((n) => ({ id: n.id, kind: n.kind as AgentNodeKind, label: n.label, sublabel: n.sublabel, iteration: n.iteration, tool: n.tool, category: n.category, human: n.kind === "approval" }));
  visual.edges = report.graph.edges;
  for (const n of visual.nodes) {
    // Declared in the code but never executed here, so "queued" rather than "completed".
    visual.nodeState[n.id] = "queued";
    visual.nodeSource[n.id] = report.flow.find((s) => s.id === n.id)?.inferred ? "simulation" : "live";
    visual.pulses[n.id] = 0;
  }
  return {
    id: `report-${report.analyzedAt}`,
    serverRunId: null,
    goal: `How ${report.source.name} processes a request`,
    config: { llmProvider: "claude", tools: report.tools.map((t) => t.name), customTools: [], maxIterations: 0, parallelToolCalls: report.parallelism.length > 0, retry: { maxAttempts: 1, backoffMs: 0 }, approvalRequired: [], fallbacks: {}, ragKbId: null, tokenBudget: null, timeoutMs: 0, temperature: 0, maxOutputTokens: 0, systemPrompt: "", unreliableFailures: 0 },
    scenarioId: null,
    createdAt: report.analyzedAt,
    status: "completed",
    liveDone: true,
    log: [],
    cursor: 0,
    visual,
    playback: "paused",
  };
}
