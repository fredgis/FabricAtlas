import type { AppFunctionsSchema } from "../../rayfin/functions/src/types";
import { configuredSyncWriters } from "./config";
import {
  connectionStoreApi,
  persistConnectionInventory,
  type ConnectionStoreApi,
} from "./connection-inventory-store";
import { parseConnectionEnvelope, type ConnectionInventoryView } from "./connections";
import { acquireGovernanceToken, assertSyncActive, type SyncIdentity } from "./live-sync";

type CollectConnections = (
  input: AppFunctionsSchema["tenantCollectConnections"]["input"],
  options?: { timeoutMs?: number },
) => Promise<AppFunctionsSchema["tenantCollectConnections"]["output"]>;

export interface TenantConnectionSyncDependencies {
  collect?: CollectConnections;
  store?: ConnectionStoreApi | null;
  token?: () => Promise<string | undefined>;
  timeoutMs?: number;
}

export type TenantConnectionSyncResult =
  | { status: "stored"; inventory: ConnectionInventoryView }
  | {
      status: "skipped";
      reason: "not-deployed" | "not-synchronizer" | "invalid-response" | "unsupported" | "failed";
      code?: string;
    };

function synchronizerEmail(identity: SyncIdentity): string | undefined {
  const subject = identity.id?.trim();
  return subject ? configuredSyncWriters().find((writer) => writer.subject === subject)?.email : undefined;
}

async function rayfinDependencies(): Promise<{ collect?: CollectConnections; store?: ConnectionStoreApi }> {
  const { getRayfinClient } = await import("@/lib/rayfin-client");
  const client = getRayfinClient() as unknown as {
    functions?: Record<string, { invoke?: CollectConnections } | undefined>;
    data?: unknown;
  };
  const target = client.functions?.tenantCollectConnections;
  return {
    ...(target?.invoke ? { collect: target.invoke.bind(target) as CollectConnections } : {}),
    ...(connectionStoreApi(client.data) ? { store: connectionStoreApi(client.data) } : {}),
  };
}

/**
 * Tenant stage of a synchronization batch: collects the connection inventory
 * once and stores it. It never fails the batch; workspaces still synchronize
 * when the Function or the entities are missing or the call fails.
 */
export async function syncTenantConnections(
  identity: SyncIdentity,
  correlationId: string,
  progress?: (stage: string) => void,
  signal?: AbortSignal,
  dependencies: TenantConnectionSyncDependencies = {},
): Promise<TenantConnectionSyncResult> {
  const writerEmail = synchronizerEmail(identity);
  if (!writerEmail) return { status: "skipped", reason: "not-synchronizer" };
  const defaults = dependencies.collect && dependencies.store !== undefined ? {} : await rayfinDependencies();
  const collect = dependencies.collect ?? defaults.collect;
  const store = dependencies.store !== undefined ? dependencies.store : defaults.store;
  if (!collect || !store) return { status: "skipped", reason: "not-deployed" };

  progress?.("Collecting tenant connections");
  const token = await (dependencies.token ?? (() => acquireGovernanceToken(identity, signal)))();
  assertSyncActive(signal);
  let output: unknown;
  try {
    output = await collect(
      { protocolVersion: 1, correlationId, delegatedToken: token ?? null },
      { timeoutMs: dependencies.timeoutMs ?? 180_000 },
    );
  } catch (error) {
    assertSyncActive(signal);
    console.warn("[atlas] tenant connection inventory unavailable", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return { status: "skipped", reason: "failed" };
  }
  assertSyncActive(signal);
  const inventory = parseConnectionEnvelope(output);
  if (!inventory) return { status: "skipped", reason: "invalid-response" };
  // A refused or failed collection is not stored, so it never hides the last complete inventory.
  if (inventory.status !== "complete") {
    return { status: "skipped", reason: inventory.status, ...(inventory.code ? { code: inventory.code } : {}) };
  }
  try {
    const result = await persistConnectionInventory(store, inventory, writerEmail, {
      signal,
      progress: (written, total) => progress?.(`Storing tenant connections (${written}/${total})`),
    });
    if (result.retentionWarning) console.warn("[atlas] connection inventory retention incomplete");
    return { status: "stored", inventory: result.inventory };
  } catch (error) {
    assertSyncActive(signal);
    console.warn("[atlas] connection inventory storage failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return { status: "skipped", reason: "failed" };
  }
}
