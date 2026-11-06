import { describe, expect, it } from "vitest";
import {
  createScoutClient,
  extractAnswer,
  extractEvidence,
  isScoutConfigured,
  scoutBaseUrl,
  ScoutError,
} from "./scout";
import { classifyScoutCell, parseScoutInline, parseScoutMarkdown, tokenizeSql } from "./scout-markdown";

const endpoint = {
  workspaceId: "6bf4c521-7412-4e6b-8867-68253bbfb18a",
  agentId: "e468903e-a1dc-4132-9a36-4559dc258502",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Atlas Scout configuration", () => {
  it("requires GUID workspace and agent ids", () => {
    expect(isScoutConfigured(endpoint)).toBe(true);
    expect(isScoutConfigured({ workspaceId: endpoint.workspaceId, agentId: "" })).toBe(false);
    expect(() => scoutBaseUrl({ workspaceId: "x", agentId: "y" })).toThrow(ScoutError);
    expect(scoutBaseUrl(endpoint)).toBe(
      `https://api.fabric.microsoft.com/v1/workspaces/${endpoint.workspaceId}/dataagents/${endpoint.agentId}/aiassistant/openai`,
    );
  });
});

describe("Atlas Scout response parsing", () => {
  it("reads the latest assistant message", () => {
    expect(
      extractAnswer({
        data: [
          { role: "assistant", content: [{ type: "text", text: { value: "Latest" } }] },
          { role: "user", content: [{ type: "text", text: { value: "Q" } }] },
          { role: "assistant", content: [{ type: "text", text: { value: "Older" } }] },
        ],
      }),
    ).toBe("Latest");
  });

  it("collects SQL and result tables in execution order without duplicates", () => {
    const evidence = extractEvidence({
      data: [
        { step_details: { tool_calls: [{ function: { name: "analyze.database.execute", output: "| b |\n|---|\n| 2 |" } }] } },
        { step_details: { tool_calls: [{ function: { name: "analyze.database.nl2code", output: "# Variation 1\n```sql\nSELECT 2\n```" } }] } },
        { step_details: { tool_calls: [{ function: { name: "analyze.database.fewshots.matching", output: null } }] } },
        { step_details: { tool_calls: [{ function: { name: "analyze.database.nl2code", output: "```sql\nSELECT 1\n```\n```sql\nSELECT 2\n```" } }] } },
      ],
    });
    expect(evidence.sql).toEqual(["SELECT 1", "SELECT 2"]);
    expect(evidence.results).toEqual(["| b |\n|---|\n| 2 |"]);
  });
});

describe("Atlas Scout client", () => {
  it("runs the assistant flow and reuses the thread", async () => {
    const calls: string[] = [];
    let polls = 0;
    const client = createScoutClient({
      endpoint,
      getToken: async () => "token",
      wait: async () => undefined,
      fetch: async (url, init) => {
        const path = new URL(url).pathname.split("/openai")[1];
        calls.push(`${init?.method} ${path}`);
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token");
        if (path === "/assistants") return json({ id: "asst" });
        if (path === "/threads") return json({ id: "t1" });
        if (path === "/threads/t1/messages" && init?.method === "POST") return json({ id: "m" });
        if (path === "/threads/t1/runs") return json({ id: "r1", status: "queued" });
        if (path === "/threads/t1/runs/r1") return json({ status: ++polls < 3 ? "in_progress" : "completed" });
        if (path === "/threads/t1/messages") {
          expect(new URL(url).searchParams.get("order")).toBe("desc");
          return json({ data: [{ role: "assistant", content: [{ text: { value: "**3** items" } }] }] });
        }
        if (path === "/threads/t1/runs/r1/steps") return json({ data: [] });
        throw new Error(`unexpected ${path}`);
      },
    });

    const phases: string[] = [];
    const first = await client.ask("How many items?", undefined, undefined, (phase) => phases.push(phase));
    expect(phases).toEqual(["connecting", "thinking", "querying", "writing"]);
    expect(first).toEqual({ threadId: "t1", text: "**3** items", evidence: { sql: [], results: [] } });
    polls = 0;
    await client.ask("And failing?", first.threadId);
    expect(calls.filter((call) => call === "POST /assistants")).toHaveLength(1);
    expect(calls.filter((call) => call === "POST /threads")).toHaveLength(1);
  });

  it("surfaces failed runs and access errors clearly", async () => {
    const failing = createScoutClient({
      endpoint,
      getToken: async () => "token",
      wait: async () => undefined,
      fetch: async (url) => {
        const path = new URL(url).pathname.split("/openai")[1];
        if (path === "/assistants") return json({ id: "asst" });
        if (path === "/threads") return json({ id: "t1" });
        if (path === "/threads/t1/runs") return json({ id: "r1", status: "failed", last_error: null });
        return json({});
      },
    });
    await expect(failing.ask("Q")).rejects.toThrow("Atlas Scout run failed.");

    const forbidden = createScoutClient({
      endpoint,
      getToken: async () => "token",
      fetch: async () => new Response("denied", { status: 403 }),
    });
    await expect(forbidden.ask("Q")).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/access/) });
  });
});

describe("Atlas Scout markdown", () => {
  it("parses headings, lists, tables and code blocks", () => {
    const blocks = parseScoutMarkdown(
      "## Scorecard\nTwo workspaces.\n\n| Workspace | Score |\n|---|---:|\n| Sales | 82 |\n\n1. Fix labels\n2. Add owners\n\n```sql\nSELECT 1\n```",
    );
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Scorecard" },
      { kind: "paragraph", text: "Two workspaces." },
      { kind: "table", header: ["Workspace", "Score"], rows: [["Sales", "82"]] },
      { kind: "list", ordered: true, items: ["Fix labels", "Add owners"] },
      { kind: "code", language: "sql", text: "SELECT 1" },
    ]);
  });

  it("keeps markup as plain text segments", () => {
    expect(parseScoutInline("<b>x</b> **bold** and `code`")).toEqual([
      { kind: "text", text: "<b>x</b> " },
      { kind: "strong", text: "bold" },
      { kind: "text", text: " and " },
      { kind: "code", text: "code" },
    ]);
  });
});

describe("Atlas Scout rich rendering helpers", () => {
  it("classifies percentages, statuses and numbers", () => {
    expect(classifyScoutCell("82%")).toEqual({ kind: "percent", value: 82, text: "82%" });
    expect(classifyScoutCell("140 %")).toMatchObject({ kind: "percent", value: 100 });
    expect(classifyScoutCell("**Failed**")).toEqual({ kind: "status", tone: "failing", text: "Failed" });
    expect(classifyScoutCell("Certified")).toMatchObject({ kind: "status", tone: "healthy" });
    expect(classifyScoutCell("1,204")).toEqual({ kind: "number", text: "1,204" });
    expect(classifyScoutCell("Sales Lakehouse")).toEqual({ kind: "text", text: "Sales Lakehouse" });
  });

  it("tokenizes SQL keywords, strings and numbers", () => {
    expect(tokenizeSql("SELECT TOP 5 name FROM items WHERE state = 'Failed'")).toEqual([
      { kind: "keyword", text: "SELECT" },
      { kind: "text", text: " " },
      { kind: "keyword", text: "TOP" },
      { kind: "text", text: " " },
      { kind: "number", text: "5" },
      { kind: "text", text: " name " },
      { kind: "keyword", text: "FROM" },
      { kind: "text", text: " items " },
      { kind: "keyword", text: "WHERE" },
      { kind: "text", text: " state = " },
      { kind: "string", text: "'Failed'" },
    ]);
  });
});