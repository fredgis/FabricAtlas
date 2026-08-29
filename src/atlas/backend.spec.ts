import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DATA } from "./model";
import { loadFromDb, runFabricSync } from "./backend";
import { ATLAS_CONFIG } from "./config";

const mocks = vi.hoisted(() => {
  const names = [
    "Workspace",
    "FabricItem",
    "LineageEdge",
    "Principal",
    "AccessGrant",
    "JobRun",
    "ConfigEntry",
    "Comment",
    "SyncRun",
  ];
  const data = Object.fromEntries(
    names.map((name) => {
      const api = {
        findMany: vi.fn(),
        create: vi.fn(),
        select: vi.fn(),
      };
      return [name, api];
    }),
  );
  return {
    data,
    invokeSyncAll: vi.fn(),
    mapSyncToAtlas: vi.fn(),
  };
});

vi.mock("@/lib/rayfin-client", () => ({
  getRayfinClient: () => ({ data: mocks.data }),
}));

vi.mock("./live-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live-sync")>();
  return {
    ...actual,
    invokeSyncAll: mocks.invokeSyncAll,
    mapSyncToAtlas: mocks.mapSyncToAtlas,
  };
});

const workspaceId = "11111111-1111-4111-8111-111111111111";
const identity = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "user@example.com",
  email: "user@example.com",
};

describe("Rayfin snapshot persistence", () => {
  beforeEach(() => {
    ATLAS_CONFIG.syncAdminEmail = identity.email;
    (
      window as unknown as { __atlasWorkspaceId?: string }
    ).__atlasWorkspaceId = workspaceId;
    for (const api of Object.values(mocks.data)) {
      api.findMany.mockReset().mockResolvedValue([]);
      api.create.mockReset().mockImplementation(async (row) => row);
      api.select.mockReset().mockImplementation(() => {
        let filter: Record<string, unknown> = {};
        const query = {
          where(nextFilter: Record<string, unknown>) {
            filter = nextFilter;
            return query;
          },
          first() {
            return query;
          },
          after() {
            return query;
          },
          async executePaginated() {
            return {
              items: await api.findMany(filter),
              hasNextPage: false,
            };
          },
        };
        return query;
      });
    }
    mocks.invokeSyncAll.mockReset().mockResolvedValue({});
    mocks.mapSyncToAtlas
      .mockReset()
      .mockReturnValue(structuredClone(SAMPLE_DATA));
  });

  it("does not publish a Workspace marker when an individual write fails", async () => {
    mocks.data.FabricItem.create.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(runFabricSync(false, identity)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.data.Workspace.create).not.toHaveBeenCalled();
    expect(mocks.data.SyncRun.create).not.toHaveBeenCalled();
  });

  it("rejects snapshot publication from a different authenticated user", async () => {
    await expect(
      runFabricSync(false, {
        id: "33333333-3333-4333-8333-333333333333",
        name: "viewer@example.com",
        email: "viewer@example.com",
      }),
    ).rejects.toThrow(/configured Atlas sync administrator/i);
    expect(mocks.invokeSyncAll).not.toHaveBeenCalled();
  });

  it("publishes the manifest only after all snapshot rows succeed", async () => {
    await expect(runFabricSync(false, identity)).resolves.toMatchObject({
      items: SAMPLE_DATA.items,
    });

    expect(mocks.data.Workspace.create).toHaveBeenCalledTimes(1);
    const markerOrder =
      mocks.data.Workspace.create.mock.invocationCallOrder[0];
    const contentOrders = [
      "FabricItem",
      "LineageEdge",
      "Principal",
      "AccessGrant",
      "JobRun",
      "ConfigEntry",
      "SyncRun",
    ].flatMap(
      (name) =>
        mocks.data[name].create.mock.invocationCallOrder as number[],
    );
    expect(Math.max(...contentOrders)).toBeLessThan(markerOrder);
  });

  it("falls back to the previous complete manifest during hydration", async () => {
    const oldSnapshot = "33333333-3333-4333-8333-333333333333";
    const incompleteSnapshot = "44444444-4444-4444-8444-444444444444";
    mocks.data.Workspace.findMany.mockResolvedValue([
      {
        snapshotId: incompleteSnapshot,
        writerEmail: identity.email,
        fabricId: workspaceId,
        displayName: "Incomplete",
        itemCount: 2,
        edgeCount: 0,
        principalCount: 0,
        grantCount: 0,
        jobCount: 0,
        configCount: 0,
        schemaEntryCount: 0,
        syncedAt: "2026-08-29T20:00:00.000Z",
      },
      {
        snapshotId: oldSnapshot,
        writerEmail: identity.email,
        fabricId: workspaceId,
        displayName: "Last known good",
        itemCount: 1,
        edgeCount: 0,
        principalCount: 0,
        grantCount: 0,
        jobCount: 0,
        configCount: 0,
        schemaEntryCount: 0,
        syncedAt: "2026-08-29T19:00:00.000Z",
      },
    ]);
    mocks.data.FabricItem.findMany.mockResolvedValue([
      {
        workspace_id: workspaceId,
        snapshotId: incompleteSnapshot,
        writerEmail: identity.email,
        fabricId: "new-item",
        displayName: "Partial",
        itemType: "Lakehouse",
        health: "unknown",
        endorsement: "none",
      },
      {
        workspace_id: workspaceId,
        snapshotId: oldSnapshot,
        writerEmail: identity.email,
        fabricId: "old-item",
        displayName: "Preserved",
        itemType: "Lakehouse",
        health: "healthy",
        endorsement: "none",
      },
    ]);

    await expect(loadFromDb(false)).resolves.toMatchObject({
      workspace: { displayName: "Last known good" },
      items: [{ fabricId: "old-item", displayName: "Preserved" }],
    });
    expect(mocks.data.FabricItem.select).toHaveBeenCalledWith(
      expect.arrayContaining(["workspace_id", "snapshotId", "displayName"]),
    );
  });

  it("sanitizes persisted placeholder display names", async () => {
    const snapshotId = "55555555-5555-4555-8555-555555555555";
    mocks.data.Workspace.findMany.mockResolvedValue([
      {
        snapshotId,
        writerEmail: identity.email,
        fabricId: workspaceId,
        displayName: "Workspace",
        itemCount: 1,
        edgeCount: 0,
        principalCount: 0,
        grantCount: 0,
        jobCount: 0,
        configCount: 0,
        schemaEntryCount: 0,
        syncedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);
    mocks.data.FabricItem.findMany.mockResolvedValue([
      {
        workspace_id: workspaceId,
        snapshotId,
        writerEmail: identity.email,
        fabricId: "real-item-id",
        displayName: "null",
        itemType: "Lakehouse",
        health: "unknown",
        endorsement: "none",
      },
    ]);

    await expect(loadFromDb(false)).resolves.toMatchObject({
      items: [
        {
          fabricId: "real-item-id",
          displayName: "real-item-id",
          itemType: "Lakehouse",
        },
      ],
    });
  });

  it("does not hydrate a snapshot containing a generic ITEM row", async () => {
    const snapshotId = "66666666-6666-4666-8666-666666666666";
    mocks.data.Workspace.findMany.mockResolvedValue([
      {
        snapshotId,
        writerEmail: identity.email,
        fabricId: workspaceId,
        displayName: "Workspace",
        itemCount: 1,
        edgeCount: 0,
        principalCount: 0,
        grantCount: 0,
        jobCount: 0,
        configCount: 0,
        schemaEntryCount: 0,
        syncedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);
    mocks.data.FabricItem.findMany.mockResolvedValue([
      {
        workspace_id: workspaceId,
        snapshotId,
        writerEmail: identity.email,
        fabricId: "real-item-id",
        displayName: "Malformed",
        itemType: "ITEM",
        health: "unknown",
        endorsement: "none",
      },
    ]);

    await expect(loadFromDb(false)).resolves.toBeNull();
  });

  it("ignores sync audit rows from untrusted writers", async () => {
    const snapshotId = "77777777-7777-4777-8777-777777777777";
    mocks.data.Workspace.findMany.mockResolvedValue([
      {
        snapshotId,
        writerEmail: identity.email,
        fabricId: workspaceId,
        displayName: "Workspace",
        itemCount: 1,
        edgeCount: 0,
        principalCount: 0,
        grantCount: 0,
        jobCount: 0,
        configCount: 0,
        schemaEntryCount: 0,
        syncedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);
    mocks.data.FabricItem.findMany.mockResolvedValue([
      {
        workspace_id: workspaceId,
        snapshotId,
        writerEmail: identity.email,
        fabricId: "item-1",
        displayName: "Item",
        itemType: "Lakehouse",
        health: "healthy",
        endorsement: "none",
      },
    ]);
    mocks.data.SyncRun.findMany.mockResolvedValue([
      {
        id: "trusted",
        workspace_id: workspaceId,
        snapshotId,
        writerEmail: identity.email,
        startedAt: "2026-08-29T20:00:00.000Z",
        status: "completed",
        triggeredBy: identity.email,
      },
      {
        id: "forged",
        workspace_id: workspaceId,
        snapshotId,
        writerEmail: "viewer@example.com",
        startedAt: "2099-01-01T00:00:00.000Z",
        status: "completed",
        triggeredBy: "Administrator",
      },
    ]);

    await expect(loadFromDb(false)).resolves.toMatchObject({
      syncRuns: [{ id: "trusted", triggeredBy: identity.email }],
    });
  });
});
