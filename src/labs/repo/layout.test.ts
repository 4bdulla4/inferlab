import { describe, expect, it } from "vitest";
import type { ArchEdge, ArchNode } from "@shared/repo";
import { COLUMN_W, layoutGraph } from "./layout";

const node = (id: string, layer: number, category: ArchNode["category"]): ArchNode => ({ id, label: id, category, layer, summary: "", files: [], routes: [], symbols: [], dependencies: [], envVars: [], integrations: [], evidence: [] });
const edge = (from: string, to: string): ArchEdge => ({ id: `${from}→${to}`, from, to, kind: "imports", label: "imports", evidence: { kind: "verified" }, weight: 1 });

describe("layoutGraph", () => {
  it("compacts empty layers into consecutive columns and routes edges left to right", () => {
    const nodes = [node("client", 0, "client"), node("api", 2, "api"), node("db", 4, "data"), node("ai", 5, "ai")];
    const l = layoutGraph(nodes, [edge("client", "api"), edge("api", "db"), edge("db", "api")]);
    expect(l.columns.map((c) => c.layer)).toEqual([0, 2, 4, 5]);
    expect(l.width).toBe(5 * COLUMN_W);
    const api = l.nodes.find((n) => n.node.id === "api")!;
    expect(api.column).toBe(1);
    const forward = l.edges.find((e) => e.edge.id === "api→db")!;
    expect(forward.backwards).toBe(false);
    expect(forward.points[0]![0]).toBeGreaterThan(api.x);
    const back = l.edges.find((e) => e.edge.id === "db→api")!;
    expect(back.backwards).toBe(true);
    expect(l.height).toBeGreaterThanOrEqual(420);
  });
  it("omits hidden nodes and their edges", () => {
    const nodes = [node("a", 0, "client"), node("b", 1, "frontend")];
    const l = layoutGraph(nodes, [edge("a", "b")], new Set(["b"]));
    expect(l.nodes).toHaveLength(1);
    expect(l.edges).toHaveLength(0);
  });
});
