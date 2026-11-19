import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AtlasData } from "../model";

const state = vi.hoisted(() => ({ data: undefined as unknown as AtlasData }));
vi.mock("../store", () => ({
  useAtlas: () => ({
    data: state.data,
    history: { trend: [] },
    workspaceSyncStatuses: {},
    governanceTargets: {},
    connectionInventory: { inventory: undefined },
  }),
}));

import { InsightsView } from "./Insights";

const empty: AtlasData = {
  workspace: { fabricId: "ws", displayName: "Sales", capacity: "F2", region: "West Europe" },
  items: [], edges: [], principals: [], grants: [], jobs: [], config: [], comments: [], syncRuns: [],
};

describe("InsightsView", () => {
  it("never renders an empty card: ghost charts carry a short explanation", () => {
    state.data = empty;
    render(<InsightsView onNavigate={vi.fn()} />);
    const items = screen.getByRole("region", { name: "Items by type" });
    expect(within(items).getByText(/No data yet/)).toBeVisible();
    expect(within(items).getByRole("img", { name: "No items yet", hidden: true })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Snapshot trend" })).getByText(/No data yet/)).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Connections by connector" })).getByText(/not collected yet/)).toBeVisible();
    expect(screen.getAllByRole("img", { name: /Unknown/ }).length).toBeGreaterThan(0);
  });

  it("draws collected data and opens the matching view", () => {
    state.data = {
      ...empty,
      workspace: { ...empty.workspace, syncSections: { lineage: { status: "complete" } } },
      items: [
        { fabricId: "a", displayName: "a", itemType: "Report", health: "healthy", endorsement: "none", tags: [], ownerName: "Ada" },
        { fabricId: "b", displayName: "b", itemType: "Lakehouse", health: "healthy", endorsement: "none", tags: [] },
      ],
      edges: [{ source: "b", target: "a", relation: "feeds" }],
    };
    const onNavigate = vi.fn();
    render(<InsightsView onNavigate={onNavigate} />);
    const items = screen.getByRole("region", { name: "Items by type" });
    expect(within(items).getByRole("img", { name: "Lakehouse: 1, Report: 1" })).toBeInTheDocument();
    expect(within(items).queryByText(/No data yet/)).toBeNull();
    expect(screen.getByRole("img", { name: /Edges resolved: 100%/ })).toBeInTheDocument();
    fireEvent.click(within(items).getByRole("button", { name: /Catalog/ }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ tab: "catalog" }));
    fireEvent.click(screen.getByRole("button", { name: /Open findings/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "governance", focus: expect.objectContaining({ governanceSection: "findings" }) }));
  });
});
