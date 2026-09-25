import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { useLayoutStore, wideColumnIndex, type LabLayout, type PanelId } from "@/store/layoutStore";
import { cn } from "@/lib/cn";

/** Lets GlassPanel render the drag handle without every lab passing it down. */
const HandleContext = createContext<ReactNode>(null);
export const usePanelHandle = () => useContext(HandleContext);

interface DropTarget {
  column: number;
  index: number;
}

export interface PanelGridProps {
  /** Identifies the arrangement in storage. */
  lab: string;
  /** Default arrangement, one array per column. */
  fallback: LabLayout;
  /** Panel content by id. Ids missing here are skipped. */
  panels: Partial<Record<PanelId, ReactNode>>;
  className?: string;
  /**
   * Panels that need room to breathe, such as a wide diagram. Whichever column
   * holds one of these takes the flexible track, so dragging the diagram to the
   * other side moves the space with it instead of squashing it.
   */
  widePanels?: PanelId[];
  /** Width in pixels of the columns that are not the wide one. */
  narrowWidth?: number;
  /** Applied to the column holding a wide panel. */
  wideColumnClassName?: string;
  /** Applied to every other column. */
  narrowColumnClassName?: string;
}

/** True while the viewport matches the query, tracked live. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Below this the grid is a single column, so column sizing does not apply. */
const WIDE_VIEWPORT = "(min-width: 1280px)";

/**
 * Renders panels in reorderable columns. Panels move by dragging their handle
 * with a mouse, pen or finger, or from the keyboard once the handle is focused.
 * Pointer events are used rather than HTML5 drag-and-drop so the same code path
 * covers touch devices.
 */
export function PanelGrid({
  lab, fallback, panels, className,
  widePanels, narrowWidth = 400, wideColumnClassName, narrowColumnClassName,
}: PanelGridProps) {
  const layouts = useLayoutStore((s) => s.layouts);
  const move = useLayoutStore((s) => s.move);
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<DropTarget | null>(null);
  targetRef.current = target;

  const layout = useMemo(() => {
    const saved = layouts[lab];
    const known = new Set(fallback.flat());
    const placed = new Set<string>();
    const columns: LabLayout = Array.from({ length: fallback.length }, () => []);
    (saved ?? fallback).forEach((col, i) => {
      const to = Math.min(i, columns.length - 1);
      for (const id of col) {
        if (known.has(id) && !placed.has(id)) {
          columns[to]!.push(id);
          placed.add(id);
        }
      }
    });
    fallback.forEach((col, i) => {
      for (const id of col) if (!placed.has(id)) columns[i]!.push(id);
    });
    return columns;
  }, [layouts, lab, fallback]);

  /** Where would a drop at this point land? */
  const resolveTarget = useCallback((x: number, y: number): DropTarget | null => {
    const root = rootRef.current;
    if (!root) return null;
    const stack = document.elementsFromPoint(x, y);
    const panel = stack.find((el) => el instanceof HTMLElement && el.dataset.panel && root.contains(el)) as HTMLElement | undefined;
    if (panel) {
      const column = Number(panel.dataset.column);
      const index = Number(panel.dataset.index);
      const rect = panel.getBoundingClientRect();
      return { column, index: y > rect.top + rect.height / 2 ? index + 1 : index };
    }
    const column = stack.find((el) => el instanceof HTMLElement && el.dataset.column !== undefined && root.contains(el)) as HTMLElement | undefined;
    if (column) {
      const index = Number(column.dataset.column);
      return { column: index, index: layout[index]?.length ?? 0 };
    }
    return null;
  }, [layout]);

  const startDrag = useCallback(
    (panelId: PanelId) => {
      setDragging(panelId);
      const onMove = (e: PointerEvent) => {
        e.preventDefault();
        setTarget(resolveTarget(e.clientX, e.clientY));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const drop = targetRef.current;
        if (drop) move(lab, fallback, panelId, drop.column, drop.index);
        setDragging(null);
        setTarget(null);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [fallback, lab, move, resolveTarget],
  );

  // Escape abandons a drag in progress.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        targetRef.current = null;
        setTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  const moveByKey = (panel: PanelId, column: number, index: number, key: string) => {
    if (key === "ArrowUp") move(lab, fallback, panel, column, Math.max(0, index - 1));
    else if (key === "ArrowDown") move(lab, fallback, panel, column, index + 1);
    else if (key === "ArrowLeft" && column > 0) move(lab, fallback, panel, column - 1, layout[column - 1]!.length);
    else if (key === "ArrowRight" && column < layout.length - 1) move(lab, fallback, panel, column + 1, layout[column + 1]!.length);
  };

  const wideViewport = useMediaQuery(WIDE_VIEWPORT);
  // The wide column is wherever the wide panels ended up, falling back to the first.
  const wideColumn = useMemo(
    () => wideColumnIndex(layout, widePanels?.filter((id) => panels[id])),
    [layout, widePanels, panels],
  );

  const gridStyle: CSSProperties | undefined =
    wideViewport && layout.length > 1
      ? { gridTemplateColumns: layout.map((_, i) => (i === wideColumn ? "minmax(0,1fr)" : `${narrowWidth}px`)).join(" ") }
      : undefined;

  const renderColumn = (column: PanelId[], columnIndex: number) => (
    <div
      key={`col-${columnIndex}`}
      data-column={columnIndex}
      className={cn(columnIndex === wideColumn ? wideColumnClassName : narrowColumnClassName)}
    >
      {column.map((panelId, index) => {
        const content = panels[panelId];
        if (!content) return null;
        const marker = target?.column === columnIndex && target.index === index;
        return (
          <div
            key={panelId}
            data-panel={panelId}
            data-column={columnIndex}
            data-index={index}
            className={cn(
              "relative min-w-0 transition-opacity",
              marker && "before:absolute before:-top-2 before:inset-x-0 before:h-0.5 before:rounded-full before:bg-accent-soft",
              dragging === panelId && "opacity-40",
            )}
          >
            <HandleContext.Provider
              value={
                <Handle
                  dragging={dragging === panelId}
                  onStart={() => startDrag(panelId)}
                  onKey={(key) => moveByKey(panelId, columnIndex, index, key)}
                  position={`column ${columnIndex + 1}, position ${index + 1} of ${column.length}`}
                />
              }
            >
              {content}
            </HandleContext.Provider>
          </div>
        );
      })}
      {dragging ? (
        <div
          aria-hidden="true"
          className={cn(
            "rounded-xl border border-dashed transition-colors min-h-[52px] grid place-items-center mono text-[10.5px] uppercase tracking-[0.12em]",
            target?.column === columnIndex && target.index >= column.length
              ? "border-accent/70 bg-accent/10 text-ink-dim"
              : "border-line text-faint",
          )}
        >
          drop here
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={rootRef} className={className} style={gridStyle}>
      {layout.map((column, columnIndex) => renderColumn(column, columnIndex))}
    </div>
  );
}

function Handle({ dragging, onStart, onKey, position }: { dragging: boolean; onStart: () => void; onKey: (key: string) => void; position: string }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        onStart();
      }}
      onKeyDown={(e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          onKey(e.key);
        }
      }}
      title="Drag to move this panel, or focus it and use the arrow keys"
      aria-label={`Move panel. Currently ${position}. Use the arrow keys to reposition.`}
      className={cn(
        "-ml-1 inline-flex size-6 shrink-0 touch-none items-center justify-center rounded",
        dragging ? "cursor-grabbing text-ink surface-3" : "cursor-grab text-faint hover:text-ink-dim hover:surface-2",
      )}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
  );
}
