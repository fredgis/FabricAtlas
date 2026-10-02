import { describe, expect, it, vi } from "vitest";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  runItemRelationsCollectorShadow,
} from "./item-relations-collector-shadow";
import type { ItemRelationsEvidenceEnvelope } from "../../rayfin/functions/src/workspace-item-relations";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CORRELATION = "44444444-4444-4444-8444-444444444444";

function coreEnvelope(): CoreCollectorEnvelope {
  return {
    schemaVersion: 2,
    syncMode: "base",
    workspace: { id: WORKSPACE },
    items: [{ id: ITEM, type: "SemanticModel" }],
    roleAssignments: [],
    jobs: [],
    sections: {} as CoreCollectorEnvelope["sections"],
    capabilities: {} as CoreCollectorEnvelope["capabilities"],
    errors: [],
    syncedAt: "2026-10-02T10:00:00.000Z",
    lineage: [],
    access: [],
    config: [],
    objectEdges: [],
    schema: {},
    artifactMetadata: {},
    itemMetadata: {
      [ITEM]: { scannerMatched: false, ownerAvailable: false },
    },
  };
}

function evidenceEnvelope(): ItemRelationsEvidenceEnvelope {
  const response = {
    items: [
      {
        id: OTHER,
        workspaceId: OTHER,
        type: "Lakehouse",
        displayName: "External lakehouse",
      },
    ],
    relations: [
      {
        itemId: ITEM,
        dependentOnItemId: OTHER,
        relationType: "Datasource",
      },
    ],
    workspaces: [{ id: OTHER, displayName: "External" }],
  };
  return {
    schemaVersion: 1,
    source: "fabric-item-relations-api-beta",
    apiVersion: "v1-beta",
    workspaceId: WORKSPACE,
    collectedAt: "2026-10-02T10:01:00.000Z",
    authoritative: false,
    queries: [
      {
        itemId: ITEM,
        direction: "upstream",
        status: "complete",
        attemptedAt: "2026-10-02T10:01:00.000Z",
        observedAt: "2026-10-02T10:01:00.000Z",
        response,
      },
      {
        itemId: ITEM,
        direction: "downstream",
        status: "failed",
        attemptedAt: "2026-10-02T10:01:01.000Z",
        failureCode: "item-not-found",
      },
    ],
  };
}

describe("Item Relations collector shadow", () => {
  it("does nothing while the candidate-only flag is disabled", async () => {
    const invoke = vi.fn();
    await expect(
      runItemRelationsCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: false,
          client: {
            functions: {
              workspaceCollectItemRelations: { invoke },
            },
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("collects both directions and returns only bounded counters", async () => {
    const invoke = vi.fn(async () => evidenceEnvelope());
    await expect(
      runItemRelationsCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: {
              workspaceCollectItemRelations: { invoke },
            },
          },
        },
      ),
    ).resolves.toBe(
      "Item Relations shadow complete=1; failed=1; relations=1; externalWorkspaces=1; sampled=1/1; codes=item-not-found",
    );
    expect(invoke).toHaveBeenCalledWith(
      {
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        itemIds: [ITEM],
        correlationId: CORRELATION,
      },
      { timeoutMs: 180_000 },
    );
  });

  it("does not expose malformed response details", async () => {
    const warn = vi.fn();
    const marker = "private Beta response";
    await expect(
      runItemRelationsCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: {
              workspaceCollectItemRelations: {
                invoke: vi.fn(async () => {
                  throw new Error(marker);
                }),
              },
            },
          },
          warn,
        },
      ),
    ).resolves.toBe("Item Relations shadow unavailable");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
