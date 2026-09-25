import { useEffect } from "react";
import { fetchProviders } from "@/api/llmClient";
import { useUIStore } from "@/store/uiStore";

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

/** Loads provider descriptors (model ids, capabilities, configured flags), retrying while the API boots. */
export function useProviders(): void {
  const setProviders = useUIStore((s) => s.setProviders);
  const setProvidersError = useUIStore((s) => s.setProvidersError);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (n: number) => {
      fetchProviders()
        .then((providers) => {
          if (!cancelled) setProviders(providers);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const delay = RETRY_DELAYS_MS[n];
          if (delay !== undefined) {
            timer = setTimeout(() => attempt(n + 1), delay);
          } else {
            setProvidersError(err instanceof Error ? err.message : "Could not reach the backend.");
          }
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [setProviders, setProvidersError]);
}
