import { describe, expect, it, vi } from "vitest";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  runKqlCollectorShadow,
} from "./kql-collector-shadow";
import type { KqlMetadataStageEnvelope } from "../../rayfin/functions/src/workspace-kql-metadata";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const EVENTHOUSE = "22222222-2222-4222-8222-222222222222";
const DATABASE = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";
const CORRELATION = "55555555-5555-4555-8555-555555555555";

function coreEnvelope(): CoreCollectorEnvelope {
  return {
    schemaVersion: 2,
    syncMode: "base",
    workspace: { id: WORKSPACE },
    items: [
      { id: EVENTHOUSE, type: "Eventhouse" },
      { id: DATABASE, type: "KQLDatabase" },
      { id: REPORT, type: "Report" },
    ],
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
      [EVENTHOUSE]: { scannerMatched: false, ownerAvailable: false },
      [DATABASE]: { scannerMatched: false, ownerAvailable: false },
      [REPORT]: { scannerMatched: false, ownerAvailable: false },
    },
  };
}

function envelope(): KqlMetadataStageEnvelope {
  return {
    contractVersion: 1,
    stage: "kql-metadata",
    authoritative: false,
    workspaceId: WORKSPACE,
    items: [
      { id: EVENTHOUSE, type: "Eventhouse", status: "complete" },
      { id: DATABASE, type: "KQLDatabase", status: "complete" },
    ],
    schemas: {
      [DATABASE]: {
        status: "complete",
        source: "fabric-kql-database-definition",
        tables: [
          {
            name: "Events",
            columns: [{ name: "Id", dataType: "guid" }],
          },
        ],
        functions: [{ name: "Recent", parameters: [] }],
        materializedViews: [
          { name: "EventsByHour", sourceTable: "Events" },
        ],
      },
    },
    artifactMetadata: {
      [DATABASE]: {
        kind: "kql",
        functions: [{ name: "Recent", parameters: [] }],
        materializedViews: [
          { name: "EventsByHour", sourceTable: "Events", columns: [] },
        ],
      },
    },
    config: [],
    sections: {
      kqlProperties: { status: "complete" },
      kqlSchema: { status: "complete" },
    },
    capabilities: { kqlSchema: { status: "complete" } },
    blockers: [
      {
        capability: "kqlDataPlaneSchema",
        code: "kusto-audience-unsupported",
        observedOn: "2026-10-02",
        rayfinVersion: "1.36.2",
        replacement: "fabric-kql-database-definition",
      },
    ],
    errors: [],
    syncedAt: "2026-10-02T10:01:00.000Z",
  };
}

describe("KQL collector shadow", () => {
  it("does nothing while the candidate-only flag is disabled", async () => {
    const invoke = vi.fn();
    await expect(
      runKqlCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: false,
          client: {
            functions: { workspaceCollectKqlMetadata: { invoke } },
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes only KQL families and returns structural counters", async () => {
    const invoke = vi.fn(async () => envelope());
    await expect(
      runKqlCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: { workspaceCollectKqlMetadata: { invoke } },
          },
        },
      ),
    ).resolves.toBe(
      "KQL shadow complete=2; unsupported=0; failed=0; schemas=1; tables=1; functions=1; views=1; blockers=kusto-audience-unsupported",
    );
    expect(invoke).toHaveBeenCalledWith(
      {
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        items: [
          { id: EVENTHOUSE, type: "Eventhouse" },
          { id: DATABASE, type: "KQLDatabase" },
        ],
        correlationId: CORRELATION,
      },
      { timeoutMs: 180_000 },
    );
  });

  it("does not expose invalid response details", async () => {
    const warn = vi.fn();
    const marker = "private KQL definition";
    await expect(
      runKqlCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: {
              workspaceCollectKqlMetadata: {
                invoke: vi.fn(async () => {
                  throw new Error(marker);
                }),
              },
            },
          },
          warn,
        },
      ),
    ).resolves.toBe("KQL shadow unavailable");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
