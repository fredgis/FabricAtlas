import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWorkspaceScope,
  discoverWorkspaces,
  loadWorkspaceScopes,
  removeWorkspaceScope,
} from "./workspace-scope";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  select: vi.fn(),
  orderBy: vi.fn(),
  first: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("./config", () => ({
  ATLAS_CONFIG: {
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceName: "Host workspace",
    syncAdminSubject: "11111111-1111-4111-8111-111111111111",
    syncAdminEmail: "admin@example.com",
  },
}));

vi.mock("@/lib/rayfin-client", () => ({
  getRayfinClient: () => ({
    data: {
      WorkspaceScope: {
        select: mocks.select,
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
        findById: mocks.findById,
      },
    },
    functions: {
      workspaceDiscover: {
        invoke: mocks.invoke,
      },
    },
  }),
}));

const admin = {
  id: ADMIN_ID,
  email: "admin@example.com",
};

describe("workspace scope", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    const query = {
      orderBy: mocks.orderBy,
      first: mocks.first,
      execute: mocks.execute,
    };
    mocks.select.mockReturnValue(query);
    mocks.orderBy.mockReturnValue(query);
    mocks.first.mockReturnValue(query);
    mocks.execute.mockResolvedValue([]);
    mocks.findById.mockResolvedValue(null);
    mocks.create.mockImplementation(async (row) => row);
    mocks.update.mockResolvedValue(undefined);
    mocks.delete.mockResolvedValue(undefined);
  });

  it("uses the configured host until an explicit shared scope exists", async () => {
    await expect(loadWorkspaceScopes(false)).resolves.toEqual([
      expect.objectContaining({
        id: HOST_ID,
        displayName: "Host workspace",
        persisted: false,
      }),
    ]);

    mocks.execute.mockResolvedValue([
      {
        id: OTHER_ID,
        displayName: "Selected workspace",
        selectedAt: "2026-10-02T10:00:00.000Z",
      },
    ]);
    await expect(loadWorkspaceScopes(false)).resolves.toEqual([
      expect.objectContaining({
        id: OTHER_ID,
        persisted: true,
      }),
    ]);
  });

  it("validates the typed administrator-only discovery contract", async () => {
    mocks.invoke.mockResolvedValue({
      contractVersion: 1,
      truncated: false,
      workspaces: [
        {
          id: OTHER_ID,
          displayName: "Selected workspace",
          workspaceType: "Workspace",
        },
      ],
    });

    await expect(discoverWorkspaces(false, admin)).resolves.toEqual({
      truncated: false,
      workspaces: [
        {
          id: OTHER_ID,
          displayName: "Selected workspace",
          workspaceType: "Workspace",
          capacityId: undefined,
        },
      ],
    });
    await expect(
      discoverWorkspaces(false, {
        id: "44444444-4444-4444-8444-444444444444",
        email: "user@example.com",
      }),
    ).rejects.toThrow("configured Atlas administrator");
  });

  it("persists the configured fallback before another workspace", async () => {
    await addWorkspaceScope(false, admin, {
      id: OTHER_ID,
      displayName: "Selected workspace",
      workspaceType: "Workspace",
      capacityId: undefined,
    });

    expect(mocks.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: HOST_ID,
        displayName: "Host workspace",
        writerEmail: "admin@example.com",
      }),
    );
    expect(mocks.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: OTHER_ID,
        displayName: "Selected workspace",
        writerEmail: "admin@example.com",
      }),
    );
  });

  it("prevents removing the final selected workspace", async () => {
    mocks.execute.mockResolvedValue([
      {
        id: HOST_ID,
        displayName: "Host workspace",
        selectedAt: "2026-10-02T10:00:00.000Z",
      },
    ]);
    await expect(
      removeWorkspaceScope(false, admin, HOST_ID),
    ).rejects.toThrow("At least one workspace");
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
