import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createItemRelationsEvidence,
  recordItemRelationsResponse,
} from "../item-relations-evidence";
import type { ItemRelationsEvidenceLoader } from "../item-relations-evidence-source";
import { SAMPLE_DATA } from "../model";
import { AtlasProvider } from "../store";
import { MapView } from "./Map";

const WORKSPACE = SAMPLE_DATA.workspace.fabricId;
const LAKEHOUSE = "10000000-0000-4000-8000-000000000001";
const WAREHOUSE = "10000000-0000-4000-8000-000000000007";
const MODEL = "10000000-0000-4000-8000-000000000008";
const PIPELINE = "10000000-0000-4000-8000-000000000011";
const BRONZE = "10000000-0000-4000-8000-000000000003";
const EXTERNAL_WORKSPACE = "20000000-0000-4000-8000-0000000000f0";
const EXTERNAL = "20000000-0000-4000-8000-000000000001";
const OBSERVED = "2026-10-01T08:00:00.000Z";
const BETA_EDGES = '[data-evidence-source="fabric-item-relations-api-beta"]';

function evidenceEnvelope() {
  return createItemRelationsEvidence(WORKSPACE, OBSERVED, [
    recordItemRelationsResponse(MODEL, "upstream", OBSERVED, {
      items: [
        {
          id: LAKEHOUSE,
          workspaceId: WORKSPACE,
          type: "Lakehouse",
          displayName: "alpinerent_lakehouse",
        },
        {
          id: EXTERNAL,
          workspaceId: EXTERNAL_WORKSPACE,
          type: "Lakehouse",
          displayName: "Shared reference lakehouse",
        },
      ],
      relations: [
        {
          itemId: LAKEHOUSE,
          dependentOnItemId: MODEL,
          relationType: "Datasource",
        },
        {
          itemId: MODEL,
          dependentOnItemId: EXTERNAL,
          relationType: "Shortcut",
        },
      ],
      workspaces: [{ id: EXTERNAL_WORKSPACE, displayName: "Shared data" }],
    }),
    recordItemRelationsResponse(PIPELINE, "downstream", OBSERVED, {
      items: [],
      relations: [
        {
          itemId: PIPELINE,
          dependentOnItemId: BRONZE,
          relationType: "Orchestration",
        },
      ],
      workspaces: [],
    }),
    recordItemRelationsResponse(WAREHOUSE, "upstream", OBSERVED, {
      items: [],
      relations: [
        {
          itemId: WAREHOUSE,
          dependentOnItemId: LAKEHOUSE,
          relationType: "Shortcut",
        },
      ],
      workspaces: [],
    }),
  ]);
}

const loadEvidence: ItemRelationsEvidenceLoader = async () => ({
  envelope: JSON.parse(JSON.stringify(evidenceEnvelope())),
  snapshotId: SAMPLE_DATA.workspace.snapshotId,
  coverage: { stopReasons: [] },
});
const loadNothing: ItemRelationsEvidenceLoader = async () => null;
const loadPartialEvidence: ItemRelationsEvidenceLoader = async () => ({
  envelope: JSON.parse(JSON.stringify(evidenceEnvelope())),
  snapshotId: "30000000-0000-4000-8000-000000000001",
  coverage: {
    sampledItemCount: 3,
    workspaceItemCount: SAMPLE_DATA.items.length,
    stopReasons: ["deadline-exhausted"],
  },
});
const SECOND_EXTERNAL = "20000000-0000-4000-8000-000000000002";
const OTHER_WORKSPACE = "40000000-0000-4000-8000-0000000000f0";
const loadChainEvidence: ItemRelationsEvidenceLoader = async () => ({
  envelope: JSON.parse(
    JSON.stringify(
      createItemRelationsEvidence(WORKSPACE, OBSERVED, [
        recordItemRelationsResponse(MODEL, "upstream", OBSERVED, {
          items: [
            {
              id: EXTERNAL,
              workspaceId: EXTERNAL_WORKSPACE,
              type: "Lakehouse",
              displayName: "Shared reference lakehouse",
            },
            {
              id: SECOND_EXTERNAL,
              workspaceId: OTHER_WORKSPACE,
              type: "Warehouse",
              displayName: "Raw landing warehouse",
            },
          ],
          relations: [
            { itemId: MODEL, dependentOnItemId: EXTERNAL, relationType: "Shortcut" },
            { itemId: EXTERNAL, dependentOnItemId: SECOND_EXTERNAL, relationType: "Datasource" },
          ],
          workspaces: [
            { id: EXTERNAL_WORKSPACE, displayName: "Shared data" },
            { id: OTHER_WORKSPACE, displayName: "Raw data" },
          ],
        }),
      ]),
    ),
  ),
});

function renderMap(
  props: Parameters<typeof MapView>[0] = {},
  url = "/#map",
) {
  window.history.replaceState(null, "", url);
  return render(
    <AtlasProvider isPreview>
      <MapView {...props} />
    </AtlasProvider>,
  );
}

function previewCheckbox() {
  return screen.getByRole("switch", {
    name: "Item Relations API evidence (Preview)",
  });
}

describe("Map & lineage unified evidence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps one map with Graph, Evidence and Changes and no Preview control when the flag is off", () => {
    const loader = vi.fn(loadEvidence);
    const { container } = renderMap({
      itemRelationsEnabled: false,
      loadItemRelationsEvidence: loader,
    });

    const views = screen.getByRole("tablist", { name: "Map and lineage views" });
    expect(
      within(views)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Graph", "Evidence", "Changes", "X-Ray"]);
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("checkbox", { name: /Item Relations/ }),
    ).not.toBeInTheDocument();
    expect(loader).not.toHaveBeenCalled();
    expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(0);
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(
      SAMPLE_DATA.items.length,
    );
    expect(
      within(screen.getByLabelText("Map summary"))
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Items", "Relationships"]);
    expect(screen.queryByText("Beta evidence · evaluation")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("switch").map((control) => control.textContent),
    ).toEqual(["Data flow relations", "Control relations", "Impact mode"]);
    expect(
      within(screen.getByRole("group", { name: "Lineage legend" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Atlas snapshot (verified)", "Upstream path"]);
  });

  it("loads persisted evidence only when Preview is included and reports when none exists", async () => {
    const loader = vi.fn(loadNothing);
    const { container } = renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loader,
    });

    expect(previewCheckbox()).not.toBeChecked();
    expect(loader).not.toHaveBeenCalled();

    fireEvent.click(previewCheckbox());

    expect(
      await screen.findByText(
        "No persisted Item Relations evidence for this workspace.",
      ),
    ).toBeInTheDocument();
    expect(loader).toHaveBeenCalledWith(WORKSPACE, expect.any(AbortSignal));
    expect(
      screen.getByRole("note", { name: "Preview API information" }),
    ).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("preview")).toBe(
      "item-relations",
    );
    expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(0);
    expect(
      screen.queryByText("Item Relations API (Beta, observed)"),
    ).not.toBeInTheDocument();
  });

  it("overlays Beta evidence without moving snapshot nodes", async () => {
    const { container } = renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loadEvidence,
    });
    const lakehouse = () =>
      screen.getByLabelText(/^alpinerent_lakehouse, Lakehouse, healthy/);
    const before = { left: lakehouse().style.left, top: lakehouse().style.top };

    fireEvent.click(previewCheckbox());

    await waitFor(() =>
      expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(3),
    );
    expect(lakehouse().style.left).toBe(before.left);
    expect(lakehouse().style.top).toBe(before.top);
    expect(lakehouse()).toHaveAccessibleName(
      "alpinerent_lakehouse, Lakehouse, healthy, direction conflict to review",
    );
    expect(screen.getByText("Shared reference lakehouse")).toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-preview-node]"),
    ).toHaveLength(1);
    expect(
      screen.getByText("Item Relations API (Beta, observed)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Conflict (review needed)")).toBeInTheDocument();
    const summary = screen.getByLabelText("Map summary");
    expect(within(summary).getByText("Conflict to review").nextSibling).toHaveTextContent("1");
    expect(within(summary).getByText("Relationships").nextSibling).toHaveTextContent(
      String(SAMPLE_DATA.edges.length + 2),
    );
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(
      SAMPLE_DATA.items.length,
    );
  });

  it("opens source provenance and the direction conflict from the graph", async () => {
    renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loadEvidence,
    }, "/?preview=item-relations#map");

    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Direction conflict: alpinerent_lakehouse to AlpineRent Sales Model/,
      }),
    );

    const pane = screen.getByRole("region", { name: "Relationship evidence" });
    expect(pane).toHaveTextContent("Atlas snapshot — Collected");
    expect(pane).toHaveTextContent(
      "Reports that AlpineRent Sales Model uses data from alpinerent_lakehouse (Direct Lake).",
    );
    expect(pane).toHaveTextContent("Item Relations API — Beta");
    expect(pane).toHaveTextContent(
      "Reports an inverse relation (AlpineRent Sales Model → alpinerent_lakehouse).",
    );
    expect(
      within(pane).getByText("Direction differs between sources"),
    ).toBeInTheDocument();
    expect(within(pane).getByText(/Evidence remains separate/)).toBeInTheDocument();

    fireEvent.click(
      within(pane).getByRole("button", { name: "Close relationship evidence" }),
    );
    expect(
      screen.getByRole("complementary", { name: "Item details inspector" }),
    ).toBeInTheDocument();
  });

  it("reviews a conflict from the evidence pane on the Evidence tab", async () => {
    renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loadEvidence,
    }, "/?preview=item-relations#map");
    fireEvent.click(
      await screen.findByRole("button", { name: /^Direction conflict:/ }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review conflict" }));
    });

    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: "Filter relationships by agreement" }),
    ).toHaveValue("conflict");
    const table = screen.getByRole("table", { name: "Lineage relationships" });
    const rows = within(table).getAllByRole("button");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
  });

  it("filters data-flow and control relations without moving nodes", async () => {
    const { container } = renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loadEvidence,
    }, "/?preview=item-relations#map");
    await waitFor(() =>
      expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(3),
    );
    const pipeline = screen.getByLabelText(/^AlpineRent Daily Load,/);
    const position = { left: pipeline.style.left, top: pipeline.style.top };
    const drawnTitles = () =>
      [...container.querySelectorAll("svg g > title")].map((node) => node.textContent);
    expect(drawnTitles()).toContain("orchestrates");

    fireEvent.click(screen.getByRole("switch", { name: "Control relations" }));

    expect(screen.getByRole("switch", { name: "Control relations" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(drawnTitles()).not.toContain("orchestrates");
    expect(drawnTitles()).toContain("Direct Lake");
    expect({ left: pipeline.style.left, top: pipeline.style.top }).toEqual(position);

    fireEvent.click(screen.getByRole("switch", { name: "Data flow relations" }));

    expect(drawnTitles()).not.toContain("Direct Lake");
    expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(0);
  });

  it("redirects legacy map-beta links to the single map with Preview included", async () => {
    renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loadNothing },
      "/#map-beta",
    );

    expect(previewCheckbox()).toBeChecked();
    await waitFor(() => expect(window.location.hash).toBe("#map"));
    expect(new URL(window.location.href).searchParams.get("preview")).toBe(
      "item-relations",
    );
    expect(
      await screen.findByText(
        "No persisted Item Relations evidence for this workspace.",
      ),
    ).toBeInTheDocument();
  });

  it("lists every relationship by source on the Evidence tab", async () => {
    renderMap({
      itemRelationsEnabled: true,
      loadItemRelationsEvidence: loadEvidence,
    }, "/?preview=item-relations#map");
    await screen.findByText("Conflict (review needed)");

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Evidence" }));
    });

    const table = screen.getByRole("table", { name: "Lineage relationships" });
    expect(within(table).getAllByRole("button").length).toBeGreaterThanOrEqual(
      SAMPLE_DATA.edges.length,
    );
    expect(
      within(table).getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Relationship", "Type", "Sources", "Agreement", "Open"]);
    expect(
      screen.getByRole("region", { name: "Item Relations evidence coverage" }),
    ).toHaveTextContent("Complete queries3");
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Filter relationships by agreement",
      }),
      { target: { value: "conflict" } },
    );
    const rows = within(table).getAllByRole("button");
    expect(rows).toHaveLength(1);

    fireEvent.click(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("region", { name: "Relationship evidence" }),
    ).toHaveTextContent("Direction differs between sources");
    expect(new URL(window.location.href).searchParams.get("view")).toBe(
      "evidence",
    );
  });

  it("shows snapshot lineage on the Evidence tab without Preview evidence", () => {
    renderMap({ itemRelationsEnabled: false }, "/?view=evidence#map");

    const table = screen.getByRole("table", { name: "Lineage relationships" });
    expect(within(table).getAllByRole("button")).toHaveLength(
      SAMPLE_DATA.edges.length,
    );
    expect(within(table).getAllByText("Atlas snapshot")).toHaveLength(
      SAMPLE_DATA.edges.length,
    );
    expect(within(table).getAllByText("Not compared")).toHaveLength(
      SAMPLE_DATA.edges.length,
    );
    expect(screen.getByText("Not included in this view")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Item Relations evidence coverage" }),
    ).not.toBeInTheDocument();
  });

  it("reports load failures and invalid envelopes without drawing evidence", async () => {
    const loader = vi
      .fn<ItemRelationsEvidenceLoader>()
      .mockRejectedValueOnce(new Error("network detail"))
      .mockResolvedValueOnce({ envelope: { schemaVersion: 2 } });
    const { container } = renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loader },
      "/?preview=item-relations#map",
    );

    expect(
      screen.getByText("Loading persisted Item Relations evidence…"),
    ).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Persisted Item Relations evidence could not be loaded.",
    );
    expect(alert).not.toHaveTextContent("network detail");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "failed validation",
      ),
    );
    expect(loader).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(BETA_EDGES)).toHaveLength(0);
  });

  it("labels partial persisted coverage and early collector stops", async () => {
    renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loadPartialEvidence },
      "/?preview=item-relations#map",
    );

    expect(
      await screen.findByText(
        `Partial: 3 of ${SAMPLE_DATA.items.length} items queried`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Stopped early: deadline-exhausted"),
    ).toBeInTheDocument();
  });

  it("expands stored cross-workspace relations without moving shown nodes", async () => {
    const { container } = renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loadChainEvidence },
      "/?preview=item-relations#map",
    );
    const expand = await screen.findByRole("button", {
      name: "Expand stored relations of Shared reference lakehouse (1 hidden)",
    });
    const lane = () => [...container.querySelectorAll<HTMLElement>("[data-preview-node]")];
    const first = lane()[0];
    const position = { left: first.style.left, top: first.style.top };
    expect(lane()).toHaveLength(1);

    fireEvent.click(expand);

    expect(lane()).toHaveLength(2);
    expect({ left: lane()[0].style.left, top: lane()[0].style.top }).toEqual(position);
    expect(screen.getByText("Raw landing warehouse")).toBeInTheDocument();
    const path = screen.getByRole("navigation", { name: "Cross-workspace exploration path" });
    expect(path).toHaveTextContent("Shared data: Shared reference lakehouse");
    expect(new URL(window.location.href).searchParams.get("expand")).toBe(
      `${EXTERNAL_WORKSPACE}:${EXTERNAL}`,
    );

    fireEvent.click(within(path).getByRole("button", { name: "Reset exploration" }));

    expect(lane()).toHaveLength(1);
    expect(new URL(window.location.href).searchParams.has("expand")).toBe(false);
  });

  it("restores expansions from the URL and ignores malformed keys", async () => {
    const { container } = renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loadChainEvidence },
      `/?preview=item-relations&expand=${EXTERNAL_WORKSPACE}:${EXTERNAL},not-a-key#map`,
    );

    expect(await screen.findByText("Raw landing warehouse")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-preview-node]")).toHaveLength(2);
    expect(new URL(window.location.href).searchParams.get("expand")).toBe(
      `${EXTERNAL_WORKSPACE}:${EXTERNAL}`,
    );
  });

  it("never reaches the backend for evidence in preview builds", async () => {
    renderMap({ itemRelationsEnabled: true }, "/?preview=item-relations#map");

    expect(
      await screen.findByText(
        "No persisted Item Relations evidence for this workspace.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that Changes need a second snapshot and never track Beta evidence", async () => {
    renderMap(
      { itemRelationsEnabled: true, loadItemRelationsEvidence: loadNothing },
      "/?view=changes&preview=item-relations#map",
    );

    expect(
      await screen.findByText(
        "No persisted Item Relations evidence for this workspace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Atlas snapshot lineage changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lineage changes appear after a second synchronized snapshot.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Item Relations changes are not tracked."),
    ).toBeInTheDocument();
  });
});
