import { getRayfinClient } from "@/lib/rayfin-client";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import type { SqlMetadataStageEnvelope } from "../../rayfin/functions/src/workspace-sql-metadata";
import type { PowerBiStageEnvelope } from "../../rayfin/functions/src/workspace-powerbi";

const SQL_TYPES = new Set([
  "SQLDatabase",
  "Warehouse",
  "Lakehouse",
  "SQLEndpoint",
]);
const POWERBI_TYPES = new Set(["Report", "SemanticModel"]);
const BATCH_SIZE = 8;

interface RemainingCollectorsClient {
  functions: {
    workspaceCollectSqlMetadata: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          items: { id: string; type: string }[];
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<SqlMetadataStageEnvelope>;
    };
    workspaceCollectPowerBi: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          items: { id: string; type: "Report" | "SemanticModel" }[];
          includeAdminEvidence: boolean;
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<PowerBiStageEnvelope>;
    };
  };
}

interface ShadowDependencies {
  enabled?: boolean;
  client?: RemainingCollectorsClient;
  warn?: (message: string, detail: unknown) => void;
}

function enabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    name.trim().toLowerCase(),
  );
}

export function sqlCollectorShadowEnabled(): boolean {
  return enabled(import.meta.env.VITE_ATLAS_SQL_COLLECTOR_SHADOW ?? "");
}

export function powerBiCollectorShadowEnabled(): boolean {
  return enabled(import.meta.env.VITE_ATLAS_POWERBI_COLLECTOR_SHADOW ?? "");
}

function safeFailureDetail(error: unknown): { type: string } {
  return {
    type:
      error instanceof Error && error.name
        ? error.name.slice(0, 80)
        : "unknown",
  };
}

function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += BATCH_SIZE) {
    result.push(values.slice(offset, offset + BATCH_SIZE));
  }
  return result;
}

function validateReturnedIds(
  returned: { id: string }[],
  requested: { id: string }[],
): void {
  const expected = new Set(requested.map((item) => item.id.toLowerCase()));
  const actual = new Set(returned.map((item) => item.id.toLowerCase()));
  if (
    actual.size !== expected.size ||
    [...expected].some((id) => !actual.has(id))
  ) {
    throw new Error("Incomplete shadow response.");
  }
}

export async function runSqlCollectorShadow(
  workspaceId: string,
  correlationId: string,
  coreEnvelope: CoreCollectorEnvelope | undefined,
  dependencies: ShadowDependencies = {},
): Promise<string | undefined> {
  if (
    !(dependencies.enabled ?? sqlCollectorShadowEnabled()) ||
    !coreEnvelope
  ) {
    return undefined;
  }
  const items = coreEnvelope.items
    .filter((item) => SQL_TYPES.has(item.type))
    .map((item) => ({ id: item.id, type: item.type }));
  if (items.length === 0) return "SQL shadow no-targets";
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as RemainingCollectorsClient);
  const envelopes: SqlMetadataStageEnvelope[] = [];
  try {
    for (const batch of batches(items)) {
      const envelope =
        await client.functions.workspaceCollectSqlMetadata.invoke(
          {
            protocolVersion: 1,
            workspaceId,
            items: batch,
            correlationId,
          },
          { timeoutMs: 180_000 },
        );
      if (
        envelope.contractVersion !== 1 ||
        envelope.stage !== "sql-metadata" ||
        envelope.authoritative !== false ||
        envelope.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
      ) {
        throw new Error("Invalid SQL shadow response.");
      }
      validateReturnedIds(envelope.items, batch);
      envelopes.push(envelope);
    }
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] SQL shadow collection failed",
      safeFailureDetail(error),
    );
    return "SQL shadow unavailable";
  }
  const evidence = envelopes.flatMap((envelope) => envelope.items);
  const schemas = envelopes.flatMap((envelope) =>
    Object.values(envelope.schema).flat(),
  );
  return [
    `SQL shadow complete=${evidence.filter((item) => item.status === "complete").length}`,
    `unsupported=${evidence.filter((item) => item.status === "unsupported").length}`,
    `failed=${evidence.filter((item) => item.status === "failed").length}`,
    `catalogs=${envelopes.reduce(
      (sum, envelope) => sum + Object.keys(envelope.catalogs).length,
      0,
    )}`,
    `objects=${schemas.length}`,
    `columns=${schemas.reduce(
      (sum, table) => sum + table.columns.length,
      0,
    )}`,
  ].join("; ");
}

export async function runPowerBiCollectorShadow(
  workspaceId: string,
  correlationId: string,
  coreEnvelope: CoreCollectorEnvelope | undefined,
  dependencies: ShadowDependencies = {},
): Promise<string | undefined> {
  if (
    !(dependencies.enabled ?? powerBiCollectorShadowEnabled()) ||
    !coreEnvelope
  ) {
    return undefined;
  }
  const items = coreEnvelope.items
    .filter(
      (item): item is typeof item & {
        type: "Report" | "SemanticModel";
      } => POWERBI_TYPES.has(item.type),
    )
    .map((item) => ({ id: item.id, type: item.type }));
  if (items.length === 0) return "Power BI shadow no-targets";
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as RemainingCollectorsClient);
  const envelopes: PowerBiStageEnvelope[] = [];
  try {
    for (const batch of batches(items)) {
      const envelope =
        await client.functions.workspaceCollectPowerBi.invoke(
          {
            protocolVersion: 1,
            workspaceId,
            items: batch,
            includeAdminEvidence: true,
            correlationId,
          },
          { timeoutMs: 180_000 },
        );
      if (
        envelope.contractVersion !== 1 ||
        envelope.stage !== "powerbi-metadata" ||
        envelope.authoritative !== false ||
        envelope.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
      ) {
        throw new Error("Invalid Power BI shadow response.");
      }
      validateReturnedIds(envelope.items, batch);
      envelopes.push(envelope);
    }
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] Power BI shadow collection failed",
      safeFailureDetail(error),
    );
    return "Power BI shadow unavailable";
  }
  const evidence = envelopes.flatMap((envelope) => envelope.items);
  const schema = envelopes.flatMap((envelope) =>
    Object.values(envelope.schema),
  );
  const blockers = [
    ...new Set(
      envelopes.flatMap((envelope) =>
        envelope.blockers.map((blocker) => blocker.code),
      ),
    ),
  ]
    .slice(0, 6)
    .join(",");
  return [
    `Power BI shadow items=${evidence.length}`,
    `models=${envelopes.reduce(
      (sum, envelope) => sum + Object.keys(envelope.models).length,
      0,
    )}`,
    `reports=${envelopes.reduce(
      (sum, envelope) => sum + Object.keys(envelope.reports).length,
      0,
    )}`,
    `tables=${schema.length}`,
    `access=${envelopes.reduce(
      (sum, envelope) => sum + envelope.accessEvidence.length,
      0,
    )}`,
    blockers ? `blockers=${blockers}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 420);
}
