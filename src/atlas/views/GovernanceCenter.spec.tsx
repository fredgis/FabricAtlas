import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "../store";
import { GovernanceCenterView, RadarPanel } from "./GovernanceCenter";

function renderView() {
  const onNavigate = vi.fn();
  render(
    <AtlasProvider isPreview>
      <GovernanceCenterView onNavigate={onNavigate} />
    </AtlasProvider>,
  );
  return onNavigate;
}

describe("GovernanceCenterView", () => {
  it("groups findings, changes, history and coverage in one view", () => {
    renderView();

    expect(
      screen.getByRole("heading", { name: "Governance Center" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Findings/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Changes/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /History/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Coverage/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Posture/ })).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "What became risky since the last sync",
      }),
    ).toBeInTheDocument();
  });

  it("supports arrow-key tab navigation", async () => {
    renderView();
    const findings = screen.getByRole("tab", { name: /Findings/ });
    await act(async () => {
      findings.focus();
      fireEvent.keyDown(findings, { key: "ArrowRight" });
    });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Changes/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(
      screen.getByRole("heading", { name: "A second snapshot is required" }),
    ).toBeInTheDocument();
  });

  it("opens evidence from an actionable finding", () => {
    const onNavigate = renderView();
    const actions = screen.getAllByRole("button", { name: "Open evidence" });
    expect(actions.length).toBeGreaterThan(0);

    fireEvent.click(actions[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("shows the two-snapshot requirement in Change Center preview", async () => {
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));

    expect(
      await screen.findByRole("heading", {
        name: "A second snapshot is required",
      }),
    ).toBeInTheDocument();
  });

  it("saves a personal governance view in preview", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Saved views/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save current filters" }),
    );
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Priority findings" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Priority findings")).toBeInTheDocument(),
    );
  });

  it("shows posture targets on a fixed scoring surface", () => {
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: /Posture/ }));

    expect(
      screen.getByRole("heading", { name: /pillars at target/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fixed 0–100 scale/)).toBeInTheDocument();
  });
});

describe("RadarPanel", () => {
  const readyRadar = {
    state: "ready" as const,
    currentSnapshotId: "current",
    previousSnapshotId: "previous",
    deltas: [],
    riskyChanges: [],
    provenanceComplete: true,
  };
  const baseProps = {
    entries: [],
    suppressed: [],
    loading: false,
    historyLoading: false,
    failedSnapshotIds: [],
    pendingIds: new Set<string>(),
    onAcknowledge: vi.fn(async () => undefined),
    onMute: vi.fn(async () => undefined),
    onRestore: vi.fn(async () => undefined),
    onRetryHistory: vi.fn(),
    onOpen: vi.fn(),
    onDownload: vi.fn(),
  };

  it("shows the monitored goal as a watermark when no risk is new", () => {
    render(<RadarPanel {...baseProps} radar={readyRadar} />);

    expect(
      screen.getByText("No new high-priority regression detected"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Radar monitored signals"),
    ).toHaveTextContent("AccessSensitivityLineageConsumed removals");
  });

  it("offers a retry instead of leaving a failed comparison loading", () => {
    const onRetryHistory = vi.fn();
    render(
      <RadarPanel
        {...baseProps}
        radar={{ state: "loading", missingSnapshotIds: ["previous"] }}
        failedSnapshotIds={["previous"]}
        onRetryHistory={onRetryHistory}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry comparison" }),
    );
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("The latest governance comparison is unavailable"),
    ).toBeInTheDocument();
  });
});
