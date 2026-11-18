import { describe, expect, it } from "vitest";
import { buildGovernanceFindings } from "./governance";
import { parseGovernanceEvidence } from "./governance-evidence";
import { confidentialDataAgents, dataAgentTelemetryGuardrails } from "./data-agent-telemetry";
import type { AtlasData, Item } from "./model";

const NAMES = { operational: ["OpsSetting"], userContent: ["UserSetting"], crossGeo: ["GeoSetting"] };
const item = (fabricId: string, overrides: Partial<Item> = {}): Item => ({
  fabricId, displayName: fabricId, itemType: "Lakehouse", health: "healthy", endorsement: "none", tags: [], ...overrides,
});
const settings = (entries: { settingName: string; enabled: boolean }[], status = "complete") =>
  parseGovernanceEvidence({ collectedAt: "2026-11-18T00:00:00Z", tenantSettings: { status: { status }, entries } });

describe("Data Agent telemetry guardrails", () => {
  it("matches settings on the exact settingName and keeps the rest Unknown", () => {
    const value = dataAgentTelemetryGuardrails(
      { governanceEvidence: settings([{ settingName: "UserSetting", enabled: true }, { settingName: "OpsSetting", enabled: false }, { settingName: "geosetting", enabled: true }]) },
      NAMES,
    );
    expect(value.map((entry) => [entry.id, entry.state])).toEqual([["operational", "disabled"], ["userContent", "enabled"], ["crossGeo", "unknown"]]);
  });

  it("is Unknown when tenant settings were not collected or names are not verified", () => {
    expect(dataAgentTelemetryGuardrails({ governanceEvidence: settings([], "unsupported") }, NAMES).every((entry) => entry.state === "unknown")).toBe(true);
    expect(dataAgentTelemetryGuardrails({}, NAMES)[0].reason).toMatch(/not collected/);
    expect(dataAgentTelemetryGuardrails({ governanceEvidence: settings([{ settingName: "UserSetting", enabled: true }]) }, { operational: [], userContent: [], crossGeo: [] })[1].reason).toMatch(/not verified/);
  });

  it("finds agents reading Confidential or stricter sources", () => {
    const data = {
      items: [
        item("lake", { sensitivity: "Highly Confidential" }),
        item("public", { sensitivity: "General" }),
        item("agent", { itemType: "DataAgent" }),
        item("other", { itemType: "DataAgent" }),
      ],
      itemMetadata: {
        agent: { kind: "dataAgent", sources: [{ artifactId: "lake", displayName: "lake", sourceType: "lakehouse_tables", elements: [], selectedElements: [] }] },
        other: { kind: "dataAgent", sources: [{ artifactId: "public", displayName: "public", sourceType: "lakehouse_tables", elements: [], selectedElements: [] }] },
      },
    } as unknown as AtlasData;
    expect(confidentialDataAgents(data).map((entry) => entry.agent.fabricId)).toEqual(["agent"]);
  });

  it("raises nothing without Confidential agents, even when user-level telemetry is allowed", () => {
    const data = {
      workspace: { fabricId: "ws", displayName: "WS", capacity: "", region: "" },
      items: [item("agent", { itemType: "DataAgent" })],
      edges: [], principals: [], grants: [], jobs: [], config: [], comments: [], syncRuns: [],
      governanceEvidence: settings([{ settingName: "UserSetting", enabled: true }]),
    } as AtlasData;
    expect(buildGovernanceFindings(data).filter((finding) => finding.id.startsWith("data-agent-telemetry:"))).toEqual([]);
  });
});
