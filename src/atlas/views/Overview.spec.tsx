import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider, useAtlas } from "../store";
import { OverviewView } from "./Overview";
import { SAMPLE_DATA } from "../model";

function GovernanceTargetButton() {
  const { governanceTargets, saveGovernanceTargets } = useAtlas();
  return (
    <button
      onClick={() => void saveGovernanceTargets({ ...governanceTargets, documentation: 95 })}
    >
      Set documentation target
    </button>
  );
}

describe("OverviewView navigation", () => {
  it("shows a graphical workspace pulse without duplicate navigation controls", () => {
    const onOpen = vi.fn();
    render(<AtlasProvider isPreview><OverviewView onOpen={onOpen} /></AtlasProvider>);
    const inventory = screen.getByLabelText("Workspace inventory");
    expect(within(inventory).getAllByRole("definition")[0]).toHaveTextContent(String(SAMPLE_DATA.items.length));
    expect(screen.getByRole("heading", { name: SAMPLE_DATA.workspace.displayName })).toBeVisible();
    expect(screen.getByRole("heading", { name: SAMPLE_DATA.workspace.displayName }).closest("[data-slot='page-header']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Workspace pulse" })).toBeVisible();
    expect(screen.getAllByRole("img", { name: /posture score:/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /lineage: \d+%/i }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "governance", focus: expect.objectContaining({ governanceSection: "posture", filters: { pillar: "lineage" } }),
    }));
    expect(screen.queryByRole("navigation", { name: "Overview destinations" })).not.toBeInTheDocument();
    const meters = screen.getAllByRole("meter");
    expect(meters.length).toBeGreaterThanOrEqual(3);
    for (const meter of meters) {
      expect(meter).toHaveAttribute("aria-valuemax", "100");
      expect(meter).toHaveAttribute("data-score-band", expect.stringMatching(/^(low|mid|high)$/));
      expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
      expect(Number(meter.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(100);
    }
  });
  it("reflects shared target changes without reverting to the default", async () => {
    render(
      <AtlasProvider isPreview>
        <GovernanceTargetButton />
        <OverviewView onOpen={vi.fn()} />
      </AtlasProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set documentation target" }));
    expect(
      await screen.findByRole("button", {
        name: /documentation: \d+%\. Target 95%/i,
      }),
    ).toBeVisible();
  });

  it("opens governance and access signals with actionable filters", () => {
    const onOpen = vi.fn();
    render(
      <AtlasProvider isPreview>
        <OverviewView onOpen={onOpen} />
      </AtlasProvider>,
    );
    expect(screen.getByText(/governance signals meet the current target/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /External access:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tab: "access",
        focus: expect.objectContaining({
          filters: { risk: "external" },
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Needs attention:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tab: "governance",
        focus: expect.objectContaining({
          governanceSection: "findings",
          filters: { section: "findings", category: "operations" },
        }),
      }),
    );
  });
});
