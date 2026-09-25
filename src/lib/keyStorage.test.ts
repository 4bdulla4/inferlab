import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredKeys, loadRememberPreference, loadStoredKeys, persistKeys, saveRememberPreference } from "./keyStorage";

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  return map;
}

describe("keyStorage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips keys so a refresh restores them", () => {
    installStorage();
    persistKeys({ anthropic: "sk-ant-abc0123456789", github: "ghp_abc0123456789" }, true);
    expect(loadStoredKeys()).toEqual({ anthropic: "sk-ant-abc0123456789", github: "ghp_abc0123456789" });
  });

  it("does not persist when remembering is off, and forgetting clears storage", () => {
    installStorage();
    persistKeys({ anthropic: "sk-ant-abc0123456789" }, false);
    expect(loadStoredKeys()).toEqual({});
    persistKeys({ anthropic: "sk-ant-abc0123456789" }, true);
    expect(loadStoredKeys().anthropic).toBeDefined();
    clearStoredKeys();
    expect(loadStoredKeys()).toEqual({});
  });

  it("turning the preference off wipes anything already stored", () => {
    installStorage();
    persistKeys({ openai: "sk-openai-abc0123456789" }, true);
    saveRememberPreference(false);
    expect(loadRememberPreference()).toBe(false);
    expect(loadStoredKeys()).toEqual({});
  });

  it("survives unavailable or corrupt storage without throwing", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => persistKeys({ anthropic: "x".repeat(20) }, true)).not.toThrow();
    expect(loadStoredKeys()).toEqual({});
    const map = installStorage();
    map.set("inferlab.keys.v1", "{not json");
    expect(loadStoredKeys()).toEqual({});
  });
});
