import { describe, expect, it } from "vitest";
import {
  accessLayerSummary,
  assessAccessEvidence,
  buildAccessEvidenceCoverage,
  evaluatedAccessLayers,
  matchesAccessCoverage,
  parseAccessCoverageFilter,
  type AccessLayerEvidence,
} from "./access-coverage";
import type { Grant, WorkspaceInfo } from "./model";

const grants: Grant[] = [
  { principalRef: "principal-id", accessLevel: "edit", source: "workspaceRole" },
  { principalRef: "principal-id", itemFabricId: "item-id", accessLevel: "view", source: "directShare" },
];
const workspace: WorkspaceInfo = {
  fabricId: "workspace-id",
  displayName: "Workspace",
  capacity: "F2",
  region: "West Europe",
  snapshotId: "snapshot-id",
  syncedAt: "2026-10-02T10:00:00.000Z",
  syncSections: { access: { status: "complete" } },
};

describe("grant-only access evidence coverage", () => {
  it("keeps observed grants separate from unsupported and unavailable restrictions", () => {
    const coverage = buildAccessEvidenceCoverage(grants, workspace);
    expect(coverage).toMatchObject({
      state: "partial",
      workspaceId: "workspace-id",
      snapshotId: "snapshot-id",
      observedAt: workspace.syncedAt,
    });
    expect(coverage.layers).toEqual([
      expect.objectContaining({ layer: "workspace-grants", state: "observed", source: "workspaceRole" }),
      expect.objectContaining({ layer: "item-grants", state: "observed", source: "directShare" }),
      expect.objectContaining({ layer: "group-membership", state: "unavailable" }),
      expect.objectContaining({ layer: "onelake-security", state: "unsupported" }),
      expect.objectContaining({ layer: "purview-dlp", state: "unsupported" }),
      expect.objectContaining({ layer: "fabric-policies", state: "unavailable" }),
    ]);
    expect(evaluatedAccessLayers(coverage)).toBe("Workspace grants; Item grants");
    expect(accessLayerSummary(coverage)).not.toMatch(/none|unrestricted|no restrictions/i);
  });

  it("fails closed without grants, a manifest or observation time", () => {
    const coverage = buildAccessEvidenceCoverage([]);
    expect(coverage.state).toBe("unavailable");
    expect(coverage.snapshotId).toBeUndefined();
    expect(coverage.observedAt).toBeUndefined();
    expect(evaluatedAccessLayers(coverage)).toBe("Not evaluated");
    expect(coverage.layers.every((layer) => layer.state !== "observed")).toBe(true);
  });

  it("does not treat blank provenance as recorded", () => {
    const coverage = buildAccessEvidenceCoverage(grants, {
      ...workspace, fabricId: "  ", snapshotId: "", syncedAt: " ",
    });
    expect(coverage.workspaceId).toBeUndefined();
    expect(coverage.snapshotId).toBeUndefined();
    expect(coverage.observedAt).toBeUndefined();
  });

  it.each(["FORBIDDEN", "HTTP_403", "ACCESS_DENIED", "401", "UNAUTHORIZED"])(
    "distinguishes a %s evidence-read failure from denied access",
    (code) => {
      const coverage = buildAccessEvidenceCoverage([grants[0]], {
        ...workspace,
        syncSections: { access: { status: "failed", code } },
      });
      expect(coverage.state).toBe("partial");
      expect(coverage.layers[0].state).toBe("partial");
      expect(coverage.layers[1]).toMatchObject({ state: "denied" });
      expect(coverage.layers[1].reason).toContain("not a denied grant");
      expect(evaluatedAccessLayers(coverage)).toBe("Workspace grants (partial evidence)");
      expect(matchesAccessCoverage(coverage, "denied")).toBe(true);
    },
  );

  it("does not turn timeout or unsupported collection into an access denial", () => {
    const failed = buildAccessEvidenceCoverage([], {
      ...workspace,
      syncSections: { access: { status: "failed", code: "TIMEOUT" } },
    });
    const unsupported = buildAccessEvidenceCoverage([], {
      ...workspace,
      syncSections: { access: { status: "unsupported" } },
    });
    expect(failed.layers[0].state).toBe("unavailable");
    expect(unsupported.layers[0].state).toBe("unsupported");
    expect(matchesAccessCoverage(failed, "denied")).toBe(false);
  });

  it("never treats a complete access section as complete restriction evidence", () => {
    const coverage = buildAccessEvidenceCoverage([], workspace);
    expect(coverage.state).toBe("unavailable");
    expect(evaluatedAccessLayers(coverage)).toBe("Not evaluated");
    expect(coverage.layers.find((layer) => layer.layer === "fabric-policies")?.state)
      .toBe("unavailable");
  });

  it("assesses denied, unsupported, unavailable and partial evidence without a healthy state", () => {
    const evidence = (state: AccessLayerEvidence["state"]): AccessLayerEvidence => ({
      layer: "workspace-grants", state, reason: "Snapshot evidence",
    });
    expect(assessAccessEvidence([])).toBe("unavailable");
    expect(assessAccessEvidence([evidence("unsupported")])).toBe("unsupported");
    expect(assessAccessEvidence([evidence("denied")])).toBe("denied");
    expect(assessAccessEvidence([evidence("unavailable")])).toBe("unavailable");
    expect(assessAccessEvidence([evidence("observed")])).toBe("partial");
    expect(assessAccessEvidence([evidence("observed"), evidence("denied")])).toBe("partial");
    expect(assessAccessEvidence([evidence("partial")])).toBe("partial");
  });

  it("filters by matching layer states without hiding the partial assessment", () => {
    const coverage = buildAccessEvidenceCoverage(grants, workspace);
    for (const filter of ["all", "observed", "partial", "unavailable", "unsupported"] as const) {
      expect(matchesAccessCoverage(coverage, filter)).toBe(true);
    }
    expect(matchesAccessCoverage(coverage, "denied")).toBe(false);
  });

  it.each([undefined, null, "complete", "none", "unrestricted", "toString", 4])(
    "ignores invalid restored coverage filter %s",
    (value) => expect(parseAccessCoverageFilter(value)).toBe("all"),
  );
});
