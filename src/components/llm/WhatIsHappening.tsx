import type { StageDefinition } from "@/labs/llm/stages";
import { useUIStore } from "@/store/uiStore";

export function WhatIsHappening({ def }: { def: StageDefinition }) {
  const mode = useUIStore((s) => s.mode);
  return (
    <div className="rounded-lg border border-line surface-1 p-3 grid gap-2">
      <p className="label-caps">What is happening?</p>
      <p className="text-[13px] leading-relaxed text-ink">{mode === "beginner" ? def.beginner : def.advanced}</p>
      {mode === "advanced" ? <p className="text-[12px] leading-relaxed text-muted">{def.beginner}</p> : null}
    </div>
  );
}
