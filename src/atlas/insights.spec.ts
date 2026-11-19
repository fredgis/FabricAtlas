import { describe, expect, it } from "vitest";
import type { AtlasData, Item } from "./model";
import type { SnapshotSummary } from "./history";
import { buildAtlasInsights, JOB_CALENDAR_DAYS, projectSeries } from "./insights";

const NOW = Date.parse("2026-06-01T12:00:00Z");

const item = (fabricId: string, overrides: Partial<Item> = {}): Item => ({
  fabricId, displayName: fabricId, itemType: "Lakehouse", health: "healthy", endorsement: "none", tags: [], ...overrides,
});

function atlas(overrides: Partial<AtlasData> = {}): AtlasData {
  return {
    workspace: {
      fabricId: "ws-active", displayName: "Sales", capacity: "F2", region: "West Europe",
      syncedAt: "2026-06-01T00:00:00Z", syncSections: { lineage: { status: "complete" } },
    },
    items: [], edges: [], principals: [], grants: [], jobs: [], config: [], comments: [], syncRuns: [],
    ...overrides,
  };
}

function point(syncedAt: string, items: number): SnapshotSummary {
  return { snapshotId: syncedAt, syncedAt, label: syncedAt, items, labels: 0, failing: 0, failedJobs: 0, brokenEdges: 0 } as SnapshotSummary;
}

describe("Atlas Insights aggregates", () => {
  it("derives item, label, job and lineage figures from the current snapshot", () => {
    const insights = buildAtlasInsights({
      now: NOW,
      statuses: {},
      trend: [],
      data: atlas({
        items: [
          item("a", { sensitivity: "General", ownerName: "Ada" }),
          item("b", { itemType: "Report", ownerName: "Ada" }),
          item("c", { itemType: "Report" }),
        ],
        edges: [{ source: "a", target: "b", relation: "feeds" }, { source: "a", target: "x", relation: "feeds", broken: true }],
        jobs: [
          { itemFabricId: "a", itemName: "a", jobType: "Run", status: "completed", startedAt: "2026-05-30T10:00:00Z", durationSec: 1 },
          { itemFabricId: "a", itemName: "a", jobType: "Run", status: "failed", startedAt: "2026-05-30T11:00:00Z", durationSec: 1 },
          { itemFabricId: "a", itemName: "a", jobType: "Run", status: "running", startedAt: "2026-05-31T11:00:00Z", durationSec: 1 },
        ],
      }),
    });
    expect(insights.items).toBe(3);
    expect(insights.labeled).toEqual({ labeled: 1, total: 3, rate: 33 });
    expect(insights.jobs).toEqual({ runs: 2, succeeded: 1, failed: 1, rate: 50 });
    expect(insights.itemTypes).toEqual([
      { key: "Report", label: "Report", value: 2 },
      { key: "Lakehouse", label: "Lakehouse", value: 1 },
    ]);
    expect(insights.owners).toEqual([
      { key: "Ada", label: "Ada", value: 2 },
      { key: "No owner", label: "No owner", value: 1 },
    ]);
    expect(insights.lineage).toEqual({ edges: 2, resolved: 1, itemsWithLineage: 2, lineageKnown: true });
    expect(insights.jobCalendar).toHaveLength(JOB_CALENDAR_DAYS);
    expect(insights.jobCalendar.find((day) => day.date === "2026-05-30")).toEqual({ date: "2026-05-30", runs: 2, failed: 1 });
  });

  it("keeps unknown evidence unknown instead of zero", () => {
    const insights = buildAtlasInsights({
      now: NOW,
      trend: [],
      statuses: { "ws-other": { snapshotId: "s1", displayName: "Other" } },
      data: atlas({ workspace: { ...atlas().workspace, syncSections: { lineage: { status: "failed" } } } }),
    });
    const other = insights.workspaces.find((row) => row.id === "ws-other");
    expect(other).toMatchObject({ name: "Other", active: false });
    expect(other?.findings).toBeUndefined();
    expect(other?.labeled).toBeUndefined();
    expect(insights.connectors).toBeUndefined();
    expect(insights.lineage.lineageKnown).toBe(false);
    expect(insights.jobs.rate).toBeNull();
    expect(insights.labeled.rate).toBeNull();
  });

  it("uses other workspaces' governance summaries and the selected period", () => {
    const summary = {
      version: 1 as const, items: 10,
      findings: { critical: 1, high: 2, medium: 3, low: 4 },
      pillars: { health: 80, protect: 40, trust: null },
      coverage: {
        endorsed: { numerator: 0, denominator: 10, unknown: 0 }, certified: { numerator: 0, denominator: 10, unknown: 0 },
        described: { numerator: 0, denominator: 10, unknown: 0 }, labeled: { numerator: 4, denominator: 10, unknown: 2 },
        tagged: { numerator: 0, denominator: 10, unknown: 0 },
      },
    };
    const insights = buildAtlasInsights({
      now: NOW,
      period: 3,
      statuses: { "ws-other": { snapshotId: "s1", displayName: "Other", governanceSummary: summary } },
      trend: [point("2025-12-01T00:00:00Z", 5), point("2026-04-01T00:00:00Z", 8), point("2026-03-15T00:00:00Z", 7)],
      data: atlas(),
    });
    expect(insights.workspaces.find((row) => row.id === "ws-other")).toMatchObject({
      findings: summary.findings, labeled: { labeled: 4, total: 10, unknown: 2 },
    });
    expect(insights.trend.map((entry) => entry.items)).toEqual([7, 8]);
  });

  it("groups connections by connector", () => {
    const connection = (id: string, connectorType?: string) =>
      ({ id, displayName: id, connectivityType: "ShareableCloud", connectorType, rolesStatus: "complete", roles: [] }) as never;
    const insights = buildAtlasInsights({
      now: NOW, trend: [], statuses: {}, data: atlas(),
      connections: { collectedAt: "2026-06-01", status: "complete", truncated: false, roleLookups: { done: 0, skipped: 0, failed: 0 },
        connections: [connection("a", "SQL"), connection("b", "SQL"), connection("c")] } as never,
    });
    expect(insights.connectors).toEqual([
      { key: "SQL", label: "SQL", value: 2 },
      { key: "ShareableCloud", label: "ShareableCloud", value: 1 },
    ]);
  });
});

describe("projection", () => {
  it("extends a linear series and never goes below zero", () => {
    expect(projectSeries([10, 20, 30], 2)).toEqual([40, 50]);
    expect(projectSeries([30, 20, 10], 3)).toEqual([0, 0, 0]);
    expect(projectSeries([1, 2], 2)).toEqual([]);
  });
});
