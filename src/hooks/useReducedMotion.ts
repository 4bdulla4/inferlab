import { useEffect, useState } from "react";
import { useUIStore } from "@/store/uiStore";

/** True when particle/pulse animations should be replaced by simple transitions. */
export function useReducedMotion(): boolean {
  const pref = useUIStore((s) => s.motion);
  const [system, setSystem] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setSystem(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return system;
}
