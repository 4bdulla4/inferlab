import type { SessionKeys } from "@/store/uiStore";

const KEYS_STORAGE = "inferlab.keys.v1";
const REMEMBER_STORAGE = "inferlab.remember-keys.v1";
const FIELDS = ["anthropic", "openai", "github", "anthropicWorkspace"] as const;

/**
 * Optional persistence for keys typed into the Settings drawer, so a page
 * refresh does not lose them. Storage is per browser profile and never leaves
 * this machine; the server-side `.env` remains the stronger option.
 * Every access is guarded: private mode and blocked site data must not break the app.
 */
function read(name: string): string | null {
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function write(name: string, value: string): void {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    /* storage unavailable (private mode, blocked site data) */
  }
}

function remove(name: string): void {
  try {
    window.localStorage.removeItem(name);
  } catch {
    /* ignore */
  }
}

export function loadRememberPreference(): boolean {
  return read(REMEMBER_STORAGE) !== "off";
}

export function saveRememberPreference(remember: boolean): void {
  write(REMEMBER_STORAGE, remember ? "on" : "off");
  if (!remember) remove(KEYS_STORAGE);
}

export function loadStoredKeys(): SessionKeys {
  if (!loadRememberPreference()) return {};
  const raw = read(KEYS_STORAGE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SessionKeys = {};
    for (const field of FIELDS) {
      const v = parsed[field];
      if (typeof v === "string" && v.trim()) out[field] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistKeys(keys: SessionKeys, remember: boolean): void {
  if (!remember) {
    remove(KEYS_STORAGE);
    return;
  }
  if (Object.keys(keys).length === 0) {
    remove(KEYS_STORAGE);
    return;
  }
  write(KEYS_STORAGE, JSON.stringify(keys));
}

export function clearStoredKeys(): void {
  remove(KEYS_STORAGE);
}
