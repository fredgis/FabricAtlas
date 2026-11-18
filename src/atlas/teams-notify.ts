import { buildTeamsFindingBlocks } from "./governance-share";
import { criticalFindingKey, parseGovernanceSummary } from "./domain-governance";
import type { GovernanceFinding } from "./governance";
import type { AtlasData } from "./model";
import type { SyncBrief } from "./sync-brief";

export type TeamsNotifyStatus = "sent" | "not-configured" | "invalid-card" | "invalid-webhook" | "failed";
export interface TeamsNotifyResult {
  status: TeamsNotifyStatus;
  httpStatus?: number;
}

export const TEAMS_NOTIFY_STATUS_LABEL: Record<TeamsNotifyStatus, string> = {
  sent: "Test card sent to Teams.",
  "not-configured": "Teams webhook not configured. Set the ATLAS_TEAMS_WEBHOOK_URL secret.",
  "invalid-card": "The card was rejected before sending.",
  "invalid-webhook": "The configured webhook is not a valid https URL.",
  failed: "Teams did not accept the card.",
};

/** Mirrors the server-side cap enforced by the teamsNotify Function. */
export const TEAMS_CARD_MAX_BYTES = 28_000;
const SYNC_BRIEF_CARD_TARGET_BYTES = 24_000;
const SYNC_BRIEF_ENTRY_LIMITS = [5, 3, 2, 1, 0];
const SYNC_BRIEF_TEXT_LIMIT = 160;

export const TEAMS_SYNC_BRIEF_STATUS_LABEL: Record<TeamsNotifyStatus, string> = {
  ...TEAMS_NOTIFY_STATUS_LABEL,
  sent: "Sync Brief sent to Teams.",
};

function clip(value: string, limit = SYNC_BRIEF_TEXT_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function cardBytes(card: object): number {
  return new TextEncoder().encode(JSON.stringify(card)).length;
}

/**
 * Adaptive Card 1.5 digest of a comparable Sync Brief. Unavailable sections
 * say so explicitly instead of reporting zero; entry lists shrink
 * deterministically until the serialized card fits under the Function cap.
 */
export function buildSyncBriefCard(brief: SyncBrief, workspaceName: string, appUrl?: string) {
  const span = [brief.previousSyncedAt, brief.currentSyncedAt]
    .map((value) => (value ? value.slice(0, 16).replace("T", " ") : "unknown"))
    .join(" → ");
  const build = (limit: number) => ({
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      { type: "TextBlock", text: `Fabric Atlas · ${clip(workspaceName, 80)}`, weight: "Bolder", size: "Medium", wrap: true },
      {
        type: "TextBlock",
        text: brief.state === "no-changes" ? "Sync Brief: no monitored changes" : `Sync Brief: ${brief.totalEntries} change${brief.totalEntries === 1 ? "" : "s"}`,
        color: brief.state === "no-changes" ? "Good" : "Accent",
        wrap: true,
      },
      { type: "TextBlock", text: `Snapshots ${span} UTC`, isSubtle: true, size: "Small", wrap: true },
      {
        type: "FactSet",
        facts: [
          ...brief.sections.map((section) => ({
            title: section.title,
            value: section.status === "unavailable" ? "Unavailable" : String(section.entries.length),
          })),
          { title: "Pre-existing high-priority findings", value: String(brief.preExistingHighFindings) },
          { title: "Tenant settings drift", value: brief.tenantSettings === "comparable" ? "Compared" : "Unavailable" },
        ],
      },
      ...brief.sections.flatMap((section) => {
        if (section.status !== "available" || section.entries.length === 0 || limit === 0) return [];
        const shown = section.entries.slice(0, limit);
        const hidden = section.entries.length - shown.length;
        return [
          { type: "TextBlock", text: section.title, weight: "Bolder", spacing: "Medium", wrap: true },
          ...shown.map((entry) => ({ type: "TextBlock", text: `• ${clip(entry.title, 80)} — ${clip(entry.detail)}`, spacing: "None", wrap: true })),
          ...(hidden > 0 ? [{ type: "TextBlock", text: `+${hidden} more in Fabric Atlas`, isSubtle: true, size: "Small", spacing: "None", wrap: true }] : []),
        ];
      }),
    ],
    ...(appUrl ? { actions: [{ type: "Action.OpenUrl", title: "Open Changes in Fabric Atlas", url: appUrl }] } : {}),
  });
  for (const limit of SYNC_BRIEF_ENTRY_LIMITS) {
    const card = build(limit);
    if (cardBytes(card) <= SYNC_BRIEF_CARD_TARGET_BYTES) return card;
  }
  return build(0);
}

/**
 * Critical findings absent from the previous snapshot. Without a previous
 * summary (first sync or summary not yet stored) nothing is considered new,
 * so a fresh deployment never floods the channel.
 */
export function newCriticalFindings(
  findings: readonly GovernanceFinding[],
  previousSummaryJson: unknown,
): GovernanceFinding[] {
  const previous = parseGovernanceSummary(previousSummaryJson);
  if (!previous) return [];
  const known = new Set(previous.critical ?? []);
  return findings.filter((finding) => finding.severity === "critical" && !known.has(criticalFindingKey(finding.id)));
}

export function buildNewCriticalCard(
  data: Pick<AtlasData, "workspace" | "items">,
  findings: readonly GovernanceFinding[],
  appUrl?: string,
) {
  const workspaceName = data.workspace.displayName;
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: `Fabric Atlas · ${workspaceName}`,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: `${findings.length} new critical finding${findings.length === 1 ? "" : "s"} since the previous sync`,
        color: "Attention",
        wrap: true,
      },
      ...buildTeamsFindingBlocks(findings, data),
    ],
    ...(appUrl ? { actions: [{ type: "Action.OpenUrl", title: "Open Fabric Atlas", url: appUrl }] } : {}),
  };
}

export function buildTestCard(workspaceName: string) {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      { type: "TextBlock", text: `Fabric Atlas · ${workspaceName}`, weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: "Test notification: the Teams webhook is connected.", wrap: true },
    ],
  };
}

export async function invokeTeamsNotify(card: object): Promise<TeamsNotifyResult> {
  const { getRayfinClient } = await import("@/lib/rayfin-client");
  const client = getRayfinClient() as unknown as {
    functions: {
      teamsNotify: {
        invoke(input: { protocolVersion: 1; cardJson: string }, options: { timeoutMs: number }): Promise<TeamsNotifyResult>;
      };
    };
  };
  const result = await client.functions.teamsNotify.invoke(
    { protocolVersion: 1, cardJson: JSON.stringify(card) },
    { timeoutMs: 30_000 },
  );
  if (
    !result ||
    typeof result.status !== "string" ||
    !Object.hasOwn(TEAMS_NOTIFY_STATUS_LABEL, result.status)
  ) throw new Error("Invalid Teams notification response.");
  return result;
}
