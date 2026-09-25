import { create } from "zustand";
import { clearStoredKeys, loadRememberPreference, loadStoredKeys, persistKeys, saveRememberPreference } from "@/lib/keyStorage";
import type { GenerationSettings, ProviderDescriptor, ProviderId } from "@shared/llm";
import type { PlaybackSpeed } from "@/types/execution";
import type { LLMStageId } from "@/labs/llm/stages";

export type ExplanationMode = "beginner" | "advanced";
export type MotionPreference = "system" | "reduced" | "full";
export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE = "inferlab.theme.v1";

function readTheme(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

/** Writes the resolved theme onto <html> so CSS variables switch. */
export function applyTheme(pref: ThemePreference): void {
  const resolved = pref === "system" ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE, pref);
  } catch {
    /* preference simply will not persist */
  }
}

export const DEFAULT_PROMPT = "Explain why the sky is blue in simple terms.";

export interface SelectedToken {
  scope: "input" | "output";
  index: number;
}

/**
 * API keys entered for this browser session. Held in memory only (never
 * localStorage, never persisted) and sent to our own backend per request.
 */
export interface SessionKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  github?: string;
  /** Needed only for organization-level Anthropic keys that are not scoped to a workspace. */
  anthropicWorkspace?: string;
}

export const SESSION_KEY_HEADERS: Record<keyof SessionKeys, string> = {
  anthropic: "x-anthropic-api-key",
  openai: "x-openai-api-key",
  google: "x-google-api-key",
  github: "x-github-token",
  anthropicWorkspace: "x-anthropic-workspace-id",
};

export const PROVIDER_KEY_FIELD: Record<ProviderId, keyof SessionKeys | null> = {
  claude: "anthropic",
  openai: "openai",
  gemini: "google",
  mock: null,
};

export interface UIState {
  mode: ExplanationMode;
  motion: MotionPreference;
  theme: ThemePreference;
  speed: PlaybackSpeed;
  comparisonMode: boolean;
  settingsOpen: boolean;
  legendOpen: boolean;
  /** Whether the event log shares the stage frame with the diagram. */
  timelineOpen: boolean;
  transformerExpanded: boolean;
  qkvOpen: boolean;
  selectedStage: LLMStageId | null;
  selectedToken: SelectedToken | null;
  attentionFocus: number | null;

  providers: ProviderDescriptor[];
  providersError: string | null;
  providersLoaded: boolean;
  selectedProviderId: ProviderId;
  input: string;
  settings: GenerationSettings;
  sessionKeys: SessionKeys;
  /** Keep typed keys in this browser profile so a refresh does not lose them. */
  rememberKeys: boolean;
  /** Providers with session keys applied. Derived inside the store so selectors return stable references. */
  effectiveProviders: ProviderDescriptor[];
  /** Which settings field to focus when the drawer opens (e.g. "anthropic"). */
  settingsFocus: keyof SessionKeys | null;

  setSessionKey: (field: keyof SessionKeys, value: string) => void;
  clearSessionKeys: () => void;
  setRememberKeys: (remember: boolean) => void;
  openSettingsFor: (field: keyof SessionKeys | null) => void;
  setMode: (mode: ExplanationMode) => void;
  setMotion: (motion: MotionPreference) => void;
  setTheme: (theme: ThemePreference) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setComparisonMode: (on: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setLegendOpen: (open: boolean) => void;
  setTimelineOpen: (open: boolean) => void;
  setTransformerExpanded: (open: boolean) => void;
  setQkvOpen: (open: boolean) => void;
  selectStage: (stage: LLMStageId | null) => void;
  selectToken: (token: SelectedToken | null) => void;
  setAttentionFocus: (index: number | null) => void;
  setProviders: (providers: ProviderDescriptor[]) => void;
  setProvidersError: (error: string | null) => void;
  selectProvider: (id: ProviderId) => void;
  setInput: (input: string) => void;
  updateSettings: (patch: Partial<GenerationSettings>) => void;
}

function computeEffective(providers: ProviderDescriptor[], sessionKeys: SessionKeys): ProviderDescriptor[] {
  return providers.map((p) => {
    const field = PROVIDER_KEY_FIELD[p.id];
    const sessionKey = field ? Boolean(sessionKeys[field]) : false;
    return { ...p, configured: p.configured || sessionKey, keySource: sessionKey ? "session" : p.configured ? "server" : "none" };
  });
}

export const useUIStore = create<UIState>((set) => ({
  mode: "beginner",
  motion: "system",
  theme: readTheme(),
  speed: 1,
  comparisonMode: false,
  settingsOpen: false,
  legendOpen: false,
  timelineOpen: true,
  transformerExpanded: false,
  qkvOpen: false,
  selectedStage: null,
  selectedToken: null,
  attentionFocus: null,

  providers: [],
  providersError: null,
  providersLoaded: false,
  selectedProviderId: "claude",
  input: DEFAULT_PROMPT,
  settings: { temperature: 0.7, maxOutputTokens: 500, streaming: true, systemPrompt: "", effort: "none" },
  sessionKeys: loadStoredKeys(),
  rememberKeys: loadRememberPreference(),
  effectiveProviders: [],
  settingsFocus: null,

  setSessionKey: (field, value) =>
    set((s) => {
      const next = { ...s.sessionKeys };
      const v = value.trim();
      if (v) next[field] = v;
      else delete next[field];
      persistKeys(next, s.rememberKeys);
      return { sessionKeys: next, effectiveProviders: computeEffective(s.providers, next) };
    }),
  clearSessionKeys: () =>
    set((s) => {
      clearStoredKeys();
      return { sessionKeys: {}, effectiveProviders: computeEffective(s.providers, {}) };
    }),
  setRememberKeys: (remember) =>
    set((s) => {
      saveRememberPreference(remember);
      persistKeys(s.sessionKeys, remember);
      return { rememberKeys: remember };
    }),
  openSettingsFor: (settingsFocus) => set({ settingsFocus, settingsOpen: true }),
  setMode: (mode) => set({ mode }),
  setMotion: (motion) => set({ motion }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setSpeed: (speed) => set({ speed }),
  setComparisonMode: (comparisonMode) => set({ comparisonMode }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setLegendOpen: (legendOpen) => set({ legendOpen }),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  setTransformerExpanded: (transformerExpanded) => set({ transformerExpanded }),
  setQkvOpen: (qkvOpen) => set({ qkvOpen }),
  selectStage: (selectedStage) => set({ selectedStage, selectedToken: null }),
  selectToken: (selectedToken) => set({ selectedToken }),
  setAttentionFocus: (attentionFocus) => set({ attentionFocus }),
  setProviders: (providers) =>
    set((s) => ({
      providers,
      effectiveProviders: computeEffective(providers, s.sessionKeys),
      providersLoaded: true,
      providersError: null,
      selectedProviderId: providers.some((p) => p.id === s.selectedProviderId)
        ? s.selectedProviderId
        : (providers.find((p) => p.configured)?.id ?? providers[0]?.id ?? s.selectedProviderId),
    })),
  setProvidersError: (providersError) => set({ providersError, providersLoaded: true }),
  selectProvider: (selectedProviderId) => set({ selectedProviderId }),
  setInput: (input) => set({ input }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
}));

/** Providers with session keys applied: a provider counts as configured when the server or this tab has a key. */
export const selectProviders = (s: UIState): ProviderDescriptor[] => s.effectiveProviders;

export const selectProvider = (s: UIState): ProviderDescriptor | undefined =>
  s.effectiveProviders.find((p) => p.id === s.selectedProviderId);

/** Request headers carrying this session's keys to our own backend. */
export function sessionHeaders(): Record<string, string> {
  const keys = useUIStore.getState().sessionKeys;
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(SESSION_KEY_HEADERS) as [keyof SessionKeys, string][]) {
    const v = keys[field];
    if (v) out[header] = v;
  }
  return out;
}
