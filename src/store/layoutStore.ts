import { create } from "zustand";

export type PanelId = string;
/** One entry per column, holding the panel ids stacked in that column. */
export type LabLayout = PanelId[][];

const STORAGE = "inferlab.layout.v1";
/** Written by an earlier build that let panels be resized; cleared on load. */
const RETIRED_SIZE_STORAGE = "inferlab.sizes.v1";

function dropRetiredSizes(): void {
  try {
    window.localStorage.removeItem(RETIRED_SIZE_STORAGE);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}

function read(): Record<string, LabLayout> {
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, LabLayout> = {};
    for (const [lab, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every((c) => Array.isArray(c) && c.every((id) => typeof id === "string"))) {
        out[lab] = value as LabLayout;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(layouts: Record<string, LabLayout>): void {
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(layouts));
  } catch {
    /* storage unavailable; arrangement simply will not persist */
  }
}

/**
 * Reconciles a saved arrangement against the panels a lab currently ships:
 * unknown ids are dropped, and panels added since the layout was saved are
 * appended to the column they default to, so an update never loses a panel.
 */
export function reconcile(saved: LabLayout | undefined, fallback: LabLayout): LabLayout {
  if (!saved) return fallback.map((c) => [...c]);
  const known = new Set(fallback.flat());
  const placed = new Set<string>();
  const columns: LabLayout = Array.from({ length: fallback.length }, () => []);
  saved.forEach((col, i) => {
    const target = Math.min(i, columns.length - 1);
    for (const id of col) {
      if (known.has(id) && !placed.has(id)) {
        columns[target]!.push(id);
        placed.add(id);
      }
    }
  });
  fallback.forEach((col, i) => {
    for (const id of col) if (!placed.has(id)) columns[i]!.push(id);
  });
  return columns;
}

/** Moves a panel to a column and index, returning a new arrangement. */
export function movePanel(layout: LabLayout, panelId: PanelId, toColumn: number, toIndex: number): LabLayout {
  const columns = layout.map((c) => c.filter((id) => id !== panelId));
  const target = Math.max(0, Math.min(toColumn, columns.length - 1));
  const index = Math.max(0, Math.min(toIndex, columns[target]!.length));
  columns[target]!.splice(index, 0, panelId);
  return columns;
}

/**
 * Which column should take the flexible track. A panel that needs room, such as
 * a diagram, drags the space along with it; if none of them are on the page the
 * first column stays wide.
 */
export function wideColumnIndex(layout: LabLayout, widePanels: PanelId[] | undefined): number {
  if (!widePanels || widePanels.length === 0) return 0;
  const found = layout.findIndex((col) => col.some((id) => widePanels.includes(id)));
  return found === -1 ? 0 : found;
}

export interface LayoutState {
  layouts: Record<string, LabLayout>;
  /** Panel currently being dragged, so drop targets can highlight. */
  dragging: { lab: string; panel: PanelId } | null;
  get: (lab: string, fallback: LabLayout) => LabLayout;
  move: (lab: string, fallback: LabLayout, panelId: PanelId, toColumn: number, toIndex: number) => void;
  reset: (lab?: string) => void;
  setDragging: (dragging: { lab: string; panel: PanelId } | null) => void;
  hasCustomLayout: (lab?: string) => boolean;
}

dropRetiredSizes();

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layouts: read(),
  dragging: null,

  get: (lab, fallback) => reconcile(get().layouts[lab], fallback),

  move: (lab, fallback, panelId, toColumn, toIndex) =>
    set((s) => {
      const current = reconcile(s.layouts[lab], fallback);
      const next = { ...s.layouts, [lab]: movePanel(current, panelId, toColumn, toIndex) };
      write(next);
      return { layouts: next };
    }),

  reset: (lab) =>
    set((s) => {
      if (!lab) {
        write({});
        return { layouts: {} };
      }
      const { [lab]: _dropped, ...rest } = s.layouts;
      void _dropped;
      write(rest);
      return { layouts: rest };
    }),

  setDragging: (dragging) => set({ dragging }),

  hasCustomLayout: (lab) => (lab ? get().layouts[lab] !== undefined : Object.keys(get().layouts).length > 0),
}));
