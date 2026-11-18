import { describe, expect, it } from "vitest";
import { criticalFindingKey, parseGovernanceSummary, summarizeGovernance } from "./domain-governance";
import type { GovernanceFinding } from "./governance";
import { SAMPLE_DATA } from "./model";
import { buildNewCriticalCard, buildSyncBriefCard, newCriticalFindings, TEAMS_CARD_MAX_BYTES } from "./teams-notify";
import type { SyncBrief } from "./sync-brief";
import { parseTeamsCard, postTeamsCard, TEAMS_CARD_MAX_BYTES as FUNCTION_CARD_MAX_BYTES, validWebhookUrl } from "../../rayfin/functions/src/teams-notify";

const finding = (id: string, severity: GovernanceFinding["severity"] = "critical"): GovernanceFinding => ({
  id, severity, category: "access", title: `Finding ${id}`, detail: "", recommendation: "", evidenceIds: [],
});

describe("Teams notification for new critical findings", () => {
  it("only reports critical findings absent from the previous snapshot", () => {
    const previous = JSON.stringify({ ...summarizeGovernance(SAMPLE_DATA), critical: [criticalFindingKey("old")] });
    const fresh = newCriticalFindings([finding("old"), finding("new"), finding("hi", "high")], previous);
    expect(fresh.map((entry) => entry.id)).toEqual(["new"]);
  });

  it("never notifies without a previous summary (first sync)", () => {
    expect(newCriticalFindings([finding("new")], undefined)).toEqual([]);
  });

  it("stores and parses critical keys in the persisted governance summary", () => {
    const summary = summarizeGovernance(SAMPLE_DATA);
    const parsed = parseGovernanceSummary(JSON.stringify(summary));
    expect(parsed?.critical ?? []).toEqual(summary.critical ?? []);
    expect(JSON.stringify(summary).length).toBeLessThan(4000);
  });

  it("builds a single card listing the new critical findings", () => {
    const card = buildNewCriticalCard(SAMPLE_DATA, [finding("a"), finding("b")]);
    expect(card.type).toBe("AdaptiveCard");
    expect(JSON.stringify(card.body)).toContain("2 new critical findings since the previous sync");
    expect(card.body[2]).toMatchObject({ text: "Open findings: 2 (2 critical)" });
    expect(JSON.stringify(card.body)).not.toContain("Governance posture");
    expect(card.body.filter((block) => block.text?.includes("**CRITICAL**"))).toHaveLength(2);
  });
});

describe("teamsNotify function", () => {
  const card = JSON.stringify({ type: "AdaptiveCard", version: "1.5", body: [] });

  it("reports not-configured without a secret and never calls out", async () => {
    let called = false;
    const result = await postTeamsCard(undefined, card, (async () => { called = true; return new Response(); }) as typeof fetch);
    expect(result).toEqual({ status: "not-configured" });
    expect(called).toBe(false);
  });

  it("accepts only https webhooks and adaptive cards", () => {
    expect(validWebhookUrl("http://example.test/hook")).toBeUndefined();
    expect(validWebhookUrl("https://user:pw@example.test/hook")).toBeUndefined();
    expect(validWebhookUrl("https://example.test/hook")?.hostname).toBe("example.test");
    expect(parseTeamsCard(JSON.stringify({ type: "Other" }))).toBeUndefined();
    expect(parseTeamsCard("x".repeat(30_000))).toBeUndefined();
  });

  it("posts the card as a Teams message attachment and hides the URL from the result", async () => {
    let body = "";
    const result = await postTeamsCard("https://example.test/hook", card, (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(null, { status: 202 });
    }) as typeof fetch);
    expect(result).toEqual({ status: "sent", httpStatus: 202 });
    expect(JSON.parse(body).attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(JSON.stringify(result)).not.toContain("example.test");
  });
});

describe("Sync Brief Teams card", () => {
  const brief = (entries: number): SyncBrief => ({
    state: entries ? "changes" : "no-changes",
    previousSyncedAt: "2026-11-17T08:00:00Z",
    currentSyncedAt: "2026-11-18T08:00:00Z",
    sections: [
      {
        id: "items",
        title: "Items added or removed",
        status: "available",
        entries: Array.from({ length: entries }, (_, index) => ({
          id: `i${index}`,
          title: `Item ${index} ${"x".repeat(200)}`,
          detail: "Added ".repeat(80),
        })),
      },
      { id: "schema", title: "Measures and schema objects changed", status: "unavailable", reason: "Not collected", entries: [] },
    ],
    totalEntries: entries,
    preExistingHighFindings: 3,
    tenantSettings: "unavailable",
  });

  it("matches the Function payload cap", () => {
    expect(TEAMS_CARD_MAX_BYTES).toBe(FUNCTION_CARD_MAX_BYTES);
  });

  it("renders unavailable sections as Unavailable, never zero", () => {
    const card = buildSyncBriefCard(brief(2), "Sales", "https://atlas.example/?tab=governance");
    const facts = (card.body.find((block) => block.type === "FactSet") as { facts: { title: string; value: string }[] }).facts;
    expect(facts).toContainEqual({ title: "Measures and schema objects changed", value: "Unavailable" });
    expect(facts).toContainEqual({ title: "Items added or removed", value: "2" });
    expect(facts).toContainEqual({ title: "Tenant settings drift", value: "Unavailable" });
    expect(card.version).toBe("1.5");
    expect(card.actions?.[0]).toMatchObject({ type: "Action.OpenUrl", url: "https://atlas.example/?tab=governance" });
    expect(parseTeamsCard(JSON.stringify(card))).toBeTruthy();
  });

  it("stays under the cap and truncates deterministically for large diffs", () => {
    const card = buildSyncBriefCard(brief(5000), "Sales");
    const json = JSON.stringify(card);
    expect(new TextEncoder().encode(json).length).toBeLessThan(TEAMS_CARD_MAX_BYTES);
    expect(json).toContain("+4995 more in Fabric Atlas");
    expect(JSON.stringify(buildSyncBriefCard(brief(5000), "Sales"))).toBe(json);
  });

  it("states that nothing changed", () => {
    expect(JSON.stringify(buildSyncBriefCard(brief(0), "Sales"))).toContain("no monitored changes");
  });
});
