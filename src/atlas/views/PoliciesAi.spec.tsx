import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasData } from "../model";
import { snapshotFromData } from "../history";
import { PoliciesAiSection } from "./PoliciesAi";
import { POLICIES_AI_LIMITATION } from "../policies-ai";

const data: AtlasData = {
  workspace: { fabricId: "workspace", snapshotId: "current", displayName: "Workspace", capacity: "F2", region: "West Europe",
    syncedAt: "2026-10-02T12:00:00Z", syncSections: { definitions: { status: "complete" } } },
  items: [{ fabricId: "agent", displayName: "Recorded agent", itemType: "DataAgent", health: "healthy",
    endorsement: "none", tags: [], ownerMetadataAvailable: false }],
  itemMetadata: { agent: { kind: "dataAgent", sources: [] } },
  edges: [], principals: [], grants: [], jobs: [], config: [], comments: [], syncRuns: [],
};
const props = () => ({
  data, historyLoading: false, isPreview: true, onNavigate: vi.fn(), onCompare: vi.fn(),
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PoliciesAiSection", () => {
  it("shows observed empty definitions as unknown exposure with real provenance and no synthetic score", () => {
    render(<PoliciesAiSection {...props()} />);
    expect(screen.getByText(POLICIES_AI_LIMITATION)).toBeVisible();
    expect(screen.getByRole("button", { name: /Inspect Recorded agent/ })).toHaveAccessibleName(/AI exposure unknown/);
    fireEvent.click(screen.getByRole("button", { name: /Inspect Recorded agent/ }));
    const details = screen.getByRole("region", { name: "Evidence details: Recorded agent" });
    expect(within(details).getByText("Unknown; no exposure contract collected")).toBeVisible();
    expect(within(details).getByText("2026-10-02T12:00:00Z")).toBeVisible();
    expect(within(details).getByText("Per-definition observation time")).toBeVisible();
    expect(within(details).getByText(/Neither statement establishes/)).toBeVisible();
    expect(screen.queryByText(/^(AI.safe|AI readiness|Compliant|Not exposed)$/i)).not.toBeInTheDocument();
  });

  it("keeps unsupported Watchlists and Sync Brief controls disabled with exact blockers", () => {
    render(<PoliciesAiSection {...props()} />);
    const watches = screen.getByRole("button", { name: "Watchlists unavailable" });
    expect(watches).toBeDisabled();
    expect(watches).toHaveAccessibleDescription(/no user-scoped Watchlist entity/);
    const brief = screen.getByRole("button", { name: "Sync Brief unavailable" });
    expect(brief).toBeDisabled();
    expect(brief).toHaveAccessibleDescription(/no validated-snapshot brief generator/);
    expect(screen.getByText(/Policy evidence feature is off/)).toBeVisible();
  });

  it("links only loaded published historical comparisons and fails closed on history errors", () => {
    const prior: AtlasData = { ...data, workspace: {
      ...data.workspace, snapshotId: "previous", syncedAt: "2026-10-01T12:00:00Z",
    } };
    const values = props();
    const rendered = render(<PoliciesAiSection {...values} previous={snapshotFromData(prior)} current={snapshotFromData(data)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open exact historical comparison" }));
    expect(values.onCompare).toHaveBeenCalledWith("previous", "current");
    rendered.rerender(<PoliciesAiSection {...values} historyError="unavailable" previous={snapshotFromData(prior)} current={snapshotFromData(data)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("no selection changes are inferred");
    expect(screen.queryByRole("button", { name: "Open exact historical comparison" })).not.toBeInTheDocument();
  });

  it("supports empty filtered inventory and exact catalog/lineage evidence targets", () => {
    const values = props();
    render(<PoliciesAiSection {...values} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search policy and AI inventory" }), { target: { value: "missing" } });
    expect(screen.getByText(/No inventoried artifacts match/)).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search policy and AI inventory" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Inspect Recorded agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open catalog evidence" }));
    expect(values.onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "catalog", focus: expect.objectContaining({ itemId: "agent" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Open lineage evidence" }));
    expect(values.onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "map", focus: expect.objectContaining({ itemId: "agent" }),
    }));
  });

  it("manages a mobile evidence drawer, native keyboard controls and focus restoration", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    render(<PoliciesAiSection {...props()} />);
    const inspect = screen.getByRole("button", { name: /Inspect Recorded agent/ });
    await act(async () => { inspect.focus(); fireEvent.click(inspect); });
    const dialog = await screen.findByRole("dialog", { name: "Policies and AI evidence" });
    const close = within(dialog).getByRole("button", { name: "Close AI evidence details" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(inspect).toHaveFocus());
  });
});
