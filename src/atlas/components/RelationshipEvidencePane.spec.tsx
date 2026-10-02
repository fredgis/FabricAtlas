import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createItemRelationsEvidence,
  recordItemRelationsResponse,
} from "../item-relations-evidence";
import { buildLineageEvidence } from "../lineage-evidence";
import type { Item } from "../model";
import { LineageSourceLegend } from "./LineageSourceLegend";
import { RelationshipEvidencePane } from "./RelationshipEvidencePane";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const LAKEHOUSE = "aaaaaaaa-0000-4000-8000-000000000001";
const MODEL = "aaaaaaaa-0000-4000-8000-000000000002";
const OBSERVED = "2026-10-01T08:00:00.000Z";

const items: Item[] = [
  { fabricId: LAKEHOUSE, itemType: "Lakehouse", displayName: "Rental warehouse", health: "healthy", endorsement: "none", tags: [] },
  { fabricId: MODEL, itemType: "SemanticModel", displayName: "Sales model", health: "healthy", endorsement: "none", tags: [] },
];

const model = buildLineageEvidence({
  items,
  edges: [{ source: LAKEHOUSE, target: MODEL, relation: "reads" }],
  workspaceId: WORKSPACE,
  workspaceName: "Sales",
  evidence: createItemRelationsEvidence(WORKSPACE, OBSERVED, [
    recordItemRelationsResponse(MODEL, "upstream", OBSERVED, {
      items: [{ id: LAKEHOUSE, workspaceId: WORKSPACE, type: "Lakehouse", displayName: "Rental warehouse" }],
      relations: [{ itemId: LAKEHOUSE, dependentOnItemId: MODEL, relationType: "Datasource" }],
      workspaces: [],
    }),
  ]),
});
const conflict = model.relationships[0];
const names = new Map(items.map((item) => [item.fabricId, item.displayName]));

describe("RelationshipEvidencePane", () => {
  it("follows the mockup structure: facts, per-source cards and callouts", () => {
    const onReviewConflict = vi.fn();
    render(
      <RelationshipEvidencePane
        relationship={conflict}
        snapshotSyncedAt={OBSERVED}
        itemNames={names}
        onReviewConflict={onReviewConflict}
      />,
    );
    const pane = screen.getByRole("region", { name: "Relationship evidence" });

    expect(within(pane).getByRole("heading", { level: 3, name: "Rental warehouse to Sales model" })).toBeInTheDocument();
    const facts = within(pane).getAllByRole("term").map((term) => term.textContent);
    expect(facts.slice(0, 2)).toEqual(["Type", "Workspace boundary"]);
    expect(pane).toHaveTextContent("Same workspace");
    const cards = within(pane).getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Atlas snapshot · Collected");
    expect(cards[0]).toHaveTextContent("Reports that Sales model uses data from Rental warehouse (reads).");
    expect(cards[0]).toHaveTextContent("SourceAtlas snapshot syncConfidenceVerified");
    expect(cards[1]).toHaveTextContent("Item Relations API · Beta");
    expect(cards[1]).toHaveTextContent("Reports an inverse relation (Sales model → Rental warehouse).");
    expect(cards[1]).toHaveTextContent("SourceItem Relations API (Beta)ConfidenceObserved");
    expect(within(pane).getAllByRole("note").map((note) => note.textContent)).toEqual([
      expect.stringContaining("Direction differs between sources"),
      expect.stringContaining("Evidence remains separate."),
    ]);
    expect(pane.querySelector(".overflow-auto")).toHaveClass("space-y-l");
    expect(pane.querySelector(".overflow-auto")).not.toHaveClass("flex-col");

    fireEvent.click(within(pane).getByRole("button", { name: "Review conflict" }));
    expect(onReviewConflict).toHaveBeenCalledWith(conflict.id);
  });

  it("omits the review action when no handler is available", () => {
    render(
      <RelationshipEvidencePane relationship={conflict} itemNames={names} />,
    );

    expect(screen.queryByRole("button", { name: "Review conflict" })).not.toBeInTheDocument();
    expect(screen.getByText("Collected with the synchronized snapshot")).toBeInTheDocument();
  });
});

describe("LineageSourceLegend", () => {
  it("lists the mockup sources in order and only shows Beta entries with evidence", () => {
    const { rerender } = render(<LineageSourceLegend mode="items" previewIncluded />);
    expect(
      within(screen.getByRole("group", { name: "Lineage legend" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Atlas snapshot (verified)",
      "Item Relations API (Beta, observed)",
      "Conflict (review needed)",
      "Upstream path",
    ]);
    expect(screen.getByText("Sources and paths")).toBeVisible();
    expect(screen.getByText("Dashed Beta evidence is observed, not authoritative.")).toBeVisible();

    rerender(<LineageSourceLegend mode="items" previewIncluded={false} />);
    expect(screen.queryByText("Item Relations API (Beta, observed)")).not.toBeInTheDocument();
    expect(screen.queryByText("Conflict (review needed)")).not.toBeInTheDocument();
    expect(screen.getByText("Only Atlas snapshot lineage is drawn.")).toBeVisible();
  });
});
