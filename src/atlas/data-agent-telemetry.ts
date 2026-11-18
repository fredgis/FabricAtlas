import type { AtlasData, Item } from "./model";
import { parseDataAgentMetadata } from "./item-metadata";
import { standardLabelRank } from "./governance";

/**
 * Tenant settings that control Data Agent observability (Ignite 2026). They
 * are matched on the exact `settingName` returned by
 * `GET /v1/admin/tenantsettings`, never on the title; a name that is absent
 * from a snapshot stays Unknown.
 */
export const DATA_AGENT_TELEMETRY_SETTINGS = {
  observedAt: "",
  operational: [] as readonly string[],
  userContent: [] as readonly string[],
  crossGeo: [] as readonly string[],
};

export type TelemetryGuardrailId = "operational" | "userContent" | "crossGeo";

export const TELEMETRY_GUARDRAIL_LABEL: Record<TelemetryGuardrailId, string> = {
  operational: "Operational telemetry (agent and source names, step IDs)",
  userContent: "User-level telemetry (prompts, responses, generated SQL/DAX)",
  crossGeo: "Cross-geo processing and storage for AI",
};

export interface TelemetryGuardrail {
  id: TelemetryGuardrailId;
  label: string;
  state: "enabled" | "disabled" | "unknown";
  settingName?: string;
  title?: string;
  reason?: string;
}

type TenantSettingsData = Pick<AtlasData, "governanceEvidence">;

export function dataAgentTelemetryGuardrails(
  data: TenantSettingsData,
  names: Pick<typeof DATA_AGENT_TELEMETRY_SETTINGS, TelemetryGuardrailId> = DATA_AGENT_TELEMETRY_SETTINGS,
): TelemetryGuardrail[] {
  const section = data.governanceEvidence?.tenantSettings;
  return (["operational", "userContent", "crossGeo"] as const).map((id) => {
    const base = { id, label: TELEMETRY_GUARDRAIL_LABEL[id] };
    if (!section || section.status.status !== "complete") {
      return { ...base, state: "unknown", reason: "Tenant settings were not collected (needs a Fabric administrator sync)." };
    }
    const allowed = new Set(names[id]);
    const matches = section.entries.filter((entry) => allowed.has(entry.settingName));
    if (!matches.length) {
      return { ...base, state: "unknown", reason: allowed.size ? "The setting was not returned for this tenant." : "The setting name is not verified yet." };
    }
    const enabled = matches.find((entry) => entry.enabled);
    const setting = enabled ?? matches[0];
    return { ...base, state: enabled ? "enabled" : "disabled", settingName: setting.settingName, title: setting.title };
  });
}

/** Data agents whose configured sources carry a Confidential or stricter standard label. */
export function confidentialDataAgents(data: Pick<AtlasData, "items" | "itemMetadata">): { agent: Item; sources: Item[] }[] {
  const byId = new Map(data.items.map((item) => [item.fabricId, item]));
  return data.items.flatMap((agent) => {
    if (agent.itemType !== "DataAgent") return [];
    const metadata = data.itemMetadata?.[agent.fabricId];
    const sources = (metadata?.kind === "dataAgent" ? parseDataAgentMetadata(metadata)?.sources ?? [] : [])
      .map((source) => byId.get(source.artifactId))
      .filter((item): item is Item => !!item && (standardLabelRank(item.sensitivity) ?? -1) >= 2);
    return sources.length ? [{ agent, sources }] : [];
  });
}
