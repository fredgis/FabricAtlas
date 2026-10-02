import { describe, expect, it, vi } from "vitest";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  runPowerBiCollectorShadow,
  runSqlCollectorShadow,
} from "./remaining-collectors-shadow";
import type { SqlMetadataStageEnvelope } from "../../rayfin/functions/src/workspace-sql-metadata";
import type { PowerBiStageEnvelope } from "../../rayfin/functions/src/workspace-powerbi";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SQL_ITEM = "22222222-2222-4222-8222-222222222222";
const MODEL = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";
const CORRELATION = "55555555-5555-4555-8555-555555555555";

function core(): CoreCollectorEnvelope {
  return {
    schemaVersion: 2,
    syncMode: "base",
    workspace: { id: WORKSPACE },
    items: [
      { id: SQL_ITEM, type: "SQLDatabase" },
      { id: MODEL, type: "SemanticModel" },
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
      [SQL_ITEM]: { scannerMatched: false, ownerAvailable: false },
      [MODEL]: { scannerMatched: false, ownerAvailable: false },
      [REPORT]: { scannerMatched: false, ownerAvailable: false },
    },
  };
}

describe("remaining collector shadows", () => {
  it("summarizes SQL structural metadata", async () => {
    const invoke = vi.fn(async (): Promise<SqlMetadataStageEnvelope> => ({
      contractVersion: 1,
      stage: "sql-metadata",
      authoritative: false,
      workspaceId: WORKSPACE,
      items: [{ id: SQL_ITEM, type: "SQLDatabase", status: "complete" }],
      catalogs: { [SQL_ITEM]: { status: "complete" } },
      schema: {
        [SQL_ITEM]: [
          {
            name: "dbo.Table",
            objectType: "SQL table",
            source: "sql",
            columns: [{ name: "Id", dataType: "int" }],
            measures: [],
          },
        ],
      },
      artifactMetadata: {},
      config: [],
      sections: {
        sqlProperties: { status: "complete" },
        sqlSchema: { status: "complete" },
      },
      capabilities: { sqlSchema: { status: "complete" } },
      errors: [],
      syncedAt: "2026-10-02T10:01:00.000Z",
    }));
    await expect(
      runSqlCollectorShadow(WORKSPACE, CORRELATION, core(), {
        enabled: true,
        client: {
          functions: {
            workspaceCollectSqlMetadata: { invoke },
            workspaceCollectPowerBi: { invoke: vi.fn() },
          },
        },
      }),
    ).resolves.toBe(
      "SQL shadow complete=1; unsupported=0; failed=0; catalogs=1; objects=1; columns=1",
    );
  });

  it("summarizes supported Power BI replacement and blockers", async () => {
    const unavailable = {
      status: "unsupported",
      code: "not-applicable",
    } as const;
    const invoke = vi.fn(async (): Promise<PowerBiStageEnvelope> => ({
      contractVersion: 1,
      stage: "powerbi-metadata",
      authoritative: false,
      workspaceId: WORKSPACE,
      coverage: {
        modelSchema: "tmsl-structural-projection",
        daxExpressions: "sanitized-measures-and-calculated-columns",
        dependencies: "static-resolved-subset",
        pages: "pbir-only",
        ownershipAccess: "opt-in-fabric-admin-preview",
        itemLineage: "verified-same-workspace-model-to-report-subset",
      },
      items: [
        {
          id: MODEL,
          type: "SemanticModel",
          identity: { status: "complete" },
          definition: unavailable,
          schema: unavailable,
          expressions: unavailable,
          dependencies: unavailable,
          pages: unavailable,
          modelReference: unavailable,
          ownership: unavailable,
          access: unavailable,
          tags: unavailable,
        },
        {
          id: REPORT,
          type: "Report",
          identity: { status: "complete" },
          definition: unavailable,
          schema: unavailable,
          expressions: unavailable,
          dependencies: unavailable,
          pages: unavailable,
          modelReference: unavailable,
          ownership: unavailable,
          access: unavailable,
          tags: unavailable,
        },
      ],
      catalogItems: [],
      schema: {},
      models: {},
      reports: {},
      ownerEvidence: {},
      itemMetadata: {},
      accessEvidence: [],
      lineage: [],
      sections: {
        scanner: unavailable,
        lineage: unavailable,
        schema: unavailable,
        access: unavailable,
      },
      capabilities: {
        modelSchema: unavailable,
        daxExpressions: unavailable,
        mashupExpressions: unavailable,
        calculatedTableExpressions: unavailable,
        engineDependencies: unavailable,
        reportPages: unavailable,
        ownership: unavailable,
        accessDetails: unavailable,
        endorsement: unavailable,
        sensitivity: unavailable,
        tags: unavailable,
        scannerParity: unavailable,
      },
      blockers: [
        {
          capability: "scannerParity",
          code: "powerbi-audience-unavailable",
          observedOn: "2026-10-02",
          rayfinVersion: "1.36.2",
          requiredCapability: "Documented application token.",
        },
      ],
      errors: [],
      syncedAt: "2026-10-02T10:01:00.000Z",
    }));
    await expect(
      runPowerBiCollectorShadow(WORKSPACE, CORRELATION, core(), {
        enabled: true,
        client: {
          functions: {
            workspaceCollectSqlMetadata: { invoke: vi.fn() },
            workspaceCollectPowerBi: { invoke },
          },
        },
      }),
    ).resolves.toContain("Power BI shadow items=2");
  });
});
