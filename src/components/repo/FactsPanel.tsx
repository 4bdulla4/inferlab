import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { RepoAnalysis } from "@shared/repo";
import { githubFileUrl, shortPath } from "@/labs/repo/links";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/store/repoStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { EvidenceBadge, EvidenceDot } from "./EvidenceBadge";

type Tab = "routes" | "integrations" | "env" | "schema" | "jobs" | "infra" | "deps" | "files";

export function FactsPanel({ analysis, className }: { analysis: RepoAnalysis; className?: string }) {
  const [tab, setTab] = useState<Tab>("routes");
  const [query, setQuery] = useState("");
  const select = useRepoStore((s) => s.select);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "routes", label: "Routes", count: analysis.routes.length },
    { id: "integrations", label: "Integrations", count: analysis.integrations.length },
    { id: "env", label: "Env vars", count: analysis.envVars.length },
    { id: "schema", label: "Schema", count: analysis.schema.length },
    { id: "jobs", label: "Jobs & workers", count: analysis.jobs.length },
    { id: "infra", label: "Deployment", count: analysis.infra.length },
    { id: "deps", label: "Dependencies", count: analysis.dependencies.length },
    { id: "files", label: "Files", count: analysis.files.length },
  ];
  const q = query.trim().toLowerCase();
  const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));
  const link = (file: string, line?: number) => (
    <span className="inline-flex items-center gap-1 min-w-0">
      <button type="button" onClick={() => select({ kind: "file", id: file })} className="mono text-[11px] text-ink-dim hover:text-ink truncate text-left" title={file}>
        {shortPath(file, 48)}
        {line ? <span className="text-faint">:{line}</span> : null}
      </button>
      <a href={githubFileUrl(analysis, file, line)} target="_blank" rel="noreferrer" className="text-faint hover:text-live shrink-0" aria-label="Open on GitHub">
        <ExternalLink className="size-3" />
      </a>
    </span>
  );

  const files = useMemo(() => [...analysis.files].sort((a, b) => b.symbols.length + b.importedBy.length - (a.symbols.length + a.importedBy.length)), [analysis]);

  return (
    <GlassPanel
      title="Repository facts"
      subtitle="everything below is read from the repository"
      actions={
        <span className="flex items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter…" aria-label="Filter facts" className="mono h-7 w-32 rounded-md border border-line bg-bg-elevated/80 px-2 text-[11px] text-ink placeholder:text-faint" />
          <EvidenceBadge kind="verified" compact />
        </span>
      }
      className={className}
      bodyClassName="p-0 flex flex-col min-h-0"
    >
      <div role="tablist" aria-label="Fact categories" className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("mono h-7 rounded-md px-2 text-[11px] tracking-wide transition-colors", tab === t.id ? "surface-3 text-ink" : "text-muted hover:text-ink-dim")}>
            {t.label} <span className="text-faint">{t.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-3 overflow-y-auto overflow-x-hidden panel-scroll max-h-[420px] grid gap-1.5 text-[12px] min-w-0 [&>*]:min-w-0">
        {tab === "routes" &&
          analysis.routes.filter((r) => match(r.path, r.file, r.handler, r.method)).map((r) => (
            <div key={r.id} className="grid grid-cols-[72px_1fr_1fr] gap-2 items-center border-b border-line/60 pb-1.5">
              <span className={cn("mono text-[10px] rounded px-1 text-center", r.kind === "webhook" ? "bg-warn/20 text-warn" : r.kind === "page" ? "bg-live/15 text-live" : "surface-3 text-ink-dim")}>{r.method}</span>
              <span className="mono text-[11.5px] text-ink truncate min-w-0" title={r.path}>
                {r.path}
                {r.handler ? <span className="text-faint"> → {r.handler}</span> : null}
              </span>
              {link(r.file, r.line)}
            </div>
          ))}
        {tab === "integrations" &&
          analysis.integrations.filter((i) => match(i.name, i.category, ...i.dependencies)).map((i) => (
            <div key={i.id} className="grid gap-1 border-b border-line/60 pb-1.5">
              <p className="flex items-center gap-2 text-ink">
                {i.name} <Badge>{i.category}</Badge>
                <span className="mono text-[10.5px] text-faint">{i.files.length ? `${i.files.length} files` : ""}{i.envVars.length ? ` · env ${i.envVars.join(", ")}` : ""}</span>
              </p>
              <p className="mono text-[10.5px] text-muted flex flex-wrap gap-x-3 gap-y-0.5 min-w-0">
                {i.evidence.slice(0, 4).map((e, k) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <EvidenceDot kind={e.kind} />
                    {e.file ? link(e.file, e.line) : null}
                    <span>{e.note}</span>
                  </span>
                ))}
              </p>
            </div>
          ))}
        {tab === "env" &&
          analysis.envVars.filter((v) => match(v.name, v.category)).map((v) => (
            <div key={v.name} className="grid grid-cols-[1fr_auto] gap-2 items-start border-b border-line/60 pb-1.5">
              <div className="min-w-0">
                <p className="mono text-[11.5px] text-ink flex items-center gap-2">
                  {v.name}
                  <Badge tone={v.category === "secret" ? "err" : v.category === "url" ? "live" : "neutral"}>{v.category}</Badge>
                  {v.declaredIn.length ? <span className="text-[10px] text-faint">declared in {v.declaredIn.map((d) => d.split("/").pop()).join(", ")}</span> : null}
                </p>
                <p className="mono text-[10.5px] text-muted flex flex-wrap gap-x-3">{v.usages.slice(0, 4).map((u) => <span key={`${u.file}${u.line}`}>{link(u.file, u.line)}</span>)}{v.usages.length > 4 ? <span className="text-faint">+{v.usages.length - 4}</span> : null}</p>
              </div>
              <span className="mono text-[10.5px] text-faint">{v.usages.length} uses</span>
            </div>
          ))}
        {tab === "schema" &&
          analysis.schema.filter((s) => match(s.name, s.kind, s.file)).map((s) => (
            <div key={`${s.file}${s.line}${s.name}`} className="grid gap-0.5 border-b border-line/60 pb-1.5">
              <p className="flex items-center gap-2 text-ink">
                <span className="mono">{s.name}</span>
                <Badge>{s.kind}</Badge>
                {link(s.file, s.line)}
              </p>
              <p className="mono text-[10.5px] text-muted truncate min-w-0">{s.fields.slice(0, 16).join(", ")}{s.fields.length > 16 ? ` +${s.fields.length - 16}` : ""}</p>
            </div>
          ))}
        {tab === "jobs" && (analysis.jobs.length === 0 ? <p className="mono text-[11px] text-muted">No cron jobs, queues or workers were detected.</p> : null)}
        {tab === "jobs" &&
          analysis.jobs.filter((j) => match(j.name, j.kind, j.library, j.schedule)).map((j) => (
            <div key={`${j.file}${j.line}${j.name}`} className="grid grid-cols-[64px_1fr_1fr] gap-2 items-center border-b border-line/60 pb-1.5">
              <Badge tone={j.kind === "cron" ? "warn" : "sim"}>{j.kind}</Badge>
              <span className="mono text-[11.5px] text-ink truncate min-w-0">
                {j.name}
                {j.schedule ? <span className="text-faint"> [{j.schedule}]</span> : null}
                <span className="text-faint"> · {j.library}</span>
              </span>
              {link(j.file, j.line)}
            </div>
          ))}
        {tab === "infra" && (analysis.infra.length === 0 ? <p className="mono text-[11px] text-muted">No deployment configuration files were found.</p> : null)}
        {tab === "infra" &&
          analysis.infra.filter((c) => match(c.kind, c.file, c.summary)).map((c) => (
            <div key={c.file} className="grid gap-0.5 border-b border-line/60 pb-1.5">
              <p className="flex items-center gap-2 text-ink">
                <Badge>{c.kind}</Badge>
                {link(c.file)}
              </p>
              <p className="text-[11.5px] text-ink-dim">{c.summary}</p>
              {Object.entries(c.details).filter(([, v]) => (Array.isArray(v) ? v.length : v !== "" && v !== false)).slice(0, 4).map(([k, v]) => (
                <p key={k} className="mono text-[10.5px] text-muted truncate">
                  {k}: {Array.isArray(v) ? v.join(", ") : String(v)}
                </p>
              ))}
            </div>
          ))}
        {tab === "deps" &&
          analysis.dependencies.filter((d) => match(d.name, d.manifest, d.ecosystem)).slice(0, 400).map((d) => (
            <div key={`${d.manifest}${d.name}`} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center border-b border-line/60 pb-1">
              <span className="mono text-[11.5px] text-ink truncate min-w-0">{d.name}</span>
              <span className="mono text-[10.5px] text-muted">{d.version ?? ""}</span>
              <span className="mono text-[10px] text-faint">{d.dev ? "dev · " : ""}{d.ecosystem} · {d.manifest.split("/").pop()}</span>
            </div>
          ))}
        {tab === "files" &&
          files.filter((f) => match(f.path, f.language, ...f.roles)).slice(0, 400).map((f) => (
            <div key={f.path} className="grid grid-cols-[1fr_auto] gap-2 items-center border-b border-line/60 pb-1">
              <span className="flex items-center gap-2 min-w-0">
                {link(f.path)}
                <span className="mono text-[9.5px] text-faint truncate">{f.roles.join(" ")}</span>
              </span>
              <span className="mono text-[10px] text-faint">{f.scanned ? `${f.symbols.length} sym · ${f.importedBy.length} refs` : "not fetched"}</span>
            </div>
          ))}
      </div>
    </GlassPanel>
  );
}
