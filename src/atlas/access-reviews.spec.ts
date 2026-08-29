import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAccessReview,
  loadAccessReviews,
  saveAccessReview,
} from "./access-reviews";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/rayfin-client", () => ({
  getRayfinClient: () => ({
    data: {
      AccessReview: {
        select: mocks.select,
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
      },
    },
  }),
}));

describe("access review decisions", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    const query = {
      where: mocks.where,
      orderBy: mocks.orderBy,
      execute: mocks.execute,
    };
    mocks.select.mockReturnValue(query);
    mocks.where.mockReturnValue(query);
    mocks.orderBy.mockReturnValue(query);
    mocks.execute.mockResolvedValue([]);
  });

  it("loads decisions for the current user and workspace", async () => {
    mocks.execute.mockResolvedValue([
      {
        id: "review-1",
        workspace_id: "workspace-1",
        user_id: "user-1",
        rowKey: "row-1",
        itemFabricId: "item-1",
        principalRef: "Analyst",
        status: "accepted",
        reviewedAt: "2026-08-29T20:00:00.000Z",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);

    await expect(
      loadAccessReviews(false, "workspace-1", "user-1"),
    ).resolves.toEqual([
      expect.objectContaining({
        rowKey: "row-1",
        status: "accepted",
      }),
    ]);
    expect(mocks.where).toHaveBeenCalledWith({
      workspace_id: { eq: "workspace-1" },
      user_id: { eq: "user-1" },
    });
  });

  it("creates and updates a review decision", async () => {
    mocks.create.mockImplementation(async (value) => ({
      id: "review-2",
      ...value,
    }));
    mocks.update.mockResolvedValue(undefined);

    const created = await saveAccessReview(
      false,
      "workspace-1",
      "user-1",
      {
        rowKey: "row-2",
        itemFabricId: "item-2",
        principalRef: "Guest",
        status: "needsAction",
      },
    );
    const updated = await saveAccessReview(
      false,
      "workspace-1",
      "user-1",
      {
        current: created,
        rowKey: created.rowKey,
        itemFabricId: created.itemFabricId,
        principalRef: created.principalRef,
        status: "reviewed",
        note: "Validated with the owner",
      },
    );

    expect(created.id).toBe("review-2");
    expect(updated).toMatchObject({
      status: "reviewed",
      note: "Validated with the owner",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "review-2" },
      expect.objectContaining({ status: "reviewed" }),
    );
  });

  it("keeps preview reviews local to the caller", async () => {
    const decision = await saveAccessReview(
      true,
      "workspace-1",
      "preview-user",
      {
        rowKey: "row-preview",
        itemFabricId: "item-1",
        principalRef: "Preview",
        status: "reviewed",
      },
    );
    await deleteAccessReview(true, decision.id);

    expect(decision.id).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("reuses a persisted decision found by its unique record key", async () => {
    mocks.execute.mockResolvedValueOnce([
      {
        id: "existing-review",
        workspace_id: "workspace-1",
        user_id: "user-1",
        recordKey: "record-key",
        rowKey: "row-existing",
        itemFabricId: "item-1",
        principalRef: "Analyst",
        status: "reviewed",
        reviewedAt: "2026-08-29T20:00:00.000Z",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);
    mocks.update.mockResolvedValue(undefined);

    const decision = await saveAccessReview(
      false,
      "workspace-1",
      "user-1",
      {
        rowKey: "row-existing",
        itemFabricId: "item-1",
        principalRef: "Analyst",
        status: "accepted",
      },
    );

    expect(decision.id).toBe("existing-review");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "existing-review" },
      expect.objectContaining({ status: "accepted" }),
    );
  });
});
