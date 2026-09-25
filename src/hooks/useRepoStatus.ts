import { useEffect } from "react";
import { fetchRepoStatus } from "@/api/repoClient";
import { useRepoStore } from "@/store/repoStore";
import { useUIStore } from "@/store/uiStore";

/** Loads analyzer service status; refetches when session keys change so badges reflect them. */
export function useRepoStatus(): void {
  const set = useRepoStore((s) => s.setServiceStatus);
  const keys = useUIStore((s) => s.sessionKeys);
  const keySignature = `${Boolean(keys.anthropic)}:${Boolean(keys.github)}`;
  useEffect(() => {
    let cancelled = false;
    fetchRepoStatus()
      .then((s) => {
        if (!cancelled) set(s);
      })
      .catch(() => {
        /* status is optional; the input panel degrades gracefully */
      });
    return () => {
      cancelled = true;
    };
  }, [set, keySignature]);
}
