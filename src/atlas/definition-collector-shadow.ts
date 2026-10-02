import { getRayfinClient } from "@/lib/rayfin-client";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import type { DefinitionStageEnvelope } from "../../rayfin/functions/src/workspace-definitions";

const SUPPORTED_TYPES = new Set(["Ontology", "GraphModel", "DataAgent"]);
const BATCH_SIZE = 8;

interface DefinitionShadowClient {
  functions: {
    workspaceCollectDefinitions: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          items: { id: string; type: string }[];
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<DefinitionStageEnvelope>;
    };
  };
}

interface DefinitionShadowDependencies {
  enabled?: boolean;
  client?: DefinitionShadowClient;
  warn?: (message: string, detail: unknown) => void;
}

export function definitionCollectorShadowEnabled(): boolean {
  const value = import.meta.env.VITE_ATLAS_DEFINITION_COLLECTOR_SHADOW;
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
  envelope: DefinitionStageEnvelope,
  workspaceId: string,
  requestedIds: Set<string>,
): void {
  if (
    envelope.contractVersion !== 1 ||
    envelope.stage !== "definitions" ||
    envelope.authoritative !== false ||
    envelope.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw new Error("Invalid definition shadow contract.");
  }
  const returned = new Set<string>();
  for (const item of envelope.items) {
    const id = item.id.toLowerCase();
    if (
      returned.has(id) ||
      !requestedIds.has(id) ||
      !["complete", "unsupported", "failed"].includes(item.status)
    ) {
      throw new Error("Invalid definition shadow item.");
    }
    returned.add(id);
  }
  if (
    returned.size !== requestedIds.size ||
    [...requestedIds].some((id) => !returned.has(id))
  ) {
    throw new Error("Incomplete definition shadow response.");
  }
  for (const id of Object.keys(envelope.artifactMetadata)) {
    if (!requestedIds.has(id.toLowerCase())) {
      throw new Error("Foreign definition metadata.");
    }
  }
  if (
    envelope.config.some(
      (entry) => !requestedIds.has(entry.itemId.toLowerCase()),
    )
  ) {
    throw new Error("Foreign definition configuration.");
  }
}

export async function runDefinitionCollectorShadow(
  workspaceId: string,
  correlationId: string,
  coreEnvelope: CoreCollectorEnvelope | undefined,
  dependencies: DefinitionShadowDependencies = {},
): Promise<string | undefined> {
  const enabled =
    dependencies.enabled ?? definitionCollectorShadowEnabled();
  if (!enabled || !coreEnvelope) return undefined;
  const items = coreEnvelope.items
    .filter((item) => SUPPORTED_TYPES.has(item.type))
    .map((item) => ({ id: item.id, type: item.type }));
  if (items.length === 0) return "Definitions shadow no-targets";

  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as DefinitionShadowClient);
  const envelopes: DefinitionStageEnvelope[] = [];
  try {
    for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
      const batch = items.slice(offset, offset + BATCH_SIZE);
      const envelope =
        await client.functions.workspaceCollectDefinitions.invoke(
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
      "[atlas] definition shadow collection failed",
      safeFailureDetail(error),
    );
    return "Definitions shadow unavailable";
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
  const codes = [
    ...new Set(
      evidence.flatMap((item) => (item.code ? [item.code] : [])),
    ),
  ]
    .slice(0, 6)
    .join(",");
  return [
    `Definitions shadow complete=${complete}`,
    `unsupported=${unsupported}`,
    `failed=${failed}`,
    `metadata=${envelopes.reduce(
      (sum, envelope) =>
        sum + Object.keys(envelope.artifactMetadata).length,
      0,
    )}`,
    codes ? `codes=${codes}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 300);
}
