import { SlidersHorizontal } from "lucide-react";
import { useRagStore } from "@/store/ragStore";
import { SideDrawer } from "@/components/layout/SideDrawer";
import { Badge } from "@/components/ui/Badge";
import { RagSettingsPanel } from "./RagSettingsPanel";

/**
 * Pipeline settings as a drawer over the RAG page rather than a panel competing
 * for space with the run. Changes save as they are made, so there is no confirm
 * step: closing the drawer simply gets out of the way.
 */
export function RagSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stale = Boolean(useRagStore((s) => s.kb)?.stale);
  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Pipeline settings"
      subtitle="saved as you change them"
      icon={<SlidersHorizontal aria-hidden="true" />}
      actions={stale ? <Badge tone="warn" className="shrink-0">rebuild needed</Badge> : null}
    >
      <RagSettingsPanel bare />
    </SideDrawer>
  );
}

/** One line of what the pipeline is currently set to, for the button that opens the drawer. */
export function settingsSummary(s: {
  chunkSize: number;
  topK: number;
  retrievalStrategy: string;
  vectorIndex: string;
  embeddingModel: string;
  llmProvider: string;
}): string {
  return `${s.chunkSize} tok · top-${s.topK} · ${s.retrievalStrategy} · ${s.vectorIndex} · ${s.embeddingModel} · ${s.llmProvider}`;
}
