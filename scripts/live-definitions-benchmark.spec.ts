// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runLiveDefinitionBenchmark } from "../rayfin/functions/src/live-definition-benchmark";
import { publicContractFixture } from "./fixtures/bulk-definitions.fixture";

const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "fixture-only-token";
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json",
    "content-length": String(new TextEncoder().encode(text).byteLength), ...headers } });
}
function setup() {
  const fixture = publicContractFixture();
  const selected = [fixture.items[0], fixture.items[2], fixture.items[3]];
  const original = fixture.bulk[0].body as {
    itemDefinitionsIndex: { id: string; rootPath: string }[];
    definitionParts: { path: string; payload: string; payloadType: string }[];
  };
  const index = original.itemDefinitionsIndex.filter((entry) => selected.some((item) => item.id === entry.id));
  const body = {
    itemDefinitionsIndex: index,
    definitionParts: original.definitionParts.filter((part) => index.some((entry) => part.path.startsWith(`${entry.rootPath}/`))),
  };
  const overrides = new Map<string, () => Response>();
  let clock = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    clock += 10;
    expect(url.origin).toBe("https://api.fabric.microsoft.com");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(init?.headers).get("x-ms-fabric-skill")).toBe("deployment-pipelines-authoring-cli");
    const override = overrides.get(url.pathname);
    if (override) return override();
    if (url.pathname === "/v1/workspaces") return json({ value: [{ id: WS, displayName: "FGI-MAIN" }] });
    if (url.pathname === `/v1/workspaces/${WS}/items`) return json({
      value: fixture.items.map((item) => ({ ...item, displayName: "PRIVATE_CATALOG_LABEL", description: "PRIVATE_DESCRIPTION" })),
    });
    if (url.pathname.endsWith("/bulkExportDefinitions")) {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ mode: "Selective", items: selected.map(({ id }) => ({ id })) });
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return json(body);
    }
    const item = selected.find((candidate) => url.pathname.endsWith(`/${candidate.id}/getDefinition`));
    if (item) {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      expect(url.searchParams.get("format")).toBe(item.type === "SemanticModel" ? "TMSL" : null);
      return json(fixture.perItem[item.id][0].body);
    }
    throw new Error("Unexpected endpoint.");
  });
  const run = () => runLiveDefinitionBenchmark(TOKEN, "FGI-MAIN", true, {
    fetch, now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; },
  });
  return { run, fetch, fixture, selected, body, overrides };
}

describe("live authoring-identity definition benchmark", () => {
  it("uses one credential and bounded read actions, projects before reporting, measures real exchanges", async () => {
    const { run, fetch } = setup();
    const report = await run();
    expect(report.discovery.requests).toBe(2);
    expect(report.perItem.metrics.requests).toBe(3);
    expect(report.bulk.metrics.requests).toBe(3);
    expect(report.total.requests).toBe(fetch.mock.calls.length);
    expect(report.perItem.metrics.elapsedMs).toBe(30);
    expect(report.perItem.metrics.responseBytesConsumed).toBeGreaterThan(0);
    expect(report.bulk.metrics.requestBytes).toBeGreaterThan(0);
    expect(report.bulk.fallbackSucceeded).toBe(2);
    expect(report.bulk.directItems.map((item) => item.format)).toEqual(["GraphJSON", "PBIR", "TMDL"]);
    expect(report.parity).toEqual({
      direct: { matched: 1, mismatched: 0, unavailable: 2 },
      afterFallback: { matched: 3, mismatched: 0, unavailable: 0 },
    });
    expect(report.identity).toEqual({ sameCredentialForBothPaths: true, deployedAppIdentityTested: false });
    expect(report.deployedBulkGateEnabled).toBe(false);
    const output = JSON.stringify(report);
    expect(output).not.toMatch(/PRIVATE_|InlineBase64|definitionParts|nodeTypes|fixture-only-token/);
    expect(output).not.toContain(WS);
  });

  it("measures permission rejection and real per-item fallback without echoing errors", async () => {
    const { run, overrides } = setup();
    overrides.set(`/v1/workspaces/${WS}/items/bulkExportDefinitions`, () => json({ message: "PRIVATE_ERROR" }, 403));
    const report = await run();
    expect(report.bulk.operationFailure).toBe("authorization-failed");
    expect(report.bulk.metrics.requests).toBe(4);
    expect(report.bulk.metrics.httpStatuses["403"]).toBe(1);
    expect(report.bulk.fallbackSucceeded).toBe(3);
    expect(report.parity.afterFallback.matched).toBe(3);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_ERROR");
  });

  it("stops after a 429 without retries or fallback fan-out", async () => {
    const { run, overrides } = setup();
    overrides.set(`/v1/workspaces/${WS}/items/bulkExportDefinitions`, () => json({}, 429, { "retry-after": "60" }));
    const report = await run();
    expect(report.bulk.metrics.requests).toBe(1);
    expect(report.bulk.fallbackAttempted).toBe(0);
    expect(report.bulk.summary.notAttempted).toBe(3);
    expect(report.bulk.operationFailure).toBe("rate-limited");
  });

  it("counts LRO polls/results and sends the selection body only in the initial POST", async () => {
    const { run, overrides, body, fetch } = setup();
    overrides.set(`/v1/workspaces/${WS}/items/bulkExportDefinitions`, () => new Response(null, {
      status: 202, headers: { "x-ms-operation-id": OPERATION, "retry-after": "1" },
    }));
    overrides.set(`/v1/operations/${OPERATION}`, () => json({ status: "Succeeded" }));
    overrides.set(`/v1/operations/${OPERATION}/result`, () => json(body));
    const report = await run();
    expect(report.bulk.metrics.requests).toBe(5);
    expect(report.bulk.metrics.elapsedMs).toBeGreaterThanOrEqual(1_000);
    for (const [input, init] of fetch.mock.calls) {
      if (String(input).includes("/operations/")) {
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
      }
    }
  });

  it("rejects foreign LRO locations without sending credentials there", async () => {
    const { run, overrides, fetch } = setup();
    overrides.set(`/v1/workspaces/${WS}/items/bulkExportDefinitions`, () => new Response(null, {
      status: 202, headers: { location: `https://untrusted.invalid/v1/operations/${OPERATION}` },
    }));
    const report = await run();
    expect(report.bulk.operationFailure).toBe("invalid-response");
    expect(fetch.mock.calls.every(([input]) => String(input).startsWith("https://api.fabric.microsoft.com/"))).toBe(true);
  });

  it("keeps partial item failures and format differences visible after fallback", async () => {
    const { run, overrides, selected } = setup();
    overrides.set(`/v1/workspaces/${WS}/semanticModels/${selected[2].id}/getDefinition`, () => json({}, 403));
    const report = await run();
    expect(report.perItem.summary.failed).toBe(1);
    expect(report.bulk.summary.failed).toBe(1);
    expect(report.bulk.directItems[2]).toMatchObject({ format: "TMDL", code: "format-unsupported" });
    expect(report.parity.afterFallback.unavailable).toBe(1);
  });

  it("stops both paths when an LRO wait cannot fit in the shared deadline", async () => {
    const { run, overrides, selected } = setup();
    overrides.set(`/v1/workspaces/${WS}/graphModels/${selected[0].id}/getDefinition`, () => new Response(null, {
      status: 202, headers: { "x-ms-operation-id": OPERATION, "retry-after": "30" },
    }));
    overrides.set(`/v1/operations/${OPERATION}`, () => json({ status: "Running" }, 200, { "retry-after": "30" }));
    const report = await run();
    expect(report.perItem.items[0].code).toBe("deadline-exhausted");
    expect(report.perItem.summary.notAttempted).toBe(2);
    expect(report.bulk.metrics.requests).toBe(0);
    expect(report.bulk.fallbackAttempted).toBe(0);
    expect(report.total.elapsedMs).toBeLessThan(120_000);
    expect(report.total.requests).toBeLessThanOrEqual(40);
  });

  it("enforces the response-size cap before accepting a definition", async () => {
    const { run, overrides, selected } = setup();
    overrides.set(`/v1/workspaces/${WS}/graphModels/${selected[0].id}/getDefinition`, () =>
      new Response("{}", { headers: { "content-length": String(5 * 1024 * 1024) } }));
    const report = await run();
    expect(report.perItem.items[0].code).toBe("response-size-exceeded");
    expect(report.perItem.items[0].status).toBe("failed");
    expect(report.parity.direct.unavailable).toBeGreaterThan(0);
  });

  it("refuses ambiguous discovery and non-boolean authorization before definition reads", async () => {
    const { run, overrides, fetch } = setup();
    overrides.set("/v1/workspaces", () => json({ value: [{ id: WS, displayName: "FGI-MAIN" }, { id: WS, displayName: "FGI-MAIN" }] }));
    await expect(run()).rejects.toThrow("workspace-not-uniquely-resolved");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(runLiveDefinitionBenchmark(TOKEN, "FGI-MAIN", "yes" as never, { fetch })).rejects.toThrow("invalid-benchmark-input");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
