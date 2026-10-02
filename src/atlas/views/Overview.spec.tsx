import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider, useAtlas } from "../store";
import { OverviewView } from "./Overview";
import { SAMPLE_DATA } from "../model";
import type { PillarScore, PosturePillar } from "../posture";

vi.mock("../components/PostureRadar", () => ({
  PostureRadar: ({ pillars, onSelect }: { pillars: PillarScore[]; onSelect: (pillar: PosturePillar) => void }) => (
    <figure aria-label="Governance posture radar">
      <output aria-label="Radar scores">{pillars.map((pillar) => `${pillar.pillar}:${pillar.score}`).join(",")}</output>
      <button onClick={() => onSelect("lineage")}>Review radar lineage</button>
    </figure>
  ),
}));

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
  it("shows real posture, compact inventory and direct navigation without competing hero cards", async () => {
    const onOpen = vi.fn();
    render(<AtlasProvider isPreview><OverviewView onOpen={onOpen} /></AtlasProvider>);
    const inventory = screen.getByLabelText("Workspace inventory");
    expect(within(inventory).getAllByRole("definition")[0]).toHaveTextContent(String(SAMPLE_DATA.items.length));
    expect(screen.getByRole("heading", { name: SAMPLE_DATA.workspace.displayName })).toBeVisible();
    expect(screen.getByRole("heading", { name: SAMPLE_DATA.workspace.displayName }).closest("[data-slot='page-header']")).not.toBeNull();
    expect(await screen.findByRole("figure", { name: "Governance posture radar" })).toBeVisible();
    expect(screen.getByLabelText("Radar scores")).toHaveTextContent(/documentation:\d/);
    fireEvent.click(screen.getByRole("button", { name: "Review radar lineage" }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "governance", focus: expect.objectContaining({ governanceSection: "posture", filters: { pillar: "lineage" } }),
    }));
    const destinations = screen.getByRole("navigation", { name: "Overview destinations" });
    fireEvent.click(within(destinations).getByRole("button", { name: "Map & lineage" }));
    expect(onOpen).toHaveBeenLastCalledWith("map");
    fireEvent.click(within(destinations).getByRole("button", { name: "Catalog" }));
    expect(onOpen).toHaveBeenLastCalledWith("catalog");
    fireEvent.click(within(destinations).getByRole("button", { name: "Access" }));
    expect(onOpen).toHaveBeenLastCalledWith("access");
    const meters = screen.getAllByRole("meter");
    expect(meters.length).toBeGreaterThan(6);
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
    expect(await screen.findByText(/^Target 95%/)).toBeVisible();
  });

  it("opens governance and access signals with actionable filters", () => {
    const onOpen = vi.fn();
    render(
      <AtlasProvider isPreview>
        <OverviewView onOpen={onOpen} />
      </AtlasProvider>,
    );
    expect(
      screen.getByText("Standard baseline: 70% for each governance pillar."),
    ).toBeVisible();

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
