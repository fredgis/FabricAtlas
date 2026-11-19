import { describe, expect, it } from "vitest";
import type { AtlasData, Item, Job } from "./model";
import {
  buildRetirementRadar,
  normalizedRetirementName,
  retirementCandidateId,
  retirementCandidatesToCsv,
  retirementCandidatesToMarkdown,
  retirementReviewedNote,
  retirementReviewState,
  RETIREMENT_FOLLOW_UP_NOTE,
} from "./retirement-radar";
import type { FindingAcknowledgement } from "./finding-acks";

const OLD = "2025-12-01T00:00:00.000Z";
const RECENT = "2026-05-28T00:00:00.000Z";

function item(fabricId: string, overrides: Partial<Item> = {}): Item {
  return {
    fabricId,
    displayName: fabricId,
    itemType: "Lakehouse",
    health: "healthy",
    endorsement: "none",
    tags: [],
    ownerName: "Ada",
    ownerMetadataAvailable: true,
    description: "Documented",
    updatedAt: RECENT,
    ...overrides,
  };
}

function job(itemFabricId: string, status: Job["status"], startedAt: string): Job {
  return { itemFabricId, itemName: itemFabricId, jobType: "Run", status, startedAt, durationSec: 1 };
}

function atlas(overrides: Partial<AtlasData> = {}, lineage: "complete" | "failed" = "complete"): AtlasData {
  return {
    workspace: {
      fabricId: "workspace",
      displayName: "Workspace",
      capacity: "F2",
      region: "West Europe",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncSections: { lineage: { status: lineage }, jobs: { status: "complete" } },
    },
    items: [],
    edges: [],
    principals: [],
    grants: [],
    jobs: [],
    config: [],
    comments: [],
    syncRuns: [],
    ...overrides,
  };
}

const ids = (data: AtlasData) => buildRetirementRadar(data).candidates.map((candidate) => candidate.item.fabricId);
const signalsOf = (data: AtlasData, itemId: string) =>
  buildRetirementRadar(data).candidates.find((candidate) => candidate.item.fabricId === itemId)?.signals.map((signal) => signal.id);

describe("retirement radar candidates", () => {
  it("lists a dormant producer without consumers and explains each signal", () => {
    const data = atlas({ items: [item("lake", { updatedAt: OLD, ownerName: undefined })] });
    const [candidate] = buildRetirementRadar(data).candidates;
    expect(candidate.id).toBe("retirement:lake");
    expect(candidate.signals.map((signal) => signal.id)).toEqual(["dormant", "no-consumer", "no-owner"]);
    expect(candidate.signals[0].evidence).toEqual(["dormant-producer"]);
    expect(candidate.signals.every((signal) => signal.detail.length > 0)).toBe(true);
  });

  it("never applies the consumer signal to terminal consumer types", () => {
    const data = atlas({
      items: [
        item("report", { itemType: "Report", updatedAt: OLD }),
        item("model", { itemType: "SemanticModel", updatedAt: OLD }),
      ],
      edges: [{ source: "model", target: "report", relation: "binds" }],
    });
    expect(signalsOf(data, "report")).toBeUndefined();
    expect(signalsOf(data, "model")).toBeUndefined();
  });

  it("keeps missing lineage evidence unknown instead of reporting no consumer", () => {
    const data = atlas({ items: [item("lake", { ownerName: undefined, description: undefined })] }, "failed");
    const radar = buildRetirementRadar(data);
    expect(radar.candidates).toEqual([]);
    expect(radar.unknownItems).toBe(1);
  });

  it("requires a retirement signal: metadata gaps alone are not enough", () => {
    const data = atlas({ items: [item("notebook", { itemType: "Notebook", ownerName: undefined, description: undefined })] });
    expect(ids(data)).toEqual([]);
  });

  it("flags items whose collected runs all failed, from two runs", () => {
    const data = atlas({
      items: [
        item("pipe", { itemType: "DataPipeline", description: undefined }),
        item("once", { itemType: "DataPipeline", description: undefined }),
        item("mixed", { itemType: "DataPipeline", description: undefined }),
      ],
      jobs: [
        job("pipe", "failed", "2026-05-30T00:00:00Z"), job("pipe", "failed", "2026-05-29T00:00:00Z"),
        job("once", "failed", "2026-05-30T00:00:00Z"),
        job("mixed", "failed", "2026-05-30T00:00:00Z"), job("mixed", "completed", "2026-05-29T00:00:00Z"),
      ],
    });
    expect(ids(data)).toEqual(["pipe"]);
    expect(signalsOf(data, "pipe")).toEqual(["failed-runs", "no-trust"]);
  });

  it("matches duplicate names of the same type, ignoring copy markers", () => {
    expect(normalizedRetirementName("Sales overview (copy)")).toBe("sales overview");
    expect(normalizedRetirementName("Sales overview - Copy 2")).toBe("sales overview");
    expect(normalizedRetirementName("Sales overview (2)")).toBe("sales overview");
    const data = atlas({
      items: [
        item("a", { itemType: "Report", displayName: "Sales overview", description: undefined }),
        item("b", { itemType: "Report", displayName: "Sales overview (copy)", description: undefined }),
        item("c", { itemType: "Notebook", displayName: "Sales overview" }),
      ],
    });
    expect(ids(data)).toEqual(["a", "b"]);
  });

  it("orders by signal count and reports the profile and context", () => {
    const data = atlas({
      items: [
        item("lake", { updatedAt: OLD, ownerName: undefined, description: undefined }),
        item("pipe", { itemType: "DataPipeline", description: undefined }),
      ],
      jobs: [job("pipe", "failed", "2026-05-30T00:00:00Z"), job("pipe", "failed", "2026-05-29T00:00:00Z")],
      grants: [{ principalRef: "u1", accessLevel: "view", source: "workspaceRole" }],
    });
    const radar = buildRetirementRadar(data);
    expect(radar.candidates.map((candidate) => candidate.item.fabricId)).toEqual(["lake", "pipe"]);
    expect(radar.profile).toMatchObject({ dormant: 1, "no-consumer": 1, "failed-runs": 1, "no-owner": 1, "no-trust": 2 });
    expect(radar.candidates[1].context).toMatchObject({ principals: 1, downstream: 0 });
    expect(radar.candidates[1].context.recentJobs.map((entry) => entry.startedAt)).toEqual(["2026-05-30T00:00:00Z", "2026-05-29T00:00:00Z"]);
  });
});

describe("retirement review state", () => {
  const data = atlas({ items: [item("lake", { updatedAt: OLD })] });
  const [candidate] = buildRetirementRadar(data).candidates;
  const ack = (overrides: Partial<FindingAcknowledgement>): FindingAcknowledgement => ({
    id: "ack", findingId: retirementCandidateId("lake"), status: "acked", updatedAt: RECENT, ...overrides,
  });

  it("maps personal acknowledgements to review states", () => {
    expect(retirementReviewState(candidate, undefined)).toBe("open");
    expect(retirementReviewState(candidate, ack({ status: "muted" }))).toBe("muted");
    expect(retirementReviewState(candidate, ack({ note: RETIREMENT_FOLLOW_UP_NOTE }))).toBe("follow-up");
    expect(retirementReviewState(candidate, ack({ note: retirementReviewedNote(candidate) }))).toBe("reviewed");
  });

  it("reopens a reviewed candidate when its signals change, keeping follow-up", () => {
    const reviewed = ack({ note: retirementReviewedNote(candidate) });
    const changed = buildRetirementRadar(atlas({ items: [item("lake", { updatedAt: OLD, ownerName: undefined })] })).candidates[0];
    expect(changed.id).toBe(candidate.id);
    expect(retirementReviewState(changed, reviewed)).toBe("open");
    expect(retirementReviewState(changed, ack({ note: RETIREMENT_FOLLOW_UP_NOTE }))).toBe("follow-up");
  });
});

describe("retirement exports", () => {
  it("exports the filtered review as CSV and Markdown without claiming deletion safety", () => {
    const [candidate] = buildRetirementRadar(atlas({ items: [item("=lake", { updatedAt: OLD, displayName: "=lake|raw" })] })).candidates;
    const csv = retirementCandidatesToCsv([{ candidate, state: "follow-up" }]);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain(`"'=lake|raw"`);
    expect(csv).toContain(`"Dormant; No downstream consumer"`);
    const markdown = retirementCandidatesToMarkdown([{ candidate, state: "follow-up" }], "Sales", "2026-06-01");
    expect(markdown).toContain("| =lake\\|raw | Lakehouse | Dormant; No downstream consumer | Ada | 0 | follow-up |");
    expect(markdown).toContain("does not claim that any item is unused or safe to delete");
  });
});
