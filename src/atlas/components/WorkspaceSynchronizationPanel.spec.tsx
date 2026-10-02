import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DATA, type AtlasData, type SyncRun } from "../model";
import type { AtlasContextValue } from "../store";
import type { WorkspaceScope } from "../workspace-scope";

const harness = vi.hoisted(() => ({
  context: undefined as unknown,
  functionsEnabled: true,
}));

vi.mock("../store", () => ({ useAtlas: () => harness.context }));
vi.mock("../feature-flags", () => ({
  isFeatureEnabled: (id: string) =>
    id === "fabric-app-functions" && harness.functionsEnabled,
}));

import {
  LIVE_RUN_ROW_ID,
  WorkspaceSynchronizationPanel,
} from "./WorkspaceSynchronizationPanel";

const ACTIVE = SAMPLE_DATA.workspace.fabricId;
const OTHER = "9a2a1b5e-58e3-4c43-9a8f-1f7c6f3f2a10";

function runs(count: number): SyncRun[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `run-${index}`,
    startedAt: new Date(Date.UTC(2026, 8, 20 - index, 6)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 8, 20 - index, 6, 3)).toISOString(),
    status: "completed" as const,
    triggeredBy: "Synchronizer",
  }));
}

function context(
  overrides: Partial<AtlasContextValue> = {},
  syncRuns: SyncRun[] = runs(2),
): AtlasContextValue {
  const data: AtlasData = { ...SAMPLE_DATA, syncRuns };
  const scopes: WorkspaceScope[] = [
    {
      id: ACTIVE,
      displayName: SAMPLE_DATA.workspace.displayName,
      persisted: true,
    },
    { id: OTHER, displayName: "Second workspace", persisted: true },
  ];
  return {
    data,
    hydrating: false,
    syncing: false,
    syncProgress: 0,
    syncStage: "Ready to sync",
    syncStartedAt: undefined,
    syncError: undefined,
    lastSyncedAt: "2026-09-20T06:03:00.000Z",
    isPreview: true,
    configured: true,
    canSync: true,
    currentUser: { id: "admin", name: "Synchronizer" },
    workspaceScopes: scopes,
    workspaceScopesLoading: false,
    workspaceScopesError: undefined,
    activeWorkspaceId: ACTIVE,
    reloadWorkspaceScopes: vi.fn(async () => undefined),
    selectWorkspace: vi.fn(),
    sync: vi.fn(async () => undefined),
    syncWorkspaces: vi.fn(async () => undefined),
    syncQueue: [],
    syncWorkspaceId: undefined,
    cancelSync: vi.fn(),
    ...overrides,
  } as unknown as AtlasContextValue;
}

function renderPanel(value: AtlasContextValue) {
  harness.context = value;
  return render(<WorkspaceSynchronizationPanel />);
}

describe("WorkspaceSynchronizationPanel", () => {
  beforeEach(() => {
    harness.functionsEnabled = true;
  });

  it("reports the browser-authoritative run with working run controls", () => {
    const value = context({
      syncing: true,
      syncProgress: 34,
      syncStage: "Discovering Lakehouse metadata (2/5)",
      syncStartedAt: Date.now() - 90_000,
    });
    renderPanel(value);

    expect(
      screen.getByRole("heading", {
        name: "Synchronization is running in this browser tab",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Keep this tab open/)).toBeInTheDocument();
    expect(screen.queryByText(/return later|in the background/i)).toBeNull();
    expect(
      screen.getByRole("progressbar", {
        name: "Workspace synchronization progress",
      }),
    ).toHaveAttribute("aria-valuenow", "34");
    expect(
      within(
        screen.getByRole("list", { name: "Synchronization phases" }),
      ).getByText("Collect").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Second workspace" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "View run" }));
    expect(document.activeElement?.id).toBe(LIVE_RUN_ROW_ID);
    expect(document.getElementById(LIVE_RUN_ROW_ID)).toHaveTextContent(
      "Running",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(value.cancelSync).toHaveBeenCalledTimes(1);
  });

  it("shows scheduling disabled with its verified reason and no schedule controls", () => {
    renderPanel(context());

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Manual only")).toBeInTheDocument();
    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    expect(
      screen.getByText(/no documented timer or unattended trigger/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit schedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("switches the active workspace from the shared scope", () => {
    const value = context();
    renderPanel(value);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("Last valid snapshot")).toBeInTheDocument();
    expect(screen.getByText("Not loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Second workspace" }));
    expect(value.selectWorkspace).toHaveBeenCalledWith(OTHER);
  });

  it("restricts scope management to the synchronizer behind the Functions flag", async () => {
    renderPanel(context());
    fireEvent.click(screen.getByRole("button", { name: "Manage scope" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Manage workspace scope",
    });
    expect(
      within(dialog).getByRole("note", { name: "Preview API information" }),
    ).toHaveTextContent("Fabric Apps backend Functions");
    expect(
      within(dialog).getByRole("note", { name: "Preview API information" })
        .className,
    ).toContain("text-[length:var(--text-200)]");
    expect(
      await within(dialog).findByRole("checkbox", {
        name: new RegExp(SAMPLE_DATA.workspace.displayName),
      }),
    ).toBeChecked();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides scope management when Functions are disabled or the user is not the synchronizer", () => {
    harness.functionsEnabled = false;
    const { unmount } = renderPanel(context());
    expect(screen.queryByRole("button", { name: "Manage scope" })).toBeNull();
    unmount();

    harness.functionsEnabled = true;
    renderPanel(context({ canSync: false }));
    expect(screen.queryByRole("button", { name: "Manage scope" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Synchronize now" }),
    ).toBeNull();
    expect(screen.getByText(/Scope is managed by/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/to run this synchronization\./).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the last validated snapshot visible after a failed run", () => {
    const value = context({ syncError: "Fabric returned HTTP 403." });
    renderPanel(value);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fabric returned HTTP 403.",
    );
    expect(
      screen.getByText(/last validated snapshot, published .* is still shown/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry synchronization" }),
    );
    expect(value.sync).toHaveBeenCalledTimes(1);
  });

  it("states honestly when the scope or run history is unavailable", () => {
    renderPanel(
      context(
        {
          workspaceScopesError: "Workspace scope could not be loaded.",
          lastSyncedAt: undefined,
        },
        [],
      ),
    );

    expect(
      screen.getByRole("button", { name: "Reload scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Workspace scope could not be loaded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No synchronization run is recorded/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No snapshot has been published yet",
      }),
    ).toBeInTheDocument();
  });

  it("shows the latest five runs and expands to the full history", () => {
    renderPanel(context({}, runs(7)));
    const table = screen.getByRole("table", {
      name: "Synchronization runs, newest first",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(6);

    const toggle = screen.getByRole("button", { name: "View all 7 runs" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "Show latest 5" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps a long failure message to a bounded summary with the full error on demand", () => {
    const longError = `Synchronization failed before snapshot publication. ${"Upstream response ".repeat(40)}end-of-error`;
    renderPanel(
      context({}, [
        {
          id: "failed-run",
          startedAt: "2026-10-02T12:21:00.000Z",
          finishedAt: "2026-10-02T12:24:18.000Z",
          status: "failed",
          triggeredBy: "Synchronizer",
          failureMessage: longError,
        },
      ]),
    );

    const table = screen.getByRole("table", {
      name: "Synchronization runs, newest first",
    });
    expect(table.className).toContain("table-fixed");
    const [row] = within(table).getAllByRole("row").slice(1);
    const summary = within(row).getByText(/^Synchronization failed before snapshot publication\./);
    expect(summary.textContent!.length).toBeLessThanOrEqual(161);
    expect(within(row).queryByText(/end-of-error/)).toBeNull();

    const toggle = within(row).getByRole("button", { name: "Show full error" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(detail).toHaveTextContent(longError.trim());
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("offers Sync all and per-workspace Sync through the queue contract", () => {
    const value = context();
    renderPanel(value);

    fireEvent.click(screen.getByRole("button", { name: "Sync all" }));
    expect(value.syncWorkspaces).toHaveBeenCalledWith([ACTIVE, OTHER]);
    fireEvent.click(
      screen.getByRole("button", { name: "Synchronize Second workspace" }),
    );
    expect(value.syncWorkspaces).toHaveBeenLastCalledWith([OTHER]);
    expect(
      screen.getByRole("button", {
        name: `Synchronize ${SAMPLE_DATA.workspace.displayName}`,
      }),
    ).toBeEnabled();
  });

  it("shows running, queued and failed workspaces and blocks conflicting actions", () => {
    const third = "5c0e3f74-0f2f-4b5c-a7f2-2f4c8f7d9e11";
    const value = context({
      syncing: true,
      syncProgress: 40,
      syncStage: "Discovering Notebook metadata (3/9)",
      syncWorkspaceId: OTHER,
      workspaceScopes: [
        { id: ACTIVE, displayName: SAMPLE_DATA.workspace.displayName, persisted: true },
        { id: OTHER, displayName: "Second workspace", persisted: true },
        { id: third, displayName: "Third workspace", persisted: true },
      ],
      syncQueue: [
        { workspaceId: ACTIVE, status: "failed", error: "Fabric returned HTTP 403." },
        { workspaceId: OTHER, status: "running" },
        { workspaceId: third, status: "queued" },
      ],
    });
    renderPanel(value);

    const table = screen.getByRole("table", {
      name: "Workspaces in the shared synchronization scope",
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[1]).getByText("Collecting")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Queued")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync all" })).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /^Synchronize / })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByText("2 of 3 · Second workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View run" })).toBeNull();
  });
});
