import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_CONFIG } from "./config";
import { buildAtlasHistory, snapshotFromData } from "./history";
import { SAMPLE_DATA } from "./model";
import { AtlasProvider, useAtlas } from "./store";

const backend = vi.hoisted(() => ({
  loadFromDb: vi.fn(),
  loadHistoryFromDb: vi.fn(),
  persistComment: vi.fn(),
  runFabricSync: vi.fn(),
}));
const savedViewBackend = vi.hoisted(() => ({
  loadSavedViews: vi.fn(),
  createSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));
const currentUser = {
  id: "user-1",
  name: "admin@example.com",
  email: "admin@example.com",
};

vi.mock("./backend", () => backend);
vi.mock("./saved-views", () => savedViewBackend);

function Harness() {
  const atlas = useAtlas();
  return (
    <div>
      <button type="button" onClick={() => void atlas.sync()}>
        Sync
      </button>
      <span data-testid="hydrating">{String(atlas.hydrating)}</span>
      <span data-testid="history-loading">{String(atlas.historyLoading)}</span>
      <span data-testid="history-count">{atlas.history.snapshots.length}</span>
      <span data-testid="history-current">
        {atlas.history.current?.snapshotId ?? ""}
      </span>
      <span data-testid="history-error">{atlas.historyError ?? ""}</span>
      <span data-testid="has-data">{String(atlas.hasData)}</span>
      <span data-testid="syncing">{String(atlas.syncing)}</span>
      <span data-testid="item-count">{atlas.data.items.length}</span>
      <span data-testid="workspace-name">{atlas.data.workspace.displayName}</span>
      <span data-testid="requires-sync">
        {String(atlas.requiresDeploymentSync)}
      </span>
      <span data-testid="progress">{atlas.syncProgress}</span>
      <span data-testid="stage">{atlas.syncStage}</span>
    </div>
  );
}

describe("AtlasProvider synchronization", () => {
  beforeEach(() => {
    localStorage.clear();
    ATLAS_CONFIG.syncAdminEmail = currentUser.email;
    backend.loadFromDb.mockReset();
    backend.loadHistoryFromDb.mockReset();
    backend.persistComment.mockReset();
    backend.runFabricSync.mockReset();
    backend.loadFromDb.mockResolvedValue(null);
    savedViewBackend.loadSavedViews.mockReset().mockResolvedValue([]);
    savedViewBackend.createSavedView.mockReset();
    savedViewBackend.deleteSavedView.mockReset();
    backend.loadHistoryFromDb.mockImplementation(
      async (_isPreview: boolean, current: typeof SAMPLE_DATA) =>
        buildAtlasHistory([
          snapshotFromData(
            current,
            current.workspace.snapshotId ?? "preview-current",
          ),
        ]),
    );
  });

  it("reports staged progress and exposes data after the first sync", async () => {
    backend.runFabricSync.mockImplementation(
      async (
        _isPreview: boolean,
        _user: unknown,
        report: (progress: number, stage: string) => void,
      ) => {
        report(48, "Workspace metadata received");
        report(94, "Writing object metadata");
        return structuredClone(SAMPLE_DATA);
      },
    );

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("hydrating")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("has-data")).toHaveTextContent("false");
    expect(screen.getByTestId("requires-sync")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() =>
      expect(screen.getByTestId("has-data")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("syncing")).toHaveTextContent("false");
    expect(screen.getByTestId("requires-sync")).toHaveTextContent("false");
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("stage")).toHaveTextContent("Workspace is ready");
  });

  it("does not let late hydration overwrite a completed sync", async () => {
    let resolveHydration: (value: typeof SAMPLE_DATA) => void = () => undefined;
    backend.loadFromDb.mockReturnValue(
      new Promise((resolve) => {
        resolveHydration = resolve;
      }),
    );
    backend.runFabricSync.mockResolvedValue(structuredClone(SAMPLE_DATA));

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() =>
      expect(screen.getByTestId("stage")).toHaveTextContent("Workspace is ready"),
    );

    const stale = structuredClone(SAMPLE_DATA);
    stale.workspace.displayName = "Stale hydration";
    stale.items = [];
    resolveHydration(stale);

    await waitFor(() =>
      expect(screen.getByTestId("hydrating")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("workspace-name")).toHaveTextContent(
      SAMPLE_DATA.workspace.displayName,
    );
    expect(screen.getByTestId("item-count")).toHaveTextContent(
      String(SAMPLE_DATA.items.length),
    );
  });

  it("keeps hydrated data when a sync fails", async () => {
    backend.loadFromDb.mockResolvedValue(structuredClone(SAMPLE_DATA));
    backend.runFabricSync.mockRejectedValue(new Error("incomplete scan"));

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("item-count")).toHaveTextContent(
        String(SAMPLE_DATA.items.length),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() =>
      expect(screen.getByTestId("stage")).toHaveTextContent("Sync failed"),
    );
    expect(screen.getByTestId("item-count")).toHaveTextContent(
      String(SAMPLE_DATA.items.length),
    );
  });

  it("exposes current data before a slower history request completes", async () => {
    const current = structuredClone(SAMPLE_DATA);
    current.workspace.snapshotId = "current-snapshot";
    current.workspace.syncedAt = "2026-08-29T20:00:00.000Z";
    let resolveHistory: (
      value: ReturnType<typeof buildAtlasHistory>,
    ) => void = () => undefined;
    backend.loadFromDb.mockResolvedValue(current);
    backend.loadHistoryFromDb.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("hydrating")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("item-count")).toHaveTextContent(
      String(current.items.length),
    );
    expect(screen.getByTestId("history-loading")).toHaveTextContent("true");

    resolveHistory(
      buildAtlasHistory([
        snapshotFromData(
          current,
          current.workspace.snapshotId,
          current.workspace.syncedAt,
        ),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId("history-current")).toHaveTextContent(
        "current-snapshot",
      ),
    );
    expect(screen.getByTestId("history-loading")).toHaveTextContent("false");
  });

  it("refreshes history after sync and keeps a history failure separate from sync", async () => {
    const fresh = structuredClone(SAMPLE_DATA);
    fresh.workspace.snapshotId = "fresh-snapshot";
    fresh.workspace.syncedAt = "2026-08-29T21:00:00.000Z";
    backend.runFabricSync.mockResolvedValue(fresh);
    backend.loadHistoryFromDb.mockRejectedValueOnce(
      new Error("history unavailable"),
    );

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("hydrating")).toHaveTextContent("false"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() =>
      expect(screen.getByTestId("stage")).toHaveTextContent("Workspace is ready"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("history-error")).toHaveTextContent(
        "history unavailable",
      ),
    );
    expect(screen.getByTestId("syncing")).toHaveTextContent("false");
    expect(screen.getByTestId("requires-sync")).toHaveTextContent("false");
  });

  it("does not let late history overwrite history from a newer sync", async () => {
    const hydrated = structuredClone(SAMPLE_DATA);
    hydrated.workspace.snapshotId = "hydrated-snapshot";
    hydrated.workspace.syncedAt = "2026-08-29T20:00:00.000Z";
    const fresh = structuredClone(SAMPLE_DATA);
    fresh.workspace.snapshotId = "fresh-snapshot";
    fresh.workspace.syncedAt = "2026-08-29T21:00:00.000Z";
    let resolveOldHistory: (
      value: ReturnType<typeof buildAtlasHistory>,
    ) => void = () => undefined;
    backend.loadFromDb.mockResolvedValue(hydrated);
    backend.loadHistoryFromDb
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldHistory = resolve;
        }),
      )
      .mockResolvedValueOnce(
        buildAtlasHistory([
          snapshotFromData(
            fresh,
            fresh.workspace.snapshotId,
            fresh.workspace.syncedAt,
          ),
        ]),
      );
    backend.runFabricSync.mockResolvedValue(fresh);

    render(
      <AtlasProvider isPreview={false} currentUser={currentUser}>
        <Harness />
      </AtlasProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("history-loading")).toHaveTextContent("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() =>
      expect(screen.getByTestId("history-current")).toHaveTextContent(
        "fresh-snapshot",
      ),
    );

    resolveOldHistory(
      buildAtlasHistory([
        snapshotFromData(
          hydrated,
          hydrated.workspace.snapshotId,
          hydrated.workspace.syncedAt,
        ),
      ]),
    );
    await Promise.resolve();
    expect(screen.getByTestId("history-current")).toHaveTextContent(
      "fresh-snapshot",
    );
  });
});
