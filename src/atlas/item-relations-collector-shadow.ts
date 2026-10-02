import { getRayfinClient } from "@/lib/rayfin-client";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  createItemRelationsEvidence,
  parseItemRelationsEvidence,
  type ItemRelationsEvidence,
} from "./item-relations-evidence";
import type {
  ItemRelationsEvidenceEnvelope,
  ItemRelationsStopReason,
} from "../../rayfin/functions/src/workspace-item-relations";

const BATCH_SIZE = 16;
const CONCURRENCY = 2;
const MAX_SHADOW_ITEMS = 16;
const STOP_REASONS = new Set<ItemRelationsStopReason>([
  "deadline-exhausted",
  "request-budget-exhausted",
  "cancelled",
  "throttled",
  "evidence-budget-exhausted",
]);

/** Evidence from one shadow run in which every batch returned a valid envelope. */
export interface ItemRelationsShadowCollection {
  evidence: ItemRelationsEvidence;
  sampledItemCount: number;
  workspaceItemCount: number;
  stopReasons: ItemRelationsStopReason[];
}

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
  /** Receives the combined evidence only after a successful real collection. */
  onCollected?: (collection: ItemRelationsShadowCollection) => void;
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
): Promise<{
  evidence: ItemRelationsEvidence[];
  stopReasons: ItemRelationsStopReason[];
}> {
  const collected: ItemRelationsEvidence[] = [];
  const stopReasons = new Set<ItemRelationsStopReason>();
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
      if (envelope.stopReason && STOP_REASONS.has(envelope.stopReason)) {
        stopReasons.add(envelope.stopReason);
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
  return { evidence: collected, stopReasons: [...stopReasons].sort() };
}

function combinedEvidence(
  workspaceId: string,
  evidence: ItemRelationsEvidence[],
): ItemRelationsEvidence {
  const collectedAt = evidence
    .map((entry) => entry.collectedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return createItemRelationsEvidence(
    workspaceId,
    collectedAt,
    evidence.flatMap((entry) => entry.queries),
  );
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
  const allItemIds = coreEnvelope.items.map((item) => item.id);
  const itemIds = allItemIds.slice(0, MAX_SHADOW_ITEMS);
  if (itemIds.length === 0) return "Item Relations shadow no-targets";
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as ItemRelationsShadowClient);
  let evidence: ItemRelationsEvidence[];
  let stopReasons: ItemRelationsStopReason[];
  let collection: ItemRelationsShadowCollection;
  try {
    ({ evidence, stopReasons } = await collectBatches(
      client,
      workspaceId,
      correlationId,
      batches(itemIds),
    ));
    collection = {
      evidence: combinedEvidence(workspaceId, evidence),
      sampledItemCount: itemIds.length,
      workspaceItemCount: allItemIds.length,
      stopReasons,
    };
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] Item Relations shadow collection failed",
      safeFailureDetail(error),
    );
    return "Item Relations shadow unavailable";
  }
  dependencies.onCollected?.(collection);

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
    `sampled=${itemIds.length}/${allItemIds.length}`,
    codes ? `codes=${codes}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 300);
}
