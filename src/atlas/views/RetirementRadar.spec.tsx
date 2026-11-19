import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AtlasData, Item } from "../model";
import { RetirementRadarSection } from "./RetirementRadar";
import { RETIREMENT_FOLLOW_UP_NOTE } from "../retirement-radar";

const item = (fabricId: string, overrides: Partial<Item> = {}): Item => ({
  fabricId, displayName: fabricId, itemType: "Lakehouse", health: "healthy", endorsement: "none", tags: [],
  ownerName: "Ada", ownerMetadataAvailable: true, description: "Documented", updatedAt: "2026-05-28T00:00:00Z", ...overrides,
});

const data: AtlasData = {
  workspace: {
    fabricId: "workspace", snapshotId: "snap", displayName: "Sales", capacity: "F2", region: "West Europe",
    syncedAt: "2026-06-01T00:00:00Z", syncSections: { lineage: { status: "complete" }, jobs: { status: "complete" } },
  },
  items: [
    item("lake_legacy", { updatedAt: "2025-12-01T00:00:00Z" }),
    item("lake_live"),
  ],
  edges: [{ source: "lake_live", target: "report", relation: "feeds" }],
  principals: [], grants: [], jobs: [], config: [], comments: [], syncRuns: [],
};

function renderRadar(overrides: Partial<Parameters<typeof RetirementRadarSection>[0]> = {}) {
  const props = {
    data, acknowledgements: [], pendingIds: new Set<string>(), acknowledgementsLoading: false,
    onSaveReview: vi.fn().mockResolvedValue(undefined), onClearReview: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(), ...overrides,
  };
  render(<RetirementRadarSection {...props} />);
  return props;
}

describe("RetirementRadarSection", () => {
  it("lists only evidence-backed candidates and explains why they appear", () => {
    renderRadar();
    const table = screen.getByRole("table", { name: /Retirement candidates/ });
    expect(within(table).getByRole("button", { name: /lake_legacy/ })).toBeVisible();
    expect(within(table).queryByRole("button", { name: /lake_live/ })).toBeNull();
    const detail = screen.getByRole("region", { name: "lake_legacy" });
    expect(within(detail).getByText("Dormant")).toBeVisible();
    expect(within(detail).getByText("No downstream consumer")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("never says an item is unused or safe to delete");
    expect(screen.getByRole("img", { name: /Dormant: 1/ })).toBeInTheDocument();
  });

  it("stores follow-up as personal review state", () => {
    const props = renderRadar();
    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up" }));
    expect(props.onSaveReview).toHaveBeenCalledWith({
      findingId: "retirement:lake_legacy", status: "acked", note: RETIREMENT_FOLLOW_UP_NOTE, occurrenceSnapshotId: "snap",
    });
  });

  it("hides muted candidates unless the review filter includes them", () => {
    renderRadar({
      acknowledgements: [{ id: "ack", findingId: "retirement:lake_legacy", status: "muted", updatedAt: "2026-06-01T00:00:00Z" }],
    });
    expect(screen.getByText("No candidate matches the current filters.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Review state"), { target: { value: "muted" } });
    expect(screen.getByRole("button", { name: /lake_legacy/ })).toBeVisible();
  });

  it("applies a review state to several checked candidates at once", async () => {
    const props = renderRadar({
      data: { ...data, items: [...data.items, item("lake_old", { updatedAt: "2025-12-01T00:00:00Z" })] },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all listed candidates" }));
    const toolbar = screen.getByRole("toolbar", { name: "Review the checked candidates" });
    expect(toolbar).toHaveTextContent("2 selected");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Mark follow-up" }));
    await waitFor(() => expect(props.onSaveReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(props.onSaveReview).mock.calls.map(([input]) => input.findingId).sort())
      .toEqual(["retirement:lake_legacy", "retirement:lake_old"]);
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "Review the checked candidates" })).toBeNull());
  });

  it("selects a candidate from anywhere in its row, after another one was marked", () => {
    const props = renderRadar({
      data: { ...data, items: [...data.items, item("lake_old", { updatedAt: "2025-12-01T00:00:00Z" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up" }));
    const row = screen.getByRole("button", { name: /lake_old/ }).closest("tr")!;
    fireEvent.click(within(row).getAllByRole("cell")[2]);
    expect(screen.getByRole("region", { name: "lake_old" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up" }));
    expect(vi.mocked(props.onSaveReview).mock.calls.map(([input]) => input.findingId))
      .toEqual(["retirement:lake_legacy", "retirement:lake_old"]);
  });
});
