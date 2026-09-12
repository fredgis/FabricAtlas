import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildItemRelationsBetaGraph,
  buildItemRelationsRequestBody,
  classifyItemRelation,
  compareItemRelationsWithCurrent,
  itemRelationsUdfUrl,
  itemRelationsNodeKey,
  parseItemRelationsBetaSlice,
  type ItemRelationsBetaCollection,
  type ItemRelationsBetaGraph,
} from "./item-relations-beta";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const rootId = "22222222-2222-4222-8222-222222222222";
const dependencyId = "33333333-3333-4333-8333-333333333333";
const externalWorkspaceId = "44444444-4444-4444-8444-444444444444";
const correlationId = "55555555-5555-4555-8555-555555555555";
const functionId = "66666666-6666-4666-8666-666666666666";
const configuredUdfUrl =
  `https://workspace.z6b.userdatafunctions.fabric.microsoft.com/v1/workspaces/${workspaceId}` +
  `/userDataFunctions/${functionId}/functions/sync_all/invoke`;

afterEach(() => {
  vi.unstubAllEnvs();
});

function sliceValue() {
  return {
    schemaVersion: 1,
    source: "fabric-item-relations-api-beta",
    apiVersion: "beta",
    correlationId,
    workspaceId,
    directions: ["upstream", "downstream"],
    requestedItemIds: [rootId],
    completedItemIds: [rootId],
    remainingItemIds: [],
    itemFailures: {},
    items: [
      {
        id: dependencyId,
        workspaceId: externalWorkspaceId,
        type: "FutureFabricItem",
        displayName: "External source",
      },
    ],
    relations: [
      {
        itemId: rootId,
        dependentOnItemId: dependencyId,
        relationType: "FutureRelation",
      },
    ],
    workspaces: [
      {
        id: externalWorkspaceId,
        displayName: "External workspace",
      },
    ],
    queries: [
      {
        itemId: rootId,
        direction: "upstream",
        status: "complete",
        itemCount: 1,
        relationCount: 1,
        workspaceCount: 1,
        durationMs: 12,
      },
      {
        itemId: rootId,
        direction: "downstream",
        status: "complete",
        itemCount: 0,
        relationCount: 0,
        workspaceCount: 0,
        durationMs: 8,
      },
    ],
    requestCount: 2,
    errors: [],
    durationMs: 20,
    syncedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Item Relations Beta response contract", () => {
  it("sends the direct UDF argument object expected by Fabric", () => {
    expect(
      buildItemRelationsRequestBody(
        workspaceId,
        "fabric-token",
        [rootId],
        correlationId,
      ),
    ).toEqual({
      workspaceId,
      fabricToken: "fabric-token",
      itemIds: JSON.stringify([rootId]),
      correlationId,
    });
  });

  it("uses the Rayfin public UDF setting and retargets the Beta function", () => {
    vi.stubEnv("VITE_RAYFIN_ATLAS_UDF_URL", configuredUdfUrl);

    expect(itemRelationsUdfUrl(workspaceId)).toBe(
      configuredUdfUrl.replace(
        "/functions/sync_all/invoke",
        "/functions/sync_item_relations/invoke",
      ),
    );
  });

  it("accepts wrapped responses and preserves unknown API values", () => {
    const parsed = parseItemRelationsBetaSlice(
      JSON.stringify({ output: sliceValue() }),
      workspaceId,
      [rootId],
      correlationId,
    );

    expect(parsed.items[0].type).toBe("FutureFabricItem");
    expect(parsed.relations[0].relationType).toBe("FutureRelation");
    expect(parsed.queries.map((query) => query.direction)).toEqual([
      "upstream",
      "downstream",
    ]);
  });

  it("rejects relations whose endpoint metadata is missing", () => {
    const value = sliceValue();
    value.items = [];

    expect(() =>
      parseItemRelationsBetaSlice(
        JSON.stringify(value),
        workspaceId,
        [rootId],
        correlationId,
      ),
    ).toThrow(/omitted metadata for a relation endpoint/i);
  });
});

describe("Item Relations Beta graph", () => {
  const collection: ItemRelationsBetaCollection = {
    correlationId,
    workspaceId,
    requestedItemIds: [rootId],
    completedItemIds: [rootId],
    itemFailures: {},
    items: [
      {
        id: dependencyId,
        workspaceId: externalWorkspaceId,
        type: "Lakehouse",
        displayName: "External source",
      },
    ],
    relations: [
      {
        itemId: rootId,
        dependentOnItemId: dependencyId,
        relationType: "Datasource",
      },
    ],
    workspaces: [
      {
        id: externalWorkspaceId,
        displayName: "External workspace",
      },
    ],
    queries: [],
    errors: [],
    requestCount: 2,
    sliceCount: 1,
    durationMs: 20,
    collectedAt: "2026-01-01T00:00:00.000Z",
  };

  it("uses composite IDs and keeps cross-workspace evidence", () => {
    const graph = buildItemRelationsBetaGraph(
      collection,
      [
        {
          fabricId: rootId,
          displayName: "Local model",
          itemType: "SemanticModel",
        },
      ],
      "Current workspace",
    );

    expect(graph.nodes).toHaveLength(2);
    expect(
      graph.nodes.find((node) => node.id === dependencyId),
    ).toMatchObject({
      workspaceName: "External workspace",
      isLocal: false,
    });
    expect(graph.edges[0]).toMatchObject({
      sourceKey: itemRelationsNodeKey(
        externalWorkspaceId,
        dependencyId,
      ),
      targetKey: itemRelationsNodeKey(workspaceId, rootId),
      relationClass: "data",
    });
  });

  it("classifies known and unknown relation types without closing the enum", () => {
    expect(classifyItemRelation("Orchestration")).toBe("orchestration");
    expect(classifyItemRelation("CascadeDelete")).toBe("lifecycle");
    expect(classifyItemRelation("HiddenInWorkspace")).toBe("visibility");
    expect(classifyItemRelation("FutureRelation")).toBe("association");
  });

  it("compares local direction while counting cross-workspace relations", () => {
    const local = (id: string) => ({
      key: itemRelationsNodeKey(workspaceId, id),
      id,
      workspaceId,
      workspaceName: "Current workspace",
      displayName: id,
      itemType: "Unknown",
      isLocal: true,
    });
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const external = {
      key: itemRelationsNodeKey(externalWorkspaceId, dependencyId),
      id: dependencyId,
      workspaceId: externalWorkspaceId,
      workspaceName: "External workspace",
      displayName: "External",
      itemType: "Lakehouse",
      isLocal: false,
    };
    const graph: ItemRelationsBetaGraph = {
      nodes: [local(a), local(b), local(c), external],
      edges: [
        {
          id: "match",
          sourceKey: itemRelationsNodeKey(workspaceId, a),
          targetKey: itemRelationsNodeKey(workspaceId, b),
          rawItemId: b,
          rawDependentOnItemId: a,
          relationType: "Association",
          relationClass: "association",
        },
        {
          id: "reverse",
          sourceKey: itemRelationsNodeKey(workspaceId, b),
          targetKey: itemRelationsNodeKey(workspaceId, c),
          rawItemId: c,
          rawDependentOnItemId: b,
          relationType: "Association",
          relationClass: "association",
        },
        {
          id: "beta-only",
          sourceKey: itemRelationsNodeKey(workspaceId, a),
          targetKey: itemRelationsNodeKey(workspaceId, c),
          rawItemId: c,
          rawDependentOnItemId: a,
          relationType: "Association",
          relationClass: "association",
        },
        {
          id: "cross",
          sourceKey: external.key,
          targetKey: itemRelationsNodeKey(workspaceId, a),
          rawItemId: a,
          rawDependentOnItemId: dependencyId,
          relationType: "Datasource",
          relationClass: "data",
        },
      ],
      unresolvedRelationCount: 0,
    };

    const comparison = compareItemRelationsWithCurrent(graph, [
      { source: a, target: b, relation: "binds" },
      { source: c, target: b, relation: "reversed" },
      { source: "new-source", target: "new-target", relation: "current" },
    ]);

    expect(comparison).toMatchObject({
      matchingCount: 1,
      directionConflictCount: 1,
      betaOnlyCount: 1,
      currentOnlyCount: 1,
      localRelationCount: 3,
      crossWorkspaceRelationCount: 1,
    });
  });
});
