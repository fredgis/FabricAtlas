import { describe, expect, it } from "vitest";
import {
  createItemRelationsEvidence,
  itemRelationsNodeKey,
  recordItemRelationsResponse,
  type ItemRelationsDirection,
} from "./item-relations-evidence";
import { snapshotFromData } from "./history";
import {
  buildLineageEvidence,
  buildPreviewOverlay,
  lineageChangesBetween,
  relationshipMatches,
} from "./lineage-evidence";
import type { AtlasData, Edge, Item } from "./model";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const LAKEHOUSE = "aaaaaaaa-0000-4000-8000-000000000001";
const MODEL = "aaaaaaaa-0000-4000-8000-000000000002";
const REPORT = "aaaaaaaa-0000-4000-8000-000000000003";
const PIPELINE = "aaaaaaaa-0000-4000-8000-000000000004";
const NOTEBOOK = "aaaaaaaa-0000-4000-8000-000000000005";
const WAREHOUSE = "aaaaaaaa-0000-4000-8000-000000000006";
const EXTERNAL = "bbbbbbbb-0000-4000-8000-000000000001";
const OBSERVED = "2026-10-01T08:00:00.000Z";

function item(fabricId: string, itemType: Item["itemType"], displayName: string): Item {
  return {
    fabricId,
    itemType,
    displayName,
    health: "healthy",
    endorsement: "none",
    tags: [],
  };
}

const items: Item[] = [
  item(LAKEHOUSE, "Lakehouse", "Sales lakehouse"),
  item(MODEL, "SemanticModel", "Sales model"),
  item(REPORT, "Report", "Sales report"),
  item(PIPELINE, "DataPipeline", "Daily load"),
  item(NOTEBOOK, "Notebook", "Transform"),
  item(WAREHOUSE, "Warehouse", "Finance warehouse"),
];

const edges: Edge[] = [
  { source: LAKEHOUSE, target: MODEL, relation: "Direct Lake" },
  // Stored reversed on purpose: normalization must restore source to consumer.
  { source: REPORT, target: MODEL, relation: "binds" },
  { source: PIPELINE, target: NOTEBOOK, relation: "orchestrates" },
  { source: NOTEBOOK, target: WAREHOUSE, relation: "writes" },
];

function query(
  itemId: string,
  direction: ItemRelationsDirection,
  payload: unknown,
) {
  return recordItemRelationsResponse(itemId, direction, OBSERVED, payload);
}

function evidence() {
  return createItemRelationsEvidence(WORKSPACE, OBSERVED, [
    query(MODEL, "upstream", {
      items: [
        { id: LAKEHOUSE, workspaceId: WORKSPACE, type: "Lakehouse", displayName: "Sales lakehouse" },
        { id: EXTERNAL, workspaceId: EXTERNAL_WORKSPACE, type: "Lakehouse", displayName: "Shared lakehouse" },
      ],
      relations: [
        // Datasource draws dependency -> dependent: Sales model -> Sales lakehouse.
        { itemId: LAKEHOUSE, dependentOnItemId: MODEL, relationType: "Datasource" },
        { itemId: MODEL, dependentOnItemId: EXTERNAL, relationType: "Shortcut" },
        { itemId: MODEL, dependentOnItemId: REPORT, relationType: "FutureRelation" },
      ],
      workspaces: [{ id: EXTERNAL_WORKSPACE, displayName: "Shared data" }],
    }),
    query(PIPELINE, "downstream", {
      items: [
        { id: NOTEBOOK, workspaceId: WORKSPACE, type: "Notebook", displayName: "Transform" },
        { id: WAREHOUSE, workspaceId: WORKSPACE, type: "Warehouse", displayName: "Finance warehouse" },
      ],
      relations: [
        { itemId: PIPELINE, dependentOnItemId: NOTEBOOK, relationType: "Orchestration" },
        { itemId: WAREHOUSE, dependentOnItemId: LAKEHOUSE, relationType: "Shortcut" },
        { itemId: NOTEBOOK, dependentOnItemId: PIPELINE, relationType: "HiddenInWorkspace" },
      ],
      workspaces: [],
    }),
  ]);
}

describe("unified lineage evidence", () => {
  it("normalizes Atlas snapshot lineage and labels it as the only source without Preview", () => {
    const frozen = Object.freeze(edges.map((edge) => Object.freeze({ ...edge })));
    const model = buildLineageEvidence({
      items,
      edges: frozen,
      workspaceId: WORKSPACE,
      workspaceName: "Sales",
    });

    expect(model.previewGraph).toBeUndefined();
    expect(model.relationships).toHaveLength(4);
    expect(model.counts.snapshot).toBe(4);
    expect(model.authoritativeEdges).toContainEqual({
      source: MODEL,
      target: REPORT,
      relation: "binds",
      broken: undefined,
    });
    const binds = model.relationships.find(
      (relationship) => relationship.target.id === REPORT,
    );
    expect(binds).toMatchObject({
      source: { id: MODEL, displayName: "Sales model", workspaceName: "Sales" },
      target: { id: REPORT, inSnapshot: true },
      agreement: "snapshot",
      preview: [],
    });
    expect(frozen[1]).toEqual({ source: REPORT, target: MODEL, relation: "binds" });
  });

  it("compares Preview evidence by source without changing Atlas lineage", () => {
    const model = buildLineageEvidence({
      items,
      edges,
      workspaceId: WORKSPACE.toUpperCase(),
      workspaceName: "Sales",
      evidence: evidence(),
    });
    const byTarget = (sourceId: string, targetId: string) =>
      model.relationships.find(
        (relationship) =>
          [relationship.source.id, relationship.target.id].sort().join() ===
          [sourceId, targetId].sort().join(),
      );

    expect(byTarget(LAKEHOUSE, MODEL)?.agreement).toBe("conflict");
    expect(byTarget(PIPELINE, NOTEBOOK)?.agreement).toBe("agree");
    expect(byTarget(MODEL, REPORT)?.agreement).toBe("unverified");
    expect(byTarget(LAKEHOUSE, WAREHOUSE)?.agreement).toBe("preview-only");
    expect(byTarget(MODEL, EXTERNAL)).toMatchObject({
      agreement: "cross-workspace",
      crossWorkspace: true,
      source: {
        key: itemRelationsNodeKey(EXTERNAL_WORKSPACE, EXTERNAL),
        displayName: "Shared lakehouse",
        workspaceName: "Shared data",
        inSnapshot: false,
        isLocal: false,
      },
    });
    expect(
      byTarget(PIPELINE, NOTEBOOK)
        ?.preview.map((entry) => entry.status)
        .sort(),
    ).toEqual(["matching", "not-lineage"]);
    expect(byTarget(NOTEBOOK, WAREHOUSE)?.agreement).toBe("not-covered");
    expect(model.relationships[0].agreement).toBe("conflict");
    expect(model.authoritativeEdges).toHaveLength(edges.length);
    expect(
      model.relationships.every((relationship) =>
        relationship.authoritative.every(
          (edge) => !("evidenceSource" in edge),
        ),
      ),
    ).toBe(true);
  });

  it("reports authoritative edges without Preview coverage as not covered", () => {
    const model = buildLineageEvidence({
      items,
      edges,
      workspaceId: WORKSPACE,
      evidence: createItemRelationsEvidence(WORKSPACE, OBSERVED, [
        query(LAKEHOUSE, "downstream", { items: [], relations: [], workspaces: [] }),
      ]),
    });

    expect(model.counts["snapshot-only"]).toBe(1);
    expect(model.counts["not-covered"]).toBe(3);
  });

  it("ignores evidence collected for another workspace", () => {
    const model = buildLineageEvidence({
      items,
      edges,
      workspaceId: EXTERNAL_WORKSPACE,
      evidence: evidence(),
    });

    expect(model.previewGraph).toBeUndefined();
    expect(model.counts.snapshot).toBe(4);
  });

  it("searches names, workspaces and relation types", () => {
    const model = buildLineageEvidence({
      items,
      edges,
      workspaceId: WORKSPACE,
      evidence: evidence(),
    });
    const cross = model.relationships.find(
      (relationship) => relationship.agreement === "cross-workspace",
    )!;

    expect(relationshipMatches(cross, "shared data")).toBe(true);
    expect(relationshipMatches(cross, "shortcut")).toBe(true);
    expect(relationshipMatches(cross, "warehouse")).toBe(false);
  });
});

describe("Preview graph overlay", () => {
  const model = buildLineageEvidence({
    items,
    edges,
    workspaceId: WORKSPACE,
    evidence: evidence(),
  });
  const options = {
    laneX: 900,
    nodeWidth: 220,
    rowGap: 100,
    top: 46,
  };

  it("draws only disagreements and places outside endpoints in a separate lane", () => {
    const overlay = buildPreviewOverlay(model, WORKSPACE, {
      ...options,
      visibleItemIds: new Set(items.map((entry) => entry.fabricId)),
    });

    expect(
      overlay.edges.map((edge) => edge.entry.edge.relation.relationType).sort(),
    ).toEqual(["Datasource", "FutureRelation", "Shortcut", "Shortcut"]);
    expect(overlay.laneNodes).toEqual([
      expect.objectContaining({
        key: itemRelationsNodeKey(EXTERNAL_WORKSPACE, EXTERNAL),
        x: 900,
        y: 46,
      }),
    ]);
    expect(overlay.laneWidth).toBeGreaterThan(220);
  });

  it("skips edges to filtered snapshot items and keeps lane positions stable", () => {
    const all = buildPreviewOverlay(model, WORKSPACE, {
      ...options,
      visibleItemIds: new Set(items.map((entry) => entry.fabricId)),
    });
    const filtered = buildPreviewOverlay(model, WORKSPACE, {
      ...options,
      visibleItemIds: new Set([MODEL, LAKEHOUSE]),
    });

    expect(
      filtered.edges.map((edge) => edge.entry.edge.relation.relationType).sort(),
    ).toEqual(["Datasource", "Shortcut"]);
    expect(filtered.laneNodes).toEqual(all.laneNodes);
  });
});

describe("lineage changes", () => {
  it("lists added, removed and broken-state lineage with item names", () => {
    const base: AtlasData = {
      workspace: { fabricId: WORKSPACE, displayName: "Sales", capacity: "", region: "" },
      items,
      edges: edges.slice(0, 3),
      principals: [],
      grants: [],
      jobs: [],
      comments: [],
      config: [],
      syncRuns: [],
    } as unknown as AtlasData;
    const previous = snapshotFromData(base, "previous");
    const current = snapshotFromData(
      {
        ...base,
        edges: [
          { ...edges[0], broken: true },
          edges[1],
          edges[3],
        ],
      },
      "current",
    );

    const rows = lineageChangesBetween(previous, current);

    expect(
      rows.map((row) => [row.change.type, row.sourceName, row.targetName]),
    ).toEqual(
      expect.arrayContaining([
        ["lineage-added", "Transform", "Finance warehouse"],
        ["lineage-removed", "Daily load", "Transform"],
        ["lineage-broken-state-changed", "Sales lakehouse", "Sales model"],
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.find((row) => row.change.type === "lineage-broken-state-changed")
        ?.relation,
    ).toBe("Direct Lake");
  });
});
