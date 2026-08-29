import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_CONFIG } from "./config";
import { SAMPLE_DATA } from "./model";
import { AtlasProvider, useAtlas } from "./store";

const backend = vi.hoisted(() => ({
  loadFromDb: vi.fn(),
  persistComment: vi.fn(),
  runFabricSync: vi.fn(),
}));
const currentUser = {
  id: "user-1",
  name: "admin@example.com",
  email: "admin@example.com",
};

vi.mock("./backend", () => backend);

function Harness() {
  const atlas = useAtlas();
  return (
    <div>
      <button type="button" onClick={() => void atlas.sync()}>
        Sync
      </button>
      <span data-testid="hydrating">{String(atlas.hydrating)}</span>
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
    backend.persistComment.mockReset();
    backend.runFabricSync.mockReset();
    backend.loadFromDb.mockResolvedValue(null);
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
});
