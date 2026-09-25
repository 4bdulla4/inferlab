import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/cn";

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Shown in the header, left of the close button. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A panel that slides in over the page instead of taking a route. Escape and a
 * click on the scrim close it, the page behind stops scrolling while it is
 * open, and focus returns to whatever opened it.
 */
export function SideDrawer({ open, onClose, title, subtitle, icon, actions, children, className }: SideDrawerProps) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      clearTimeout(focusTimer);
      restoreFocus.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
          />
          <motion.div
            key="drawer"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduced ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: "100%" }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 40 }}
            className={cn("popover fixed right-0 top-0 z-50 flex h-full w-[min(560px,94vw)] flex-col rounded-none border-y-0 border-r-0 focus:outline-none", className)}
          >
            <header className="flex items-center gap-2 px-4 h-14 border-b border-line shrink-0">
              {icon ? <span className="shrink-0 text-accent-soft [&>svg]:size-4">{icon}</span> : null}
              <span className="min-w-0 flex-1">
                <span className="block label-caps text-ink-dim truncate">{title}</span>
                {subtitle ? <span className="mono block text-[10.5px] text-muted truncate">{subtitle}</span> : null}
              </span>
              {actions}
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${title.toLowerCase()}`}
                className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted hover:border-line-strong hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto panel-scroll p-4">{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
