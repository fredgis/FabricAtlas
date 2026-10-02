import { getRayfinClient } from "@/lib/rayfin-client";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import type { KqlMetadataStageEnvelope } from "../../rayfin/functions/src/workspace-kql-metadata";

const SUPPORTED_TYPES = new Set([
  "Eventhouse",
  "KQLDatabase",
  "KQLQueryset",
  "KQLDashboard",
]);
const BATCH_SIZE = 16;

interface KqlShadowClient {
  functions: {
    workspaceCollectKqlMetadata: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          items: { id: string; type: string }[];
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<KqlMetadataStageEnvelope>;
    };
  };
}

interface KqlShadowDependencies {
  enabled?: boolean;
  client?: KqlShadowClient;
  warn?: (message: string, detail: unknown) => void;
}

export function kqlCollectorShadowEnabled(): boolean {
  const value = import.meta.env.VITE_ATLAS_KQL_COLLECTOR_SHADOW;
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function safeFailureDetail(error: unknown): { type: string } {
  return {
    type:
      error instanceof Error && error.name
        ? error.name.slice(0, 80)
        : "unknown",
  };
}

function validateEnvelope(
  envelope: KqlMetadataStageEnvelope,
  workspaceId: string,
  requested: Set<string>,
): void {
  if (
    envelope.contractVersion !== 1 ||
    envelope.stage !== "kql-metadata" ||
    envelope.authoritative !== false ||
    envelope.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw new Error("Invalid KQL shadow contract.");
  }
  const returned = new Set<string>();
  for (const item of envelope.items) {
    const id = item.id.toLowerCase();
    if (
      returned.has(id) ||
      !requested.has(id) ||
      !["complete", "unsupported", "failed"].includes(item.status)
    ) {
      throw new Error("Invalid KQL shadow item.");
    }
    returned.add(id);
  }
  if (
    returned.size !== requested.size ||
    [...requested].some((id) => !returned.has(id))
  ) {
    throw new Error("Incomplete KQL shadow response.");
  }
  for (const id of [
    ...Object.keys(envelope.schemas),
    ...Object.keys(envelope.artifactMetadata),
  ]) {
    if (!requested.has(id.toLowerCase())) {
      throw new Error("Foreign KQL shadow metadata.");
    }
  }
}

export async function runKqlCollectorShadow(
  workspaceId: string,
  correlationId: string,
  coreEnvelope: CoreCollectorEnvelope | undefined,
  dependencies: KqlShadowDependencies = {},
): Promise<string | undefined> {
  const enabled = dependencies.enabled ?? kqlCollectorShadowEnabled();
  if (!enabled || !coreEnvelope) return undefined;
  const items = coreEnvelope.items
    .filter((item) => SUPPORTED_TYPES.has(item.type))
    .map((item) => ({ id: item.id, type: item.type }));
  if (items.length === 0) return "KQL shadow no-targets";
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as KqlShadowClient);
  const envelopes: KqlMetadataStageEnvelope[] = [];
  try {
    for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
      const batch = items.slice(offset, offset + BATCH_SIZE);
      const envelope =
        await client.functions.workspaceCollectKqlMetadata.invoke(
          {
            protocolVersion: 1,
            workspaceId,
            items: batch,
            correlationId,
          },
          { timeoutMs: 180_000 },
        );
      validateEnvelope(
        envelope,
        workspaceId,
        new Set(batch.map((item) => item.id.toLowerCase())),
      );
      envelopes.push(envelope);
    }
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] KQL shadow collection failed",
      safeFailureDetail(error),
    );
    return "KQL shadow unavailable";
  }

  const evidence = envelopes.flatMap((envelope) => envelope.items);
  const complete = evidence.filter(
    (item) => item.status === "complete",
  ).length;
  const unsupported = evidence.filter(
    (item) => item.status === "unsupported",
  ).length;
  const failed = evidence.filter(
    (item) => item.status === "failed",
  ).length;
  const schemas = envelopes.flatMap((envelope) =>
    Object.values(envelope.schemas),
  );
  const blockers = [
    ...new Set(
      envelopes.flatMap((envelope) =>
        envelope.blockers.map((blocker) => blocker.code),
      ),
    ),
  ]
    .slice(0, 4)
    .join(",");
  return [
    `KQL shadow complete=${complete}`,
    `unsupported=${unsupported}`,
    `failed=${failed}`,
    `schemas=${schemas.length}`,
    `tables=${schemas.reduce(
      (sum, schema) => sum + (schema.tables?.length ?? 0),
      0,
    )}`,
    `functions=${schemas.reduce(
      (sum, schema) => sum + (schema.functions?.length ?? 0),
      0,
    )}`,
    `views=${schemas.reduce(
      (sum, schema) => sum + (schema.materializedViews?.length ?? 0),
      0,
    )}`,
    blockers ? `blockers=${blockers}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 320);
}
