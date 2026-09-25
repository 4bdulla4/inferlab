import { useRef, useState, type DragEvent } from "react";
import { FileText, FileUp, Files, Globe, Loader2, RefreshCw, Trash2, Type } from "lucide-react";
import type { RagDocument } from "@shared/rag";
import { ragRuntime } from "@/engine/rag/ragRuntime";
import { cn } from "@/lib/cn";
import { formatNumber, formatTime } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SideDrawer } from "@/components/layout/SideDrawer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

type Mode = "upload" | "paste" | "url";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLE_TEXT = `The sky appears blue because of Rayleigh scattering. Sunlight is made of many wavelengths; when it enters the atmosphere it collides with gas molecules far smaller than the wavelength of light. Shorter wavelengths scatter much more strongly than longer ones, roughly in proportion to the inverse fourth power of wavelength, so blue light is redirected across the whole sky while red light mostly passes straight through.

At sunrise and sunset the light path through the atmosphere is far longer. Most of the blue has been scattered out of the beam before it reaches an observer, leaving the reds and oranges that colour the horizon. Clouds look white because their water droplets are much larger than a wavelength and scatter all colours about equally.

Violet light scatters even more strongly than blue, yet the sky does not look violet. Part of the reason is that sunlight contains less violet to begin with, part is that some violet is absorbed high in the atmosphere, and part is that human eyes are far more sensitive to blue than to violet, so the mixture reads as sky blue.

On Mars the daytime sky is a butterscotch tan rather than blue. The thin Martian atmosphere holds fine dust that is comparable in size to visible wavelengths, so it scatters by Mie scattering, which favours no colour in particular and tints everything with the dust's own iron-oxide hue. Martian sunsets, by contrast, glow blue near the sun because that same dust forward-scatters blue light along the line of sight.

The ocean is blue for a different reason than the sky. Water absorbs red and orange light within a few metres of the surface while transmitting blue, so light returning from depth is depleted of warm colours. Near shore the water can look green or brown because sediment and phytoplankton add their own scattering and absorption, and a shallow sandy bottom reflects light back before the red has been absorbed.

Rayleigh scattering also explains why distant mountains look bluish and washed out. Light from the mountain travels through a long column of air whose molecules scatter extra blue light toward the viewer while the mountain's own reflected light is dimmed, an effect painters call atmospheric perspective. The farther the ridge, the paler and bluer it appears, which is how the eye judges depth in a landscape.`;

/**
 * Where knowledge comes from: files, pasted text or a page. What is already
 * indexed lives in a drawer rather than under the dropzone, so this panel keeps
 * a fixed height however many documents pile up.
 */
export function KnowledgeSourcePanel({ className }: { className?: string }) {
  const kb = useRagStore((s) => s.kb);
  const kbStatus = useRagStore((s) => s.kbStatus);
  const kbError = useRagStore((s) => s.kbError);
  const ingesting = useRagStore((s) => s.ingesting);
  const [mode, setMode] = useState<Mode>("upload");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const onFiles = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const limit = useRagStore.getState().service?.limits.maxUploadBytes ?? 25 * 1024 * 1024;
    // One at a time: each becomes its own visible ingestion run.
    void (async () => {
      for (const file of list) {
        if (file.size > limit) {
          setError(`${file.name} is larger than ${Math.round(limit / (1024 * 1024))} MB.`);
          continue;
        }
        await run(() => ragRuntime.uploadFile(file));
      }
    })();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  const docs = kb?.documents ?? [];

  return (
    <>
      <GlassPanel
        title="Knowledge sources"
        subtitle={kb ? `${formatNumber(kb.chunks.length)} chunks · ${formatNumber(kb.totalTokens)} tokens` : "what the system is allowed to know"}
        actions={
          <>
            {kb?.stale ? (
              <Button size="sm" variant="live" icon={ingesting ? <Loader2 className="animate-spin" /> : <RefreshCw />} disabled={ingesting} onClick={() => void run(() => ragRuntime.rebuild())} title="Chunking or embedding settings changed; the index no longer matches">
                Rebuild
              </Button>
            ) : null}
            <Button size="sm" variant="outline" icon={<Files />} disabled={docs.length === 0} onClick={() => setListOpen(true)} aria-haspopup="dialog" aria-expanded={listOpen}>
              {docs.length} doc{docs.length === 1 ? "" : "s"}
            </Button>
          </>
        }
        className={className}
        bodyClassName="p-3.5 grid gap-2.5 content-start"
      >
        {kbStatus === "error" ? <p className="text-[12px] text-err">{kbError ?? "The RAG service is unreachable."}</p> : null}

        <Segmented
          ariaLabel="Source type"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "upload", label: "Upload" },
            { value: "paste", label: "Paste text" },
            { value: "url", label: "Web page" },
          ]}
        />

        {mode === "upload" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn("grid place-items-center gap-1.5 rounded-lg border border-dashed px-4 py-4 text-center transition-colors", dragging ? "border-accent bg-accent/10" : "border-line surface-1")}
          >
            <FileUp className="size-5 text-accent-soft" aria-hidden="true" />
            <p className="text-[12.5px] text-ink">Drop PDF, Word, Markdown, HTML or text files here</p>
            <p className="mono text-[10px] text-muted">up to 25 MB each · extracted on your machine</p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
              <Button size="sm" variant="primary" icon={<FileUp />} disabled={ingesting} onClick={() => fileInput.current?.click()}>
                Choose files
              </Button>
              <Button size="sm" variant="ghost" icon={<FileText />} disabled={ingesting} onClick={() => void run(() => ragRuntime.addText({ name: "Why the sky is blue (sample)", text: SAMPLE_TEXT, kind: "text" }))} title="Add a short built-in passage so the pipeline can be tried without a file">
                Use a sample
              </Button>
            </div>
            <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
        ) : null}

        {mode === "paste" ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void run(() => ragRuntime.addText({ name: name.trim() || "Pasted text", text, kind: "text" })).then(() => {
                setText("");
                setName("");
              });
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Document name" className="h-8 rounded-md border border-line bg-bg-elevated/80 px-2.5 text-[12.5px] text-ink placeholder:text-faint focus:border-accent/60" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste any text: notes, an article, documentation…" aria-label="Text to add" className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint focus:border-accent/60" />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="primary" icon={<Type />} disabled={ingesting || !text.trim()}>
                Add text
              </Button>
              <span className="mono text-[10.5px] text-muted">{formatNumber(text.length)} characters</span>
            </div>
          </form>
        ) : null}

        {mode === "url" ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim()) return;
              void run(() => ragRuntime.addUrl(url.trim())).then(() => setUrl(""));
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" aria-label="Web page URL" inputMode="url" className="mono h-8 min-w-0 flex-1 rounded-md border border-line bg-bg-elevated/80 px-2.5 text-[12px] text-ink placeholder:text-faint focus:border-accent/60" />
              <Button type="submit" size="sm" variant="primary" icon={<Globe />} disabled={ingesting || !url.trim()}>
                Fetch
              </Button>
            </div>
            <span className="mono text-[10px] text-muted">Public http(s) pages and PDFs, up to 8 MB. Local network addresses are refused.</span>
          </form>
        ) : null}

        {error ? <p className="text-[12px] text-err">{error}</p> : null}

        <p className="mono text-[10px] text-faint">
          {docs.length === 0 ? "Nothing indexed yet." : `${docs.length} document${docs.length === 1 ? "" : "s"} indexed.`} Everything stays in this server's memory for two hours and is never written to disk.
        </p>
      </GlassPanel>

      <SideDrawer
        open={listOpen}
        onClose={() => setListOpen(false)}
        title="Indexed documents"
        subtitle={kb ? `${docs.length} document${docs.length === 1 ? "" : "s"} · ${formatNumber(kb.chunks.length)} chunks · ${formatNumber(kb.totalTokens)} tokens` : undefined}
        icon={<Files aria-hidden="true" />}
      >
        {docs.length === 0 ? (
          <p className="mono text-[11px] text-muted">Nothing indexed yet.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Indexed documents">
            {docs.map((d) => (
              <DocumentRow key={d.id} doc={d} chunks={kb?.chunks.filter((c) => c.docId === d.id).length ?? 0} disabled={ingesting} onRemove={() => void run(() => ragRuntime.removeDocument(d.id))} />
            ))}
          </ul>
        )}
      </SideDrawer>
    </>
  );
}

function DocumentRow({ doc, chunks, disabled, onRemove }: { doc: RagDocument; chunks: number; disabled: boolean; onRemove: () => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-line surface-1 px-3 py-2.5">
      <div className="min-w-0 grid gap-1">
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink min-w-0">
          <span className="truncate">{doc.name}</span>
          <Badge>{doc.kind}</Badge>
          {doc.warnings.length ? (
            <Badge tone="warn" className="shrink-0">
              {doc.warnings.length} warning{doc.warnings.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </p>
        <p className="mono text-[10.5px] text-muted">
          {formatNumber(doc.chars)} chars{doc.pages ? ` · ${doc.pages} pages` : ""} · {chunks} chunks · added {formatTime(doc.addedAt)}
        </p>
        <p className="text-[11px] leading-snug text-muted">{doc.extraction}</p>
        {doc.warnings.map((w) => (
          <p key={w} className="text-[11px] leading-snug text-warn">
            {w}
          </p>
        ))}
        {doc.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer" className="mono text-[10.5px] text-live underline-offset-2 hover:underline truncate">
            {doc.url}
          </a>
        ) : null}
      </div>
      <button type="button" onClick={onRemove} disabled={disabled} aria-label={`Remove ${doc.name}`} className="grid size-7 shrink-0 place-items-center rounded-md border border-line text-muted hover:border-err/50 hover:text-err disabled:opacity-40">
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
