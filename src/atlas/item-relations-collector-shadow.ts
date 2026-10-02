import { getRayfinClient } from "@/lib/rayfin-client";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  parseItemRelationsEvidence,
  type ItemRelationsEvidence,
} from "./item-relations-evidence";
import type { ItemRelationsEvidenceEnvelope } from "../../rayfin/functions/src/workspace-item-relations";

const BATCH_SIZE = 16;
const CONCURRENCY = 2;

interface ItemRelationsShadowClient {
  functions: {
    workspaceCollectItemRelations: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          itemIds: string[];
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<ItemRelationsEvidenceEnvelope>;
    };
  };
}

interface ItemRelationsShadowDependencies {
  enabled?: boolean;
  client?: ItemRelationsShadowClient;
  warn?: (message: string, detail: unknown) => void;
}

export function itemRelationsCollectorShadowEnabled(): boolean {
  const value = import.meta.env.VITE_ATLAS_ITEM_RELATIONS_COLLECTOR_SHADOW;
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

function batches(values: string[]): string[][] {
  const result: string[][] = [];
  for (let offset = 0; offset < values.length; offset += BATCH_SIZE) {
    result.push(values.slice(offset, offset + BATCH_SIZE));
  }
  return result;
}

async function collectBatches(
  client: ItemRelationsShadowClient,
  workspaceId: string,
  correlationId: string,
  itemBatches: string[][],
): Promise<ItemRelationsEvidence[]> {
  const collected: ItemRelationsEvidence[] = [];
  let index = 0;
  const worker = async () => {
    while (index < itemBatches.length) {
      const batchIndex = index;
      index += 1;
      const itemIds = itemBatches[batchIndex];
      const envelope =
        await client.functions.workspaceCollectItemRelations.invoke(
          {
            protocolVersion: 1,
            workspaceId,
            itemIds,
            correlationId,
          },
          { timeoutMs: 180_000 },
        );
      const evidence = parseItemRelationsEvidence(
        envelope,
        workspaceId,
      );
      if (evidence.queries.length !== itemIds.length * 2) {
        throw new Error("Incomplete Item Relations evidence.");
      }
      collected[batchIndex] = evidence;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, itemBatches.length) },
      () => worker(),
    ),
  );
  return collected;
}

export async function runItemRelationsCollectorShadow(
  workspaceId: string,
  correlationId: string,
  coreEnvelope: CoreCollectorEnvelope | undefined,
  dependencies: ItemRelationsShadowDependencies = {},
): Promise<string | undefined> {
  const enabled =
    dependencies.enabled ?? itemRelationsCollectorShadowEnabled();
  if (!enabled || !coreEnvelope) return undefined;
  const itemIds = coreEnvelope.items.map((item) => item.id);
  if (itemIds.length === 0) return "Item Relations shadow no-targets";
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as ItemRelationsShadowClient);
  let evidence: ItemRelationsEvidence[];
  try {
    evidence = await collectBatches(
      client,
      workspaceId,
      correlationId,
      batches(itemIds),
    );
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] Item Relations shadow collection failed",
      safeFailureDetail(error),
    );
    return "Item Relations shadow unavailable";
  }

  const queries = evidence.flatMap((entry) => entry.queries);
  const complete = queries.filter(
    (query) => query.status === "complete",
  ).length;
  const failed = queries.length - complete;
  const relationCount = queries.reduce(
    (sum, query) => sum + (query.response?.relations.length ?? 0),
    0,
  );
  const externalWorkspaces = new Set(
    queries.flatMap((query) =>
      (query.response?.workspaces ?? [])
        .map((workspace) => workspace.id)
        .filter(
          (id) => id.toLowerCase() !== workspaceId.toLowerCase(),
        ),
    ),
  ).size;
  const codes = [
    ...new Set(
      queries.flatMap((query) =>
        query.failureCode ? [query.failureCode] : [],
      ),
    ),
  ]
    .slice(0, 6)
    .join(",");
  return [
    `Item Relations shadow complete=${complete}`,
    `failed=${failed}`,
    `relations=${relationCount}`,
    `externalWorkspaces=${externalWorkspaces}`,
    codes ? `codes=${codes}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 300);
}
