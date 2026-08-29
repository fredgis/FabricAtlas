import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DATA } from "./model";
import { AtlasProvider, useAtlas } from "./store";

const backend = vi.hoisted(() => ({
  loadFromDb: vi.fn(),
  persistComment: vi.fn(),
  runFabricSync: vi.fn(),
}));

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
      <span data-testid="progress">{atlas.syncProgress}</span>
      <span data-testid="stage">{atlas.syncStage}</span>
    </div>
  );
}

describe("AtlasProvider synchronization", () => {
  beforeEach(() => {
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
      <AtlasProvider isPreview={false}>
        <Harness />
      </AtlasProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("hydrating")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("has-data")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() =>
      expect(screen.getByTestId("has-data")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("syncing")).toHaveTextContent("false");
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("stage")).toHaveTextContent("Workspace is ready");
  });
});
