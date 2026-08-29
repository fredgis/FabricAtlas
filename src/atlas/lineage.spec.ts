import { describe, expect, it } from "vitest";
import { buildStagedLayout, getLineageImpact, itemStage, lineageEdgeKey } from "./lineage";
import type { Edge, Item } from "./model";

const edges: Edge[] = [
  { source: "pipeline", target: "lakehouse", relation: "writes" },
  { source: "lakehouse", target: "model", relation: "Direct Lake" },
  { source: "model", target: "report-a", relation: "binds" },
  { source: "model", target: "report-b", relation: "binds" },
];

describe("getLineageImpact", () => {
  it("collects transitive upstream and downstream paths", () => {
    const impact = getLineageImpact(edges, "model");

    expect([...impact.upstream.ids]).toEqual(["lakehouse", "pipeline"]);
    expect([...impact.downstream.ids]).toEqual(["report-a", "report-b"]);
    expect(impact.upstream.distance.get("pipeline")).toBe(2);
    expect(impact.upstream.edgeKeys).toContain(lineageEdgeKey(edges[0]));
  });

  it("limits traversal depth for direct-neighbor mode", () => {
    const impact = getLineageImpact(edges, "model", 1);

    expect([...impact.upstream.ids]).toEqual(["lakehouse"]);
    expect([...impact.downstream.ids]).toEqual(["report-a", "report-b"]);
  });

  it("terminates safely when lineage contains a cycle", () => {
    const cyclic = [...edges, { source: "report-a", target: "model", relation: "cycle" }];
    const impact = getLineageImpact(cyclic, "model");

    expect(impact.downstream.ids.has("report-a")).toBe(true);
    expect(impact.downstream.ids.has("model")).toBe(false);
  });
});

describe("staged layout", () => {
  const item = (fabricId: string, itemType: Item["itemType"]): Item => ({
    fabricId,
    displayName: fabricId,
    itemType,
    health: "healthy",
    endorsement: "none",
    tags: [],
  });

  it("places Fabric item types in stable lifecycle stages", () => {
    expect(itemStage("Notebook")).toBe(0);
    expect(itemStage("Lakehouse")).toBe(1);
    expect(itemStage("SemanticModel")).toBe(2);
    expect(itemStage("Report")).toBe(3);
  });

  it("positions later lifecycle stages farther right", () => {
    const items = [
      item("notebook", "Notebook"),
      item("lakehouse", "Lakehouse"),
      item("model", "SemanticModel"),
      item("report", "Report"),
    ];
    const layout = buildStagedLayout(items, edges);

    expect(layout.positions.get("notebook")!.x).toBeLessThan(
      layout.positions.get("lakehouse")!.x,
    );
    expect(layout.positions.get("lakehouse")!.x).toBeLessThan(
      layout.positions.get("model")!.x,
    );
    expect(layout.positions.get("model")!.x).toBeLessThan(
      layout.positions.get("report")!.x,
    );
  });
});
