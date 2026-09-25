import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { cn } from "@/lib/cn";
import { usePanelHandle } from "./PanelGrid";

export interface GlassPanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Access to the scrolling body, e.g. to reset scroll when the content changes. */
  bodyRef?: RefObject<HTMLDivElement | null>;
  /** Extra props for the body element, such as pointer handlers. */
  bodyProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "ref" | "children">;
  id?: string;
}

export function GlassPanel({ title, subtitle, actions, children, className, bodyClassName, bodyRef, bodyProps, id }: GlassPanelProps) {
  // Present only when this panel sits inside a reorderable grid.
  const handle = usePanelHandle();
  return (
    <section id={id} className={cn("glass rounded-xl flex flex-col min-h-0 min-w-0", className)} aria-label={typeof title === "string" ? title : undefined}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 px-4 h-11 border-b border-line shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {handle}
            {title ? <h2 className="label-caps text-ink-dim truncate">{title}</h2> : null}
            {subtitle ? <span className="text-[11px] text-muted truncate">{subtitle}</span> : null}
          </div>
          {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div ref={bodyRef} {...bodyProps} className={cn("min-h-0 min-w-0 flex-1", bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}
