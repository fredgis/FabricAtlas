import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_CONFIG } from "./config";
import type { ConnectionEntityApi, ConnectionStoreApi } from "./connection-inventory-store";
import { syncTenantConnections } from "./connection-sync";

const SUBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONNECTION = "11111111-1111-4111-8111-111111111111";
const identity = { id: SUBJECT, name: "sync@contoso.com", email: "sync@contoso.com" };

function memoryEntity(): ConnectionEntityApi & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const query = (filter: Record<string, { eq: unknown }> = {}) => ({
    where: (next: Record<string, { eq: unknown }>) => query({ ...filter, ...next }),
    first: () => query(filter),
    after: () => query(filter),
    executePaginated: async () => ({
      items: rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value.eq)),
      hasNextPage: false,
    }),
  });
  return {
    rows,
    select: () => query(),
    create: async (row) => {
      rows.push(row);
    },
    delete: async () => undefined,
  };
}

function envelope(status: "complete" | "unsupported", code?: string) {
  return {
    protocolVersion: 1,
    authoritative: false,
    collectedAt: "2026-11-09T08:00:00.000Z",
    status: { status, ...(code ? { code } : {}) },
    truncated: false,
    roleLookups: { done: 0, skipped: 0, failed: 0 },
    connections: status === "complete"
      ? [{ id: CONNECTION, displayName: "adls", connectivityType: "ShareableCloud", rolesStatus: "complete", roles: [] }]
      : [],
  };
}

describe("tenant connection stage", () => {
  let store: ConnectionStoreApi & { inventory: ReturnType<typeof memoryEntity> };

  beforeEach(() => {
    ATLAS_CONFIG.syncAdminSubject = SUBJECT;
    ATLAS_CONFIG.syncAdminEmail = "sync@contoso.com";
    ATLAS_CONFIG.breakGlassSyncAdminSubject = "";
    ATLAS_CONFIG.breakGlassSyncAdminEmail = "";
    store = { inventory: memoryEntity(), connections: memoryEntity(), roles: memoryEntity() };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("stores a complete inventory under the synchronizer email", async () => {
    const collect = vi.fn().mockResolvedValue(envelope("complete"));
    const result = await syncTenantConnections(identity, crypto.randomUUID(), undefined, undefined, {
      collect, store, token: async () => "delegated",
    });

    expect(result.status).toBe("stored");
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ protocolVersion: 1, delegatedToken: "delegated" }),
      expect.any(Object),
    );
    expect(store.inventory.rows).toEqual([expect.objectContaining({ writerEmail: "sync@contoso.com", connectionCount: 1 })]);
  });

  it("keeps the stored inventory when the admin API refuses the synchronizer", async () => {
    const result = await syncTenantConnections(identity, crypto.randomUUID(), undefined, undefined, {
      collect: vi.fn().mockResolvedValue(envelope("unsupported", "authorization-failed")),
      store,
      token: async () => undefined,
    });

    expect(result).toEqual({ status: "skipped", reason: "unsupported", code: "authorization-failed" });
    expect(store.inventory.rows).toEqual([]);
  });

  it("never throws for a failed call or a caller who is not the synchronizer", async () => {
    const failed = await syncTenantConnections(identity, crypto.randomUUID(), undefined, undefined, {
      collect: vi.fn().mockRejectedValue(new Error("404")),
      store,
      token: async () => undefined,
    });
    expect(failed).toEqual({ status: "skipped", reason: "failed" });

    const collect = vi.fn();
    const other = await syncTenantConnections({ ...identity, id: "someone-else" }, crypto.randomUUID(), undefined, undefined, {
      collect, store,
    });
    expect(other).toEqual({ status: "skipped", reason: "not-synchronizer" });
    expect(collect).not.toHaveBeenCalled();
  });
});
