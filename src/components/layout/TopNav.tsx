import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BarChart3, Bell, Bot, Brain, Check, Database, GitBranch, GitCompareArrows,
  Monitor, Moon, Search, Settings2, Sun, Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import type { RunStatus } from "@/types/execution";
import { LABS, type LabId } from "@/labs/registry";
import { cn } from "@/lib/cn";
import { useActiveRun } from "@/hooks/useActiveRun";
import { useHistoryFeed } from "@/hooks/useHistoryFeed";
import { useRepoStore } from "@/store/repoStore";
import { useUIStore, type ThemePreference } from "@/store/uiStore";
import { Badge } from "@/components/ui/Badge";

const ICONS: Record<LabId, ComponentType<{ className?: string }>> = {
  history: BarChart3,
  llm: Bot,
  pipelines: GitCompareArrows,
  repo: GitBranch,
  settings: Settings2,
  rag: Database,
  ml: Brain,
  agents: Workflow,
};

const THEMES: { value: ThemePreference; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function TopNav({ activeLab, onSelectLab }: { activeLab: LabId; onSelectLab: (id: LabId) => void }) {
  const run = useActiveRun();
  const repoStatus = useRepoStore((s) => s.status);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const primary = LABS.filter((l) => l.id !== "settings");

  return (
    <header className="appbar sticky top-0 z-40 h-16 flex items-center gap-3 px-4">
      <button
        type="button"
        onClick={() => onSelectLab("history")}
        className="flex items-center gap-2.5 shrink-0 rounded-lg px-1 py-1 hover:bg-[var(--surface-hover)]"
        title="inferLab"
      >
        <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-accent to-live text-white">
          <Activity className="size-4" aria-hidden="true" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-ink hidden sm:block">inferLab</span>
      </button>

      <nav aria-label="Labs" className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {primary.map((lab) => {
          const Icon = ICONS[lab.id];
          const active = lab.id === activeLab;
          const disabled = lab.status !== "active";
          return (
            <button
              key={lab.id}
              type="button"
              disabled={disabled}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectLab(lab.id)}
              title={disabled ? `${lab.title} — coming soon` : lab.title}
              className={cn(
                "group inline-flex shrink-0 items-center gap-2 rounded-lg px-3 h-9 transition-colors",
                active ? "bg-accent/15 text-ink border border-accent/40" : "border border-transparent text-muted",
                disabled ? "opacity-40 cursor-not-allowed" : "hover:text-ink hover:bg-[var(--surface-hover)]",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-accent-soft" : "text-muted group-hover:text-ink-dim")} />
              <span className="text-[13px] whitespace-nowrap">{lab.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <CommandSearch onSelectLab={onSelectLab} />
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <Notifications />
        <StatusPill activeLab={activeLab} run={run} repoStatus={repoStatus} />
        <AccountMenu onSelectLab={onSelectLab} theme={theme} setTheme={setTheme} />
      </div>
    </header>
  );
}

function StatusPill({ activeLab, run, repoStatus }: { activeLab: LabId; run: ReturnType<typeof useActiveRun>; repoStatus: string }) {
  if (activeLab === "llm") return <ExecutionStatusBadge status={run?.status} streaming={Boolean(run && run.status === "running" && run.visual.generation.started)} />;
  if (activeLab !== "repo") return null;
  if (repoStatus === "analyzing")
    return (
      <Badge tone="live" className="gap-1.5 hidden md:inline-flex">
        <Activity className="size-3 animate-pulse" aria-hidden="true" />
        Analyzing
      </Badge>
    );
  if (repoStatus === "ready") return <Badge tone="ok" className="hidden md:inline-flex">Analyzed</Badge>;
  if (repoStatus === "error") return <Badge tone="err" className="hidden md:inline-flex">Error</Badge>;
  return <Badge className="hidden md:inline-flex">Idle</Badge>;
}

/** ⌘K search over destinations and the settings fields. */
function CommandSearch({ onSelectLab }: { onSelectLab: (id: LabId) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const openSettingsFor = useUIStore((s) => s.openSettingsFor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const destinations = LABS.filter((l) => l.status === "active").map((l) => ({
      id: l.id,
      label: l.name,
      hint: l.description,
      run: () => onSelectLab(l.id),
    }));
    const keys = [
      { id: "key-anthropic", label: "Anthropic key", hint: "Add or replace the Claude API key", run: () => openSettingsFor("anthropic") },
      { id: "key-openai", label: "OpenAI key", hint: "Add or replace the OpenAI API key", run: () => openSettingsFor("openai") },
      { id: "key-google", label: "Gemini key", hint: "Add or replace the Google API key", run: () => openSettingsFor("google") },
      { id: "key-github", label: "GitHub token", hint: "Needed for private repositories", run: () => openSettingsFor("github") },
    ];
    const all = [...destinations, ...keys];
    if (!q) return all.slice(0, 6);
    return all.filter((r) => `${r.label} ${r.hint}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, onSelectLab, openSettingsFor]);

  return (
    <div ref={boxRef} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex h-9 w-[220px] items-center gap-2 rounded-lg border border-line bg-[var(--color-panel)] px-3 text-left text-muted hover:border-line-strong"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-[12.5px] truncate">Search anything…</span>
        <kbd className="mono ml-auto rounded border border-line px-1 text-[10px] text-faint">⌘K</kbd>
      </button>

      {open ? (
        <div className="popover absolute right-0 top-11 z-50 w-[340px] rounded-xl p-2">
          <div className="flex items-center gap-2 border-b border-line px-2 pb-2">
            <Search className="size-3.5 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Go to a page, or add a key…"
              aria-label="Search"
              className="h-7 w-full bg-transparent text-[13px] text-ink placeholder:text-faint focus:outline-none"
            />
          </div>
          <ul className="grid gap-0.5 pt-2 max-h-[280px] overflow-y-auto panel-scroll">
            {results.length === 0 ? <li className="px-2 py-3 text-[12px] text-muted">Nothing matches that.</li> : null}
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    r.run();
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                >
                  <span className="block text-[12.5px] text-ink">{r.label}</span>
                  <span className="block text-[11px] text-muted truncate">{r.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: ThemePreference; setTheme: (t: ThemePreference) => void }) {
  const resolved = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next: ThemePreference = resolved === "light" ? "dark" : "light";
  const Icon = resolved === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${theme}. Click for ${next}.`}
      aria-label={`Switch to ${next} theme`}
      className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-ink hover:bg-[var(--surface-hover)]"
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Recent failures and finished work, read from the activity log. */
function Notifications() {
  const [open, setOpen] = useState(false);
  const { entries, unread, markRead } = useHistoryFeed(open);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          markRead();
        }}
        aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}
        className="relative grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-ink hover:bg-[var(--surface-hover)]"
      >
        <Bell className="size-4" />
        {unread ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent-soft" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="popover absolute right-0 top-11 z-50 w-[320px] rounded-xl p-2">
          <p className="label-caps px-2 pb-2">Recent activity</p>
          {entries.length === 0 ? (
            <p className="px-2 pb-2 text-[12px] text-muted">Nothing yet. Runs and analyses show up here.</p>
          ) : (
            <ul className="grid gap-0.5 max-h-[300px] overflow-y-auto panel-scroll">
              {entries.map((e) => (
                <li key={e.id} className="rounded-lg px-2 py-1.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn("size-1.5 rounded-full shrink-0", e.ok ? "bg-ok" : "bg-err")} aria-hidden="true" />
                    <span className="text-[12.5px] text-ink truncate">{e.title}</span>
                  </span>
                  <span className="block mono text-[10.5px] text-muted truncate pl-3.5">{e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AccountMenu({ onSelectLab, theme, setTheme }: { onSelectLab: (id: LabId) => void; theme: ThemePreference; setTheme: (t: ThemePreference) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account and preferences"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-[13px] font-semibold text-white"
      >
        A
      </button>
      {open ? (
        <div className="popover absolute right-0 top-11 z-50 w-[220px] rounded-xl p-2 grid gap-1">
          <p className="label-caps px-2 pt-1">Theme</p>
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme(t.value)}
              className={cn("flex items-center gap-2 rounded-lg px-2 h-8 text-[12.5px] hover:bg-[var(--surface-hover)]", theme === t.value ? "text-ink" : "text-muted")}
            >
              <t.icon className="size-3.5" aria-hidden="true" />
              {t.label}
              {theme === t.value ? <Check className="ml-auto size-3.5 text-accent-soft" aria-hidden="true" /> : null}
            </button>
          ))}
          <p className="label-caps px-2 pt-2">Detail level</p>
          {(["beginner", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("flex items-center gap-2 rounded-lg px-2 h-8 text-[12.5px] capitalize hover:bg-[var(--surface-hover)]", mode === m ? "text-ink" : "text-muted")}
            >
              {m}
              {mode === m ? <Check className="ml-auto size-3.5 text-accent-soft" aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="border-t border-line mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                onSelectLab("settings");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 h-8 text-[12.5px] text-muted hover:text-ink hover:bg-[var(--surface-hover)]"
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionStatusBadge({ status, streaming }: { status: RunStatus | undefined; streaming: boolean }) {
  if (!status) return <Badge className="hidden md:inline-flex">Idle</Badge>;
  if (status === "running")
    return (
      <Badge tone="live" className="gap-1.5 hidden md:inline-flex">
        <Activity className="size-3 animate-pulse" aria-hidden="true" />
        {streaming ? "Streaming" : "Running"}
      </Badge>
    );
  if (status === "completed") return <Badge tone="ok" className="hidden md:inline-flex">Completed</Badge>;
  if (status === "stopped") return <Badge tone="warn" className="hidden md:inline-flex">Stopped</Badge>;
  return <Badge tone="err" className="hidden md:inline-flex">Error</Badge>;
}
