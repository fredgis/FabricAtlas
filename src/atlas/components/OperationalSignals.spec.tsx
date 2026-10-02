import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasData, Job } from "../model";
import type { AtlasContextValue } from "../store";

const harness = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock("../store", () => ({ useAtlas: () => harness.context }));

import { OperationalSignals } from "./OperationalSignals";

const NOTEBOOK = "30000000-0000-4000-8000-000000000001";
const LAKEHOUSE = "30000000-0000-4000-8000-000000000002";
const REPORT = "30000000-0000-4000-8000-000000000003";
const MODEL = "30000000-0000-4000-8000-000000000004";

function snapshot(jobs: Job[]): AtlasData {
  return {
    workspace: {
      fabricId: "6bf4c521-7412-4e6b-8867-68253bbfb18a",
      displayName: "Sales",
      capacity: "",
      region: "",
    },
    items: [
      { fabricId: NOTEBOOK, displayName: "Load sales", itemType: "Notebook" },
      { fabricId: LAKEHOUSE, displayName: "Sales lakehouse", itemType: "Lakehouse" },
      { fabricId: MODEL, displayName: "Sales model", itemType: "SemanticModel" },
      { fabricId: REPORT, displayName: "Sales report", itemType: "Report" },
    ],
    edges: [
      { source: NOTEBOOK, target: LAKEHOUSE, relation: "writes" },
      { source: LAKEHOUSE, target: MODEL, relation: "feeds" },
      { source: MODEL, target: REPORT, relation: "binds" },
    ],
    principals: [],
    grants: [],
    jobs,
    config: [],
    comments: [],
    syncRuns: [],
    schema: {},
  } as unknown as AtlasData;
}

function renderSignals(
  jobs: Job[],
  handlers: {
    onShowRuns?: () => void;
    onOpenImpact?: (itemId: string) => void;
  } = {},
) {
  harness.context = {
    data: snapshot(jobs),
    lastSyncedAt: "2026-10-02T06:00:00.000Z",
  } as unknown as AtlasContextValue;
  const onShowRuns = handlers.onShowRuns ?? vi.fn();
  render(
    <OperationalSignals
      onShowRuns={onShowRuns}
      onOpenImpact={handlers.onOpenImpact}
    />,
  );
  return onShowRuns;
}

const failedNotebook: Job = {
  itemFabricId: NOTEBOOK,
  itemName: "Load sales",
  jobType: "Notebook run",
  status: "failed",
  startedAt: "2026-10-02T05:00:00.000Z",
  durationSec: 61,
  message: "Spark session terminated.",
};

describe("OperationalSignals", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_FABRIC_ITEM_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("separates the observed failure from its inferred downstream impact", () => {
    const onOpenImpact = vi.fn();
    const onShowRuns = renderSignals([failedNotebook], { onOpenImpact });

    const incidents = screen.getByRole("list", { name: "Observed failures" });
    const [incident] = within(incidents).getAllByRole("listitem");
    expect(within(incident).getByRole("heading", { name: "Load sales" })).toBeInTheDocument();
    expect(within(incident).getByText("Observed failure")).toBeInTheDocument();
    expect(within(incident).getByText("Spark session terminated.")).toBeInTheDocument();

    const impact = within(incident).getByRole("list", {
      name: "Inferred downstream impact of Load sales",
    });
    expect(within(impact).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Sales lakehouse"),
      expect.stringContaining("Sales model"),
      expect.stringContaining("Sales report"),
    ]);
    expect(
      within(incident).getByText(/3 downstream items in snapshot lineage\. Not confirmed by monitoring\./),
    ).toBeInTheDocument();

    fireEvent.click(within(incident).getByRole("button", { name: "Show this run" }));
    expect(onShowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: "observed", itemId: NOTEBOOK }),
    );
    fireEvent.click(
      within(incident).getByRole("button", {
        name: "Open impact in Map & lineage",
      }),
    );
    expect(onOpenImpact).toHaveBeenCalledWith(NOTEBOOK);
  });

  it("does not raise an incident once a later run of the same job succeeded", () => {
    renderSignals([
      failedNotebook,
      { ...failedNotebook, status: "completed", startedAt: "2026-10-02T05:30:00.000Z", message: undefined },
    ]);

    expect(screen.queryByRole("list", { name: "Observed failures" })).toBeNull();
    expect(screen.getByText(/No current failures\./)).toBeInTheDocument();
  });

  it("explains an empty job history instead of showing a healthy state", () => {
    renderSignals([]);

    expect(screen.getByText(/No job history is in this snapshot\./)).toBeInTheDocument();
  });

  it("states which monitoring sources Atlas does not collect", () => {
    renderSignals([]);

    const sources = screen.getByRole("list", { name: "Monitoring sources" });
    const rows = within(sources).getAllByRole("listitem").filter((row) =>
      within(row).queryByRole("heading"),
    );
    expect(
      rows.map((row) => [
        within(row).getByRole("heading").textContent,
        row.textContent?.match(/Collected|Not collected|Fabric portal only/)?.[0],
      ]),
    ).toEqual([
      ["Fabric job history", "Collected"],
      ["Workspace monitoring", "Not collected"],
      ["Monitor hub job alerts", "Fabric portal only"],
      ["Fabric App Metrics", "Fabric portal only"],
    ]);
    expect(
      screen.getByText(/cannot tell whether monitoring is enabled/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No deployed app item ID is configured in this build/),
    ).toBeInTheDocument();
  });

  it("opens verified Monitor hub pages in a new tab", () => {
    renderSignals([]);

    for (const [name, path] of [
      ["Job runs in Monitor hub", "/monitoringhub/jobs?"],
      ["Alerts in Monitor hub", "/monitoringhub/alerts?"],
      ["Applications in Monitor hub", "/monitoringhub/applications?"],
    ] as const) {
      const link = screen.getByRole("link", {
        name: `${name} (opens in a new tab)`,
      });
      expect(link.getAttribute("href")).toContain(path);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });
});
