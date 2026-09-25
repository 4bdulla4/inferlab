import { ArrowDownLeft, ArrowUpRight, ExternalLink, FileCode2, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ArchNode, RepoAnalysis, RepoFile, TraceStep } from "@shared/repo";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/labs/repo/layout";
import { githubFileUrl, shortPath } from "@/labs/repo/links";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/store/repoStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { EvidenceBadge, EvidenceDot } from "./EvidenceBadge";

export function RepoInspector({ analysis, className }: { analysis: RepoAnalysis | null; className?: string }) {
  const selection = useRepoStore((s) => s.selection);
  const select = useRepoStore((s) => s.select);
  const trace = useRepoStore((s) => s.trace);
  const cursor = useRepoStore((s) => s.traceCursor);
  const step = trace && cursor >= 0 ? trace.steps[cursor] : undefined;

  const effective = selection ?? (step?.nodeId ? { kind: "node" as const, id: step.nodeId } : null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [effective?.kind, effective?.id, step?.index]);

  return (
    <GlassPanel
      bodyRef={bodyRef}
      title="Inspector"
      subtitle={selection ? "pinned" : step ? `trace step ${step.index}` : undefined}
      actions={
        selection ? (
          <button type="button" onClick={() => select(null)} aria-label="Unpin inspector" className="size-7 inline-flex items-center justify-center rounded-md border border-line text-muted hover:text-ink">
            <X className="size-3.5" />
          </button>
        ) : null
      }
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll content-start"
    >
      {!analysis ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Analyze a repository, then click any module in the diagram, any file, or any trace step to see where it is implemented, what calls it and what it calls.</p>
      ) : step && !selection ? (
        <TraceStepDetail analysis={analysis} step={step} />
      ) : effective?.kind === "node" ? (
        <NodeDetail analysis={analysis} nodeId={effective.id} />
      ) : effective?.kind === "file" ? (
        <FileDetail analysis={analysis} path={effective.id} />
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted">Click a module in the diagram to inspect its files, routes, symbols, callers and dependencies.</p>
      )}
    </GlassPanel>
  );
}

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-line min-w-0">
      <summary className="cursor-pointer select-none flex items-center gap-2 px-3 h-8 label-caps">
        <span>{title}</span>
        {count !== undefined ? <span className="text-faint">{count}</span> : null}
      </summary>
      <div className="border-t border-line p-3 grid gap-1.5 min-w-0 [&>*]:min-w-0">{children}</div>
    </details>
  );
}

function FileLink({ analysis, path, line, onSelect }: { analysis: RepoAnalysis; path: string; line?: number; onSelect?: () => void }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <button type="button" onClick={onSelect} className="mono text-[11.5px] text-ink-dim hover:text-ink truncate text-left" title={path}>
        {shortPath(path)}
        {line ? <span className="text-faint">:{line}</span> : null}
      </button>
      <a href={githubFileUrl(analysis, path, line)} target="_blank" rel="noreferrer" className="text-faint hover:text-live shrink-0" aria-label={`Open ${path} on GitHub`}>
        <ExternalLink className="size-3" />
      </a>
    </span>
  );
}

function NodeDetail({ analysis, nodeId }: { analysis: RepoAnalysis; nodeId: string }) {
  const select = useRepoStore((s) => s.select);
  const mode = useUIStore((s) => s.mode);
  const node = analysis.graph.nodes.find((n) => n.id === nodeId);
  const filesByPath = useMemo(() => new Map(analysis.files.map((f) => [f.path, f])), [analysis]);
  if (!node) return <p className="mono text-[11px] text-muted">Module not found in this analysis.</p>;
  const incoming = analysis.graph.edges.filter((e) => e.to === node.id);
  const outgoing = analysis.graph.edges.filter((e) => e.from === node.id);
  const routes = analysis.routes.filter((r) => node.routes.includes(r.id));
  const integrations = analysis.integrations.filter((i) => node.integrations.includes(i.id));
  const nodeLabel = (id: string) => analysis.graph.nodes.find((n) => n.id === id)?.label ?? id;
  const symbolsByFile = new Map<string, ArchNode["symbols"]>();
  for (const s of node.symbols) {
    if (!symbolsByFile.has(s.file)) symbolsByFile.set(s.file, []);
    symbolsByFile.get(s.file)!.push(s);
  }

  return (
    <>
      <header className="grid gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[node.category] }} aria-hidden="true" />
          <h3 className="text-[15px] font-semibold text-ink leading-tight">{node.label}</h3>
          <Badge className="ml-auto">{CATEGORY_LABEL[node.category]}</Badge>
        </div>
        <div className="rounded-lg border border-ok/30 bg-ok/[0.05] p-3 grid gap-1">
          <div className="flex items-center gap-2"><EvidenceBadge kind="verified" compact /><span className="mono text-[10.5px] text-muted">from repository facts</span></div>
          <p className="text-[12.5px] text-ink-dim leading-relaxed">{node.summary}</p>
        </div>
        {node.aiSummary ? (
          <div className="rounded-lg border border-sim/30 bg-sim/[0.05] p-3 grid gap-1">
            <div className="flex items-center gap-2"><EvidenceBadge kind="ai" compact /><span className="mono text-[10.5px] text-muted">role in the product · {analysis.ai.model}</span></div>
            <p className="text-[12.5px] text-ink-dim leading-relaxed">{node.aiSummary}</p>
          </div>
        ) : mode === "advanced" ? (
          <p className="mono text-[10.5px] text-faint">{analysis.ai.available ? "No AI summary returned for this module." : "AI role summaries need ANTHROPIC_API_KEY on the server."}</p>
        ) : null}
      </header>

      {incoming.length + outgoing.length > 0 ? (
        <Section title="Relationships" count={incoming.length + outgoing.length}>
          {incoming.map((e) => (
            <div key={e.id} className="grid grid-cols-[14px_1fr] gap-2 items-start">
              <ArrowDownLeft className="size-3.5 text-muted mt-0.5" aria-label="incoming" />
              <div className="min-w-0">
                <button type="button" onClick={() => select({ kind: "node", id: e.from })} className="text-[12px] text-ink hover:text-live text-left">
                  {nodeLabel(e.from)} <span className="text-muted">{e.label}</span> this
                </button>
                <p className="mono text-[10.5px] text-faint flex items-center gap-1.5 flex-wrap">
                  <EvidenceDot kind={e.evidence.kind} /> {e.evidence.kind}{e.weight > 1 ? ` · ×${e.weight}` : ""}
                  {e.evidence.file ? <FileLink analysis={analysis} path={e.evidence.file} line={e.evidence.line} onSelect={() => select({ kind: "file", id: e.evidence.file! })} /> : e.evidence.note ? <span className="truncate">{e.evidence.note}</span> : null}
                </p>
              </div>
            </div>
          ))}
          {outgoing.map((e) => (
            <div key={e.id} className="grid grid-cols-[14px_1fr] gap-2 items-start">
              <ArrowUpRight className="size-3.5 text-muted mt-0.5" aria-label="outgoing" />
              <div className="min-w-0">
                <button type="button" onClick={() => select({ kind: "node", id: e.to })} className="text-[12px] text-ink hover:text-live text-left">
                  this <span className="text-muted">{e.label}</span> {nodeLabel(e.to)}
                </button>
                <p className="mono text-[10.5px] text-faint flex items-center gap-1.5 flex-wrap">
                  <EvidenceDot kind={e.evidence.kind} /> {e.evidence.kind}{e.weight > 1 ? ` · ×${e.weight}` : ""}
                  {e.evidence.file ? <FileLink analysis={analysis} path={e.evidence.file} line={e.evidence.line} onSelect={() => select({ kind: "file", id: e.evidence.file! })} /> : e.evidence.note ? <span className="truncate">{e.evidence.note}</span> : null}
                </p>
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {routes.length ? (
        <Section title="Routes" count={routes.length}>
          {routes.map((r) => (
            <div key={r.id} className="grid gap-0.5">
              <p className="mono text-[11.5px] text-ink flex items-center gap-2">
                <span className={cn("rounded px-1 text-[10px]", r.kind === "webhook" ? "bg-warn/20 text-warn" : "surface-3 text-ink-dim")}>{r.method}</span>
                <span className="truncate">{r.path}</span>
                {r.handler ? <span className="text-faint truncate">→ {r.handler}</span> : null}
              </p>
              <FileLink analysis={analysis} path={r.file} line={r.line} onSelect={() => select({ kind: "file", id: r.file })} />
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Files" count={node.files.length} defaultOpen={node.files.length <= 25}>
        {node.files.slice(0, 80).map((p) => {
          const f = filesByPath.get(p);
          return (
            <div key={p} className="flex items-center gap-2 min-w-0">
              <FileCode2 className="size-3 text-faint shrink-0" aria-hidden="true" />
              <FileLink analysis={analysis} path={p} onSelect={() => select({ kind: "file", id: p })} />
              {f && f.nodeId && f.nodeId !== node.id ? <span className="mono text-[9.5px] text-faint shrink-0" title="primary module">via {nodeLabel(f.nodeId)}</span> : null}
              {f ? <span className="ml-auto mono text-[10px] text-faint shrink-0">{f.symbols.length ? `${f.symbols.length} sym` : ""}</span> : null}
            </div>
          );
        })}
        {node.files.length > 80 ? <p className="mono text-[10.5px] text-faint">+{node.files.length - 80} more</p> : null}
      </Section>

      {node.symbols.length ? (
        <Section title="Functions & classes" count={node.symbols.length} defaultOpen={node.symbols.length <= 30}>
          {[...symbolsByFile.entries()].slice(0, 30).map(([file, syms]) => (
            <div key={file} className="grid gap-0.5 min-w-0">
              <FileLink analysis={analysis} path={file} onSelect={() => select({ kind: "file", id: file })} />
              <p className="mono text-[11px] text-ink-dim flex flex-wrap gap-x-2 gap-y-0.5 pl-3 min-w-0 break-all">
                {syms.slice(0, 14).map((s) => (
                  <a key={`${s.name}${s.line}`} href={githubFileUrl(analysis, file, s.line)} target="_blank" rel="noreferrer" className="hover:text-live" title={`${s.kind} · line ${s.line}`}>
                    {s.name}
                    <span className="text-faint">{s.kind === "class" ? "" : "()"}</span>
                  </a>
                ))}
                {syms.length > 14 ? <span className="text-faint">+{syms.length - 14}</span> : null}
              </p>
            </div>
          ))}
        </Section>
      ) : null}

      {node.envVars.length ? (
        <Section title="Environment variables" count={node.envVars.length}>
          <p className="mono text-[11px] text-ink-dim flex flex-wrap gap-1.5">
            {node.envVars.map((v) => {
              const ev = analysis.envVars.find((x) => x.name === v);
              return (
                <span key={v} className={cn("rounded border px-1", ev?.category === "secret" ? "border-err/40 text-err/90" : "border-line")} title={ev ? `${ev.category} · ${ev.usages.length} usages` : undefined}>
                  {v}
                </span>
              );
            })}
          </p>
        </Section>
      ) : null}

      {integrations.length || node.dependencies.length ? (
        <Section title="Dependencies & integrations" count={integrations.length + node.dependencies.length}>
          {integrations.map((i) => (
            <div key={i.id} className="grid gap-0.5 min-w-0">
              <p className="text-[12px] text-ink flex items-center gap-2">
                {i.name} <Badge>{i.category}</Badge>
              </p>
              {i.evidence.slice(0, 3).map((ev, k) => (
                <p key={k} className="mono text-[10.5px] text-faint flex items-center gap-1.5 min-w-0">
                  <EvidenceDot kind={ev.kind} />
                  {ev.file ? <FileLink analysis={analysis} path={ev.file} line={ev.line} onSelect={() => select({ kind: "file", id: ev.file! })} /> : null}
                  <span className="truncate">{ev.note}</span>
                </p>
              ))}
            </div>
          ))}
          {node.dependencies.length ? <p className="mono text-[10.5px] text-muted break-all min-w-0">{node.dependencies.slice(0, 20).join(", ")}</p> : null}
        </Section>
      ) : null}

      <Section title="Evidence" count={node.evidence.length} defaultOpen={false}>
        {node.evidence.slice(0, 10).map((ev, k) => (
          <p key={k} className="mono text-[10.5px] text-muted flex items-center gap-1.5 flex-wrap min-w-0">
            <EvidenceDot kind={ev.kind} />
            {ev.file ? <FileLink analysis={analysis} path={ev.file} line={ev.line} onSelect={() => select({ kind: "file", id: ev.file! })} /> : null}
            <span>{ev.note}</span>
          </p>
        ))}
      </Section>
    </>
  );
}

function FileDetail({ analysis, path }: { analysis: RepoAnalysis; path: string }) {
  const select = useRepoStore((s) => s.select);
  const file = analysis.files.find((f) => f.path === path);
  if (!file) return <p className="mono text-[11px] text-muted">File not in the index.</p>;
  const node = file.nodeId ? analysis.graph.nodes.find((n) => n.id === file.nodeId) : analysis.graph.nodes.find((n) => n.files.includes(path));
  const routes = analysis.routes.filter((r) => r.file === path);
  const env = analysis.envVars.filter((v) => v.usages.some((u) => u.file === path));
  const internal = file.imports.filter((i) => i.resolved);
  const external = file.imports.filter((i) => i.external);
  return (
    <>
      <header className="grid gap-2">
        <div className="flex items-start gap-2">
          <FileCode2 className="size-4 text-live mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="mono text-[13px] text-ink break-all min-w-0">{path}</h3>
            <p className="mono text-[10.5px] text-muted">{file.language} · {file.loc} lines · {file.scanned ? "scanned" : "listed only (not fetched)"}</p>
          </div>
          <a href={githubFileUrl(analysis, path)} target="_blank" rel="noreferrer" className="ml-auto shrink-0 inline-flex items-center gap-1 mono text-[10.5px] text-live hover:underline">
            GitHub <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <EvidenceBadge kind="verified" compact />
          {file.roles.map((r) => (
            <Badge key={r}>{r}</Badge>
          ))}
          {node ? (
            <button type="button" onClick={() => select({ kind: "node", id: node.id })} className="mono text-[10.5px] text-ink-dim hover:text-ink underline-offset-2 hover:underline">
              module: {node.label}
            </button>
          ) : null}
        </div>
      </header>
      {routes.length ? (
        <Section title="Routes defined here" count={routes.length}>
          {routes.map((r) => (
            <p key={r.id} className="mono text-[11.5px] text-ink flex items-center gap-2">
              <span className="rounded surface-3 px-1 text-[10px] text-ink-dim">{r.method}</span>
              <span className="truncate">{r.path}</span>
              <a href={githubFileUrl(analysis, r.file, r.line)} target="_blank" rel="noreferrer" className="text-faint hover:text-live">:{r.line}</a>
            </p>
          ))}
        </Section>
      ) : null}
      <Section title="Symbols" count={file.symbols.length} defaultOpen={file.symbols.length <= 40}>
        {file.symbols.length === 0 ? <p className="mono text-[10.5px] text-faint">No functions or classes detected.</p> : null}
        {file.symbols.map((s) => (
          <a key={`${s.name}${s.line}`} href={githubFileUrl(analysis, path, s.line)} target="_blank" rel="noreferrer" className="mono text-[11.5px] flex items-center gap-2 hover:text-live text-ink-dim">
            <span className="text-faint w-10 shrink-0 text-right">L{s.line}</span>
            <span className={cn("shrink-0 rounded px-1 text-[9.5px] uppercase tracking-[0.08em]", s.kind === "component" ? "bg-live/15 text-live" : s.kind === "class" ? "bg-accent/20 text-accent-soft" : "surface-3 text-muted")}>{s.kind}</span>
            <span className="truncate">{s.name}{s.signature ?? ""}</span>
            {s.exported ? <span className="text-faint text-[9.5px]">exported</span> : null}
          </a>
        ))}
      </Section>
      <Section title="Imports (what it calls)" count={file.imports.length} defaultOpen={internal.length <= 25}>
        {internal.map((i) => (
          <div key={`${i.source}${i.line}`} className="flex items-center gap-2 min-w-0">
            <span className="mono text-[10px] text-faint w-10 shrink-0 text-right">L{i.line}</span>
            <FileLink analysis={analysis} path={i.resolved!} onSelect={() => select({ kind: "file", id: i.resolved! })} />
          </div>
        ))}
        {external.length ? <p className="mono text-[10.5px] text-muted break-words pt-1">packages: {[...new Set(external.map((i) => i.source))].slice(0, 25).join(", ")}</p> : null}
      </Section>
      <Section title="Imported by (what calls it)" count={file.importedBy.length} defaultOpen={file.importedBy.length <= 20}>
        {file.importedBy.length === 0 ? <p className="mono text-[10.5px] text-faint">No scanned file imports this one (entry point, page, or dynamically loaded).</p> : null}
        {file.importedBy.slice(0, 60).map((p) => (
          <FileLink key={p} analysis={analysis} path={p} onSelect={() => select({ kind: "file", id: p })} />
        ))}
      </Section>
      {env.length ? (
        <Section title="Environment variables used" count={env.length}>
          <p className="mono text-[11px] text-ink-dim flex flex-wrap gap-1.5">
            {env.map((v) => (
              <span key={v.name} className={cn("rounded border px-1", v.category === "secret" ? "border-err/40 text-err/90" : "border-line")}>{v.name}</span>
            ))}
          </p>
        </Section>
      ) : null}
    </>
  );
}

function TraceStepDetail({ analysis, step }: { analysis: RepoAnalysis; step: TraceStep }) {
  const select = useRepoStore((s) => s.select);
  const node = step.nodeId ? analysis.graph.nodes.find((n) => n.id === step.nodeId) : undefined;
  const edge = step.edgeId ? analysis.graph.edges.find((e) => e.id === step.edgeId) : undefined;
  const file: RepoFile | undefined = step.file ? analysis.files.find((f) => f.path === step.file) : undefined;
  return (
    <>
      <header className="grid gap-2">
        <div className="flex items-center gap-2">
          <span className="mono text-[11px] text-faint">step {step.index}</span>
          <EvidenceBadge kind={step.kind} compact />
        </div>
        <h3 className="text-[15px] font-semibold text-ink leading-tight">{step.title}</h3>
        <p className="text-[12.5px] text-ink-dim leading-relaxed">{step.description}</p>
      </header>
      <Section title="Verification">
        <Check ok={step.verification.nodeExists} label={node ? `module ${node.label}` : "module reference"} missing={!step.nodeId} />
        <Check ok={step.verification.fileExists} label={step.file ? `file ${step.file}` : "file reference"} missing={!step.file} />
        <Check ok={step.verification.symbolExists} label={step.symbol ? `symbol ${step.symbol}()` : "symbol reference"} missing={!step.symbol} />
        {edge ? <p className="mono text-[10.5px] text-muted flex items-center gap-1.5"><EvidenceDot kind={edge.evidence.kind} /> relationship {edge.from} → {edge.to} ({edge.kind}, {edge.evidence.kind})</p> : null}
      </Section>
      {file ? (
        <Section title="Location">
          <FileLink analysis={analysis} path={file.path} line={step.line} onSelect={() => select({ kind: "file", id: file.path })} />
          {step.symbol && file.symbols.find((s) => s.name === step.symbol) ? (
            <p className="mono text-[11px] text-ink-dim">
              {step.symbol}
              {file.symbols.find((s) => s.name === step.symbol)?.signature ?? "()"} · line {file.symbols.find((s) => s.name === step.symbol)?.line}
            </p>
          ) : null}
          <p className="mono text-[10.5px] text-faint">{file.roles.join(", ")} · imports {file.imports.filter((i) => i.resolved).length} internal files · imported by {file.importedBy.length}</p>
        </Section>
      ) : null}
      {node ? (
        <button type="button" onClick={() => select({ kind: "node", id: node.id })} className="mono text-[11px] text-live hover:underline text-left">
          Open module {node.label} →
        </button>
      ) : null}
    </>
  );
}

function Check({ ok, label, missing }: { ok: boolean; label: string; missing: boolean }) {
  if (missing) return <p className="mono text-[10.5px] text-faint">— no {label}</p>;
  return (
    <p className={cn("mono text-[10.5px] flex items-center gap-1.5", ok ? "text-ok" : "text-warn")}>
      <span aria-hidden="true">{ok ? "✓" : "⚠"}</span>
      {label} {ok ? "exists in repository" : "not found in repository index"}
    </p>
  );
}
