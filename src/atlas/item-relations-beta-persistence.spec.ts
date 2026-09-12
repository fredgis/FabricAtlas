import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemRelationsBetaCollection } from "./item-relations-beta";
import type { ItemRelationsBetaSnapshotRow } from "./item-relations-beta-persistence";

const mocks = vi.hoisted(() => ({
  rows: [] as ItemRelationsBetaSnapshotRow[],
  create: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/rayfin-client", () => ({
  getRayfinClient: () => ({
    data: {
      ItemRelationsBetaSnapshot: {
        select: mocks.select,
        create: mocks.create,
        delete: mocks.delete,
      },
    },
  }),
}));

import {
  collectionFromSnapshotRows,
  itemRelationsSnapshotRows,
  loadItemRelationsBetaSnapshot,
  saveItemRelationsBetaSnapshot,
} from "./item-relations-beta-persistence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const rootId = "22222222-2222-4222-8222-222222222222";
const dependencyId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";

function collection(): ItemRelationsBetaCollection {
  return {
    correlationId: snapshotId,
    workspaceId,
    requestedItemIds: [rootId],
    completedItemIds: [rootId],
    itemFailures: {},
    items: [
      {
        id: dependencyId,
        workspaceId,
        type: "Lakehouse",
        displayName: "Source",
      },
    ],
    relations: [
      {
        itemId: rootId,
        dependentOnItemId: dependencyId,
        relationType: "Datasource",
      },
    ],
    workspaces: [{ id: workspaceId, displayName: "Workspace" }],
    queries: [
      {
        itemId: rootId,
        direction: "upstream",
        status: "complete",
        itemCount: 1,
        relationCount: 1,
        workspaceCount: 1,
        durationMs: 10,
      },
    ],
    errors: Array.from({ length: 12 }, () => "x".repeat(400)),
    requestCount: 2,
    sliceCount: 1,
    durationMs: 20,
    collectedAt: "2026-09-12T10:00:00.000Z",
  };
}

function configureQueryApi() {
  mocks.select.mockImplementation(() => {
    let filter: Record<string, unknown> = {};
    let order: Record<string, "asc" | "desc"> = {};
    let pageSize = 100;
    let offset = 0;
    const query = {
      where(next: Record<string, unknown>) {
        filter = next;
        return query;
      },
      orderBy(next: Record<string, "asc" | "desc">) {
        order = next;
        return query;
      },
      first(next: number) {
        pageSize = next;
        return query;
      },
      after(cursor: string) {
        offset = Number(cursor);
        return query;
      },
      async executePaginated() {
        const matches = mocks.rows
          .filter((row) =>
            Object.entries(filter).every(([field, condition]) => {
              const expected =
                condition &&
                typeof condition === "object" &&
                "eq" in condition
                  ? (condition as { eq: unknown }).eq
                  : condition;
              return (
                row[field as keyof ItemRelationsBetaSnapshotRow] ===
                expected
              );
            }),
          )
          .sort((left, right) => {
            const [field, direction] = Object.entries(order)[0] ?? [];
            if (!field || !direction) return 0;
            const leftValue = left[
              field as keyof ItemRelationsBetaSnapshotRow
            ];
            const rightValue = right[
              field as keyof ItemRelationsBetaSnapshotRow
            ];
            const delta =
              typeof leftValue === "number" &&
              typeof rightValue === "number"
                ? leftValue - rightValue
                : String(leftValue).localeCompare(String(rightValue));
            return direction === "asc" ? delta : -delta;
          });
        const items = matches.slice(offset, offset + pageSize);
        const nextOffset = offset + items.length;
        return {
          items,
          hasNextPage: nextOffset < matches.length,
          endCursor:
            nextOffset < matches.length
              ? String(nextOffset)
              : undefined,
        };
      },
    };
    return query;
  });
}

describe("Item Relations Beta persistence", () => {
  beforeEach(() => {
    mocks.rows.length = 0;
    mocks.create.mockReset();
    mocks.delete.mockReset();
    mocks.select.mockReset();
    configureQueryApi();
    mocks.create.mockImplementation(async (value) => {
      const row = value as ItemRelationsBetaSnapshotRow;
      mocks.rows.push(row);
      return row;
    });
    mocks.delete.mockResolvedValue(undefined);
  });

  it("chunks and reconstructs the complete collection from one table", () => {
    const rows = itemRelationsSnapshotRows(
      collection(),
      "ADMIN@example.com",
    );
    const manifest = rows.at(-1)!;
    const chunks = rows.slice(0, -1);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((row) => row.payload.length <= 3_500)).toBe(true);
    expect(manifest.rowType).toBe("manifest");
    expect(
      collectionFromSnapshotRows(manifest, chunks, workspaceId),
    ).toEqual(collection());
  });

  it("writes the manifest last and reloads the saved scan", async () => {
    const value = collection();

    await expect(
      saveItemRelationsBetaSnapshot(
        false,
        value,
        "admin@example.com",
      ),
    ).resolves.toEqual({});
    expect(mocks.rows.at(-1)?.rowType).toBe("manifest");

    await expect(
      loadItemRelationsBetaSnapshot(false, workspaceId),
    ).resolves.toEqual(value);
  });
});
