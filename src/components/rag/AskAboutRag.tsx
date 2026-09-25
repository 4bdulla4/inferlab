import { useState } from "react";
import { HelpCircle, Loader2, Route } from "lucide-react";
import { ragRuntime } from "@/engine/rag/ragRuntime";
import { cn } from "@/lib/cn";
import { selectLatestQueryRun, useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceDot } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const SUGGESTIONS = [
  "How does information travel from my document to the final answer?",
  "Why were these particular chunks retrieved?",
  "What would change if I used MMR instead of similarity?",
  "What exactly did the model receive in its prompt?",
  "Is anything on this page simulated rather than real?",
];

/**
 * Questions about the system itself, answered from the knowledge base's real
 * state and the last run. The badge says whether a model wrote the prose or a
 * template did; the facts and the hop-by-hop trail are always the raw material.
 */
export function AskAboutRag() {
  const explain = useRagStore((s) => s.explain);
  const kb = useRagStore((s) => s.kb);
  const latest = useRagStore(selectLatestQueryRun);
  const [question, setQuestion] = useState("");
  const disabled = !kb || kb.documents.length === 0;

  const ask = (q: string) => {
    if (!q.trim()) return;
    void ragRuntime.explain(q.trim(), latest?.id);
  };

  return (
    <GlassPanel title="Ask about this RAG system" subtitle={latest ? "grounded in the knowledge base and the last question" : "grounded in the knowledge base"} actions={<HelpCircle className="size-4 text-muted" aria-hidden="true" />} bodyClassName="p-4 grid gap-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} disabled={disabled} placeholder={disabled ? "Add a document first" : "How does a fact get from the document into the answer?"} aria-label="Question about the RAG system" className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint focus:border-accent/60 disabled:opacity-60" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="primary" icon={explain.loading ? <Loader2 className="animate-spin" /> : <Route />} disabled={disabled || explain.loading || !question.trim()}>
            Explain
          </Button>
          <span className="mono text-[10.5px] text-muted">answers name real chunk ids, settings and counts</span>
        </div>
      </form>

      {!explain.result && !explain.loading ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => ask(s)} className="rounded-md border border-line surface-1 px-2 py-1 text-[11.5px] text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-50 text-left">
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {explain.error ? <p className="text-[12px] text-err">{explain.error}</p> : null}

      {explain.result ? (
        <div className="grid gap-3">
          <div className="rounded-xl border border-accent/25 bg-accent/[0.05] px-3.5 py-2.5 grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted">Q · {explain.question}</span>
              <span className="ml-auto flex items-center gap-1.5">
                {explain.result.source === "ai" ? <Badge tone="sim">AI-written · {explain.result.model}</Badge> : <Badge>assembled from facts · no model</Badge>}
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">{explain.result.answer}</p>
            {explain.result.usage ? (
              <p className="mono text-[10px] text-faint">
                {explain.result.usage.inputTokens ?? "?"} in / {explain.result.usage.outputTokens ?? "?"} out
              </p>
            ) : null}
          </div>

          {explain.result.trail ? (
            <div className="rounded-lg border border-line p-3 grid gap-2">
              <p className="label-caps">Information trail · one passage, document to answer</p>
              <ol className="grid gap-1.5">
                {explain.result.trail.hops.map((hop, i) => (
                  <li key={hop.stage} className="grid grid-cols-[22px_92px_minmax(0,1fr)] items-start gap-2">
                    <span className={cn("mono text-[10px] mt-0.5", hop.source === "live" ? "text-live" : "text-sim")}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="mono text-[10.5px] uppercase tracking-[0.1em] text-muted mt-0.5 flex items-center gap-1.5">
                      <SourceDot source={hop.source} />
                      {hop.stage}
                    </span>
                    <span className="text-[12px] leading-snug text-ink-dim break-words">{hop.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <details className="rounded-lg border border-line p-3 text-[12px]">
            <summary className="cursor-pointer label-caps">Facts the answer was built from · {explain.result.facts.length}</summary>
            <ul className="mt-2 grid gap-1">
              {explain.result.facts.map((f) => (
                <li key={f} className="text-ink-dim leading-snug flex gap-2">
                  <span className="text-faint">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </GlassPanel>
  );
}
