import { useEffect, useState } from "react";
import { LABS, type LabId } from "@/labs/registry";
import { LLMLab } from "@/labs/llm/LLMLab";
import { RepoLab } from "@/labs/repo/RepoLab";
import { HistoryLab } from "@/labs/history/HistoryLab";
import { PipelinesLab } from "@/labs/pipelines/PipelinesLab";
import { RagLab } from "@/labs/rag/RagLab";
import { MLLab } from "@/labs/ml/MLLab";
import { AgentLab } from "@/labs/agent/AgentLab";
import { SettingsLab } from "@/labs/settings/SettingsLab";
import { useProviders } from "@/hooks/useProviders";
import { useUIStore } from "@/store/uiStore";
import { cn } from "@/lib/cn";
import { TopNav } from "@/components/layout/TopNav";

const LAB_COMPONENTS: Partial<Record<LabId, React.ComponentType>> = {
  llm: LLMLab,
  pipelines: PipelinesLab,
  repo: RepoLab,
  rag: RagLab,
  ml: MLLab,
  agents: AgentLab,
  settings: SettingsLab,
};

function labFromHash(): LabId {
  const h = window.location.hash.replace("#", "");
  return LABS.some((l) => l.id === h && l.status === "active") ? (h as LabId) : "llm";
}

export default function App() {
  const [activeLab, setActiveLabState] = useState<LabId>(() => labFromHash());
  const setActiveLab = (id: LabId) => {
    setActiveLabState(id);
    window.location.hash = id;
  };
  const motion = useUIStore((s) => s.motion);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  useProviders();

  // Keep the page in step with the address bar, so back, forward and a pasted
  // link all land on the right lab.
  useEffect(() => {
    const onHashChange = () => setActiveLabState(labFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // "Enter a key" links anywhere in the app open the settings page.
  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsOpen(false);
    setActiveLabState("settings");
    window.location.hash = "settings";
  }, [settingsOpen, setSettingsOpen]);

  const Dashboard = LAB_COMPONENTS[activeLab];
  const lab = LABS.find((l) => l.id === activeLab);

  return (
    <div className={cn("min-h-full flex flex-col", motion === "system" ? "motion-system" : motion === "reduced" ? "motion-reduced" : "")}>
      <TopNav activeLab={activeLab} onSelectLab={setActiveLab} />
      <main className="flex-1 min-w-0">
        {activeLab === "history" ? (
          <HistoryLab onOpenRepoLab={() => setActiveLab("repo")} />
        ) : Dashboard ? (
          <Dashboard />
        ) : (
          <div className="p-10 text-center text-muted">
            <p className="mono text-[12px] uppercase tracking-[0.14em]">{lab?.title} — coming soon</p>
          </div>
        )}
      </main>
    </div>
  );
}
