import { useState } from "react";
import { ArrowRight, Braces, ExternalLink } from "lucide-react";
import type { ProviderId } from "@shared/llm";
import { CLAUDE_SPEC, GEMINI_SPEC, OPENAI_SPEC, PIPELINE_DIFFERENCES, type PipelineSpec } from "@/labs/llm/pipelines/specs";
import { LLM_STAGES, type LLMStageId } from "@/labs/llm/stages";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";

type ComparedProvider = "claude" | "openai" | "gemini";
const COMPARED: ComparedProvider[] = ["claude", "openai", "gemini"];
const SPECS: Record<ComparedProvider, PipelineSpec> = { claude: CLAUDE_SPEC, openai: OPENAI_SPEC, gemini: GEMINI_SPEC };

/**
 * Side-by-side comparison of how each provider's request actually flows, and
 * which stages can be shown from real API data on each.
 */
export function PipelinesLab() {
  const [focus, setFocus] = useState<LLMStageId | null>(null);
  const mode = useUIStore((s) => s.mode);

  return (
    <div className="mx-auto max-w-[1720px] p-4 grid gap-4">
      <GlassPanel
        title="Provider pipelines"
        subtitle="the same question, three different request shapes"
        actions={
          <>
            <SourceBadge source="live" compact />
            <SourceBadge source="simulation" compact />
          </>
        }
        bodyClassName="p-4 grid gap-4"
      >
        <p className="text-[13px] leading-relaxed text-ink-dim max-w-4xl">
          Claude, OpenAI and Gemini are not the same pipeline with different names. They differ in where the system prompt lives, how the answer comes back, whether the tokenizer is public, whether reasoning is visible, and whether you can ever see token probabilities. The visualizer draws a different diagram for each provider, and the table below is what drives those differences.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {COMPARED.map((id) => (
            <SpecCard key={id} spec={SPECS[id]} onFocus={setFocus} focus={focus} />
          ))}
        </div>
      </GlassPanel>

      <GlassPanel title="Differences that change the diagram" subtitle={`${PIPELINE_DIFFERENCES.length} verified behaviours`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[1080px]">
            <thead>
              <tr className="label-caps text-left">
                <th className="py-2.5 px-4 font-normal">Topic</th>
                <th className="py-2.5 px-4 font-normal text-ink-dim">Claude · Messages API</th>
                <th className="py-2.5 px-4 font-normal text-ink-dim">OpenAI · Responses API</th>
                <th className="py-2.5 px-4 font-normal text-ink-dim">Gemini · generateContent</th>
              </tr>
            </thead>
            <tbody>
              {PIPELINE_DIFFERENCES.map((d) => (
                <tr
                  key={d.topic}
                  onMouseEnter={() => setFocus(d.stage ?? null)}
                  onMouseLeave={() => setFocus(null)}
                  className={cn("border-t border-line align-top transition-colors", focus && d.stage === focus ? "surface-2" : "hover:surface-1")}
                >
                  <td className="py-2.5 px-4 min-w-0">
                    <span className="text-ink">{d.topic}</span>
                    {d.stage ? <span className="mono block text-[10px] text-faint mt-0.5">{LLM_STAGES[d.stage].label}</span> : null}
                  </td>
                  <td className="py-2.5 px-4 text-ink-dim leading-snug">{d.claude}</td>
                  <td className="py-2.5 px-4 text-ink-dim leading-snug">{d.openai}</td>
                  <td className="py-2.5 px-4 text-ink-dim leading-snug">{d.gemini}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {mode === "advanced" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {COMPARED.map((id) => (
            <GlassPanel key={id} title={`${SPECS[id].name} request`} subtitle={SPECS[id].api} actions={<Badge>{SPECS[id].vendor}</Badge>} bodyClassName="p-4 grid gap-2">
              <pre className="mono text-[11px] leading-relaxed text-ink-dim overflow-x-auto rounded-lg border border-line bg-bg-elevated/60 p-3">{REQUEST_SHAPES[id]}</pre>
              <ul className="grid gap-1">
                {SPECS[id].notes.map((n) => (
                  <li key={n} className="text-[11.5px] text-muted leading-snug flex gap-1.5">
                    <Braces className="size-3 mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                    {n}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          ))}
        </div>
      ) : null}

      <GlassPanel title="Where the numbers come from" bodyClassName="p-4 grid gap-2">
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          Every pipeline marks each stage as live or simulated, and the marking is not cosmetic: it follows what that API actually returns. Claude can show an exact input token count before the request runs, because Anthropic exposes a counting endpoint, but it can never show token probabilities. OpenAI cannot count tokens server-side ahead of time, but it can return the real probability distribution for each generated token, as long as reasoning effort is none. Gemini is the only one of the three that does both: a counting call before the request, and real log probabilities during it.
        </p>
        <p className="mono text-[11px] text-muted">
          Sources: Anthropic Messages API and token counting; OpenAI reasoning guide, model guide and Responses API reference; Google Gemini API text generation and thinking guides.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <DocLink href="https://docs.anthropic.com/en/api/messages" label="Anthropic · Messages API" />
          <DocLink href="https://developers.openai.com/api/docs/guides/reasoning" label="OpenAI · Reasoning" />
          <DocLink href="https://developers.openai.com/api/docs/guides/latest-model" label="OpenAI · Model guide" />
          <DocLink href="https://ai.google.dev/gemini-api/docs/text-generation" label="Gemini · Text generation" />
          <DocLink href="https://ai.google.dev/gemini-api/docs/thinking" label="Gemini · Thinking" />
        </div>
      </GlassPanel>
    </div>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1.5 rounded-md border border-line px-2 h-6 text-[10.5px] text-ink-dim hover:border-line-strong hover:text-ink">
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}

function SpecCard({ spec, focus, onFocus }: { spec: PipelineSpec; focus: LLMStageId | null; onFocus: (id: LLMStageId | null) => void }) {
  const selectProviderId = useUIStore((s) => s.selectProvider);
  const selected = useUIStore((s) => s.selectedProviderId);
  const stages = spec.order.filter((id) => id !== "transformer");
  return (
    <div className={cn("rounded-xl border p-3 grid gap-3 min-w-0", selected === spec.provider ? "border-accent/50 bg-accent/[0.04]" : "border-line")}>
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-[14px] font-semibold text-ink truncate">{spec.name}</h3>
        <span className="mono text-[10.5px] text-muted truncate">{spec.api}</span>
        <button
          type="button"
          onClick={() => selectProviderId(spec.provider as ProviderId)}
          className="ml-auto mono text-[10px] uppercase tracking-[0.1em] text-live hover:underline underline-offset-2 shrink-0"
        >
          {selected === spec.provider ? "selected" : "use this"}
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{spec.summary}</p>
      <ol className="flex flex-wrap items-center gap-1">
        {stages.map((id, i) => {
          const def = spec.stages[id] ?? LLM_STAGES[id];
          const live = def.defaultSource === "live";
          return (
            <li key={id} className="flex items-center gap-1">
              <button
                type="button"
                onMouseEnter={() => onFocus(id)}
                onMouseLeave={() => onFocus(null)}
                title={def.sourceNote}
                className={cn(
                  "mono rounded border px-1.5 h-6 text-[10px] uppercase tracking-[0.06em] transition-colors",
                  live ? "border-live/40 text-live/90 bg-live/5" : "border-sim/40 text-sim/90 bg-sim/5",
                  focus === id && "ring-1 ring-accent-soft/70",
                )}
              >
                {def.shortLabel}
              </button>
              {i < stages.length - 1 ? <ArrowRight className="size-2.5 text-faint" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      <p className="mono text-[10px] text-faint">{stages.length} stages · {stages.filter((id) => (spec.stages[id] ?? LLM_STAGES[id]).defaultSource === "live").length} backed by live API data</p>
    </div>
  );
}

const REQUEST_SHAPES: Record<ComparedProvider, string> = {
  claude: `POST /v1/messages
{
  "model": "claude-opus-5",
  "max_tokens": 500,            // required
  "system": "You are helpful.", // top-level, not a message
  "messages": [{ "role": "user", "content": "..." }],
  "thinking": { "type": "adaptive", "display": "summarized" },
  "output_config": { "effort": "low" }
  // temperature is rejected by current models
}

→ content: [ { type: "thinking" }, { type: "text" } ]
→ stop_reason: end_turn | max_tokens | refusal | ...
→ usage: input_tokens, output_tokens,
         cache_creation_input_tokens, cache_read_input_tokens`,
  openai: `POST /v1/responses
{
  "model": "gpt-5.6",
  "input": "...",
  "instructions": "You are helpful.",
  "max_output_tokens": 500,
  "reasoning": { "effort": "none" },
  "temperature": 0.7,           // only when effort is "none"
  "top_logprobs": 5,            // only when effort is "none"
  "include": ["message.output_text.logprobs"]
}

→ output: [ { type: "reasoning" }, { type: "message" } ]
→ status: completed | incomplete (+ incomplete_details)
→ usage: input_tokens, output_tokens, total_tokens,
         input_tokens_details.cached_tokens,
         output_tokens_details.reasoning_tokens`,
  gemini: `POST /v1beta/models/gemini-3.8-flash:streamGenerateContent
{
  "contents": [{ "role": "user", "parts": [{ "text": "..." }] }],
  "systemInstruction": "You are helpful.",
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 500,
    "responseLogprobs": true,     // real probabilities
    "logprobs": 5,
    "thinkingConfig": {
      "includeThoughts": true,
      "thinkingLevel": "MEDIUM"
    }
  }
}

→ candidates[0].content.parts[]  // part.thought marks reasoning
→ candidates[0].finishReason: STOP | MAX_TOKENS | SAFETY
→ candidates[0].logprobsResult.chosenCandidates / topCandidates
→ usageMetadata: promptTokenCount, candidatesTokenCount,
                 thoughtsTokenCount, cachedContentTokenCount`,
};
