import { useEffect, useRef, useState, type DragEvent } from "react";
import { Database, FileUp, Loader2, RefreshCw, Table2, Type } from "lucide-react";
import { ML_LIMITS } from "@shared/ml";
import { mlRuntime } from "@/engine/ml/mlRuntime";
import { cn } from "@/lib/cn";
import { selectDataset, useMLStore } from "@/store/mlStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Histogram } from "./MLVisuals";

type Mode = "samples" | "upload" | "paste";

const ACCEPT = ".csv,.tsv,.txt,.json,text/csv,application/json,text/plain";

const PASTE_EXAMPLE = `hours_studied,sleep_hours,attended_review,passed
2,6,no,no
7,7,yes,yes
4,5,no,no
9,8,yes,yes
5,7,yes,yes
1,4,no,no
6,6,no,yes
8,5,yes,yes
3,8,no,no
7,6,yes,yes`;

/**
 * Where the rows come from: a sample table, a dropped CSV or JSON file, or
 * pasted text. Under it, the chosen table itself: columns with their types,
 * a distribution for the column in focus, and the first rows.
 */
export function MLDatasetPanel({ className }: { className?: string }) {
  const status = useMLStore((s) => s.status);
  const statusError = useMLStore((s) => s.statusError);
  const datasets = useMLStore((s) => s.datasets);
  const datasetId = useMLStore((s) => s.datasetId);
  const dataset = useMLStore(selectDataset);
  const rows = useMLStore((s) => s.datasetRows);
  const select = useMLStore((s) => s.selectDataset);
  const uploading = useMLStore((s) => s.uploading);
  const uploadError = useMLStore((s) => s.uploadError);
  const focusColumn = useMLStore((s) => s.focusColumn);
  const setFocusColumn = useMLStore((s) => s.setFocusColumn);
  const [mode, setMode] = useState<Mode>("samples");
  const [text, setText] = useState("");
  const [name, setName] = useState("pasted.csv");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The API restarts whenever a server file is edited. If the page happened to
  // load during that window, this gets the lab going again without a reload.
  const retry = async () => {
    setRetrying(true);
    await mlRuntime.refreshStatus();
    setRetrying(false);
  };

  useEffect(() => {
    if (datasetId) void mlRuntime.loadRows(datasetId);
  }, [datasetId]);

  const onFiles = (files: FileList | File[] | null) => {
    const file = files ? Array.from(files)[0] : undefined;
    if (!file) return;
    const limit = status?.limits.maxUploadBytes ?? ML_LIMITS.maxUploadBytes;
    if (file.size > limit) {
      setError(`${file.name} is larger than ${Math.round(limit / (1024 * 1024))} MB.`);
      return;
    }
    setError(null);
    void mlRuntime.upload(file).catch((err: unknown) => setError(err instanceof Error ? err.message : "Upload failed."));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  const uploads = datasets.filter((d) => d.origin === "upload");
  const columns = dataset?.columns ?? [];
  const focus = columns.find((c) => c.name === focusColumn) ?? columns[0];

  return (
    <GlassPanel
      className={className}
      title="Dataset"
      subtitle={dataset ? `${dataset.rows.toLocaleString()} rows × ${dataset.columns.length} columns` : statusError ? "service unreachable" : status ? "pick a table" : "connecting…"}
      actions={
        <>
          {dataset?.synthetic ? (
            <span title="Generated for the lab with a known recipe, not collected from the world">
              <Badge tone="sim">synthetic sample</Badge>
            </span>
          ) : null}
          <SourceBadge source="live" compact />
        </>
      }
      bodyClassName="p-3.5 grid gap-3 content-start"
    >
      <Segmented<Mode>
        ariaLabel="Dataset source"
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: "samples", label: "Samples" },
          { value: "upload", label: "Upload" },
          { value: "paste", label: "Paste" },
        ]}
      />

      {mode === "samples" ? (
        <ul className="grid gap-1.5 sm:grid-cols-3">
          {(status?.samples ?? []).map((s) => {
            const active = datasetId === s.id;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => select(s.id)} aria-pressed={active} className={cn("w-full h-full text-left rounded-lg border px-3 py-2 grid gap-0.5 min-w-0", active ? "border-accent/60 bg-accent/[0.08]" : "border-line surface-1 hover:border-line-strong")}>
                  <span className="flex items-center gap-2 min-w-0">
                    <Database className="size-3.5 text-accent-soft shrink-0" aria-hidden="true" />
                    <span className="text-[12.5px] text-ink truncate">{s.name}</span>
                  </span>
                  <span className="mono text-[10px] text-muted">
                    {s.task} · {s.rows} rows · target {s.suggestedTarget}
                  </span>
                  <span className="text-[11px] leading-snug text-muted line-clamp-2">{s.description}</span>
                </button>
              </li>
            );
          })}
          {!status && !statusError ? <li className="mono text-[11px] text-muted flex items-center gap-2 py-2"><Loader2 className="size-3 animate-spin" aria-hidden="true" /> loading samples…</li> : null}
          {statusError ? (
            <li className="sm:col-span-3 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-err">{statusError}</span>
              <Button size="sm" variant="outline" icon={retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />} disabled={retrying} onClick={() => void retry()}>
                Try again
              </Button>
            </li>
          ) : null}
          {uploads.length ? (
            <li className="sm:col-span-3 grid gap-1.5">
              <p className="label-caps">Your uploads · kept 2 hours on this machine</p>
              <ul className="flex flex-wrap gap-1.5">
                {uploads.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => select(d.id)} aria-pressed={datasetId === d.id} className={cn("mono rounded-md border px-2 h-7 text-[11px] inline-flex items-center gap-1.5", datasetId === d.id ? "border-accent/60 bg-accent/[0.08] text-ink" : "border-line text-ink-dim hover:border-line-strong")}>
                      <FileUp className="size-3" aria-hidden="true" />
                      {d.name} <span className="text-faint">{d.rows} rows</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}

      {mode === "upload" ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn("grid place-items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center cursor-pointer", dragging ? "border-accent bg-accent/[0.06]" : "border-line-strong hover:border-accent/60")}
        >
          <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
          {uploading ? <Loader2 className="size-5 text-accent-soft animate-spin" aria-hidden="true" /> : <FileUp className="size-5 text-accent-soft" aria-hidden="true" />}
          <p className="text-[13px] text-ink">Drop a CSV or JSON file, or click to choose</p>
          <p className="mono text-[10.5px] text-muted">
            up to {Math.round((status?.limits.maxUploadBytes ?? ML_LIMITS.maxUploadBytes) / (1024 * 1024))} MB · {(status?.limits.maxRows ?? ML_LIMITS.maxRows).toLocaleString()} rows · {status?.limits.maxColumns ?? ML_LIMITS.maxColumns} columns · header row required · JSON as an array of flat objects
          </p>
          <p className="text-[10.5px] text-faint">Parsed and trained on this machine only; gone two hours after you stop.</p>
        </div>
      ) : null}

      {mode === "paste" ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setError(null);
            void mlRuntime.paste(name.trim() || "pasted.csv", text).catch((err: unknown) => setError(err instanceof Error ? err.message : "Paste failed."));
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} placeholder={"header1,header2,target\n1.2,red,yes\n…"} aria-label="Pasted table" className="mono w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[11.5px] leading-snug text-ink placeholder:text-faint focus:border-accent/60" />
          <div className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name for the pasted table" className="mono h-7 w-40 rounded-md border border-line bg-bg-elevated/80 px-2 text-[11px] text-ink focus:border-accent/60" />
            <Button type="submit" size="sm" variant="primary" icon={uploading ? <Loader2 className="animate-spin" /> : <Type />} disabled={!text.trim() || uploading}>
              Add table
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setText(PASTE_EXAMPLE)}>
              Example
            </Button>
          </div>
        </form>
      ) : null}

      {error || uploadError ? <p className="text-[12px] leading-snug text-err">{error ?? uploadError}</p> : null}

      {dataset ? (
        <div className="grid gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="label-caps">Columns · click one to see its distribution</p>
            <Button size="sm" variant="ghost" icon={<Table2 />} className="ml-auto" onClick={() => setTableOpen((o) => !o)} aria-expanded={tableOpen}>
              {tableOpen ? "Hide rows" : `First ${Math.min(rows?.rows.length ?? dataset.sampleRows.length, 200)} rows`}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {columns.map((c) => (
              <button key={c.name} type="button" onClick={() => setFocusColumn(c.name)} className={cn("mono rounded-md border px-2 h-6 text-[10.5px] inline-flex items-center gap-1.5", focus?.name === c.name ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-muted hover:border-line-strong")} title={`${c.type} · ${c.unique} unique · ${c.missing} missing`}>
                {c.name}
                <span className="text-faint">{c.type}</span>
                {c.missing ? <span className="text-warn">{c.missing}∅</span> : null}
              </button>
            ))}
          </div>
          {focus ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
              <Histogram column={focus} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mono text-[10.5px]">
                <dt className="text-muted">type</dt>
                <dd className="text-ink-dim">{focus.type}</dd>
                <dt className="text-muted">unique</dt>
                <dd className="text-ink-dim">{focus.unique}</dd>
                <dt className="text-muted">missing</dt>
                <dd className={focus.missing ? "text-warn" : "text-ink-dim"}>{focus.missing}</dd>
                {focus.stats ? (
                  <>
                    <dt className="text-muted">min · max</dt>
                    <dd className="text-ink-dim">
                      {focus.stats.min.toFixed(2)} · {focus.stats.max.toFixed(2)}
                    </dd>
                    <dt className="text-muted">mean · std</dt>
                    <dd className="text-ink-dim">
                      {focus.stats.mean.toFixed(3)} · {focus.stats.std.toFixed(3)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted">examples</dt>
                <dd className="text-ink-dim truncate">{focus.examples.join(", ")}</dd>
              </dl>
            </div>
          ) : null}
          {tableOpen ? (
            <div className="overflow-auto panel-scroll max-h-[260px] rounded-lg border border-line">
              <table className="mono text-[10.5px] min-w-full">
                <thead className="sticky top-0 surface-2">
                  <tr>
                    {(rows?.columns ?? columns.map((c) => c.name)).map((c) => (
                      <th key={c} className="text-left font-normal text-muted px-2 py-1 whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(rows?.rows ?? dataset.sampleRows).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {r.map((cell, j) => (
                        <td key={j} className={cn("px-2 py-0.5 whitespace-nowrap", cell === "" ? "text-err/70 italic" : "text-ink-dim")}>
                          {cell === "" ? "missing" : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {dataset.note ? <p className="text-[11px] leading-snug text-muted">{dataset.note}</p> : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}
