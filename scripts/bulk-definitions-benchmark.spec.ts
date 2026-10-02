// @vitest-environment node
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  benchmarkDefinitions, BULK_BENCHMARK_LIMITS, BULK_DEFINITION_RUNTIME_GATE,
  splitBulkDefinitions, validateBenchmarkFixture,
} from "../rayfin/functions/src/bulk-definition-benchmark";
import { publicContractFixture } from "./fixtures/bulk-definitions.fixture";

function sample() {
  const fixture = publicContractFixture();
  const body = fixture.bulk[0].body as {
    itemDefinitionsIndex: { id: string; rootPath: string }[];
    definitionParts: { path: string; payload: string; payloadType: string }[];
  };
  return { fixture, body };
}
afterEach(() => vi.restoreAllMocks());

describe("bulk definition replay boundary", () => {
  it("uses existing projections, isolates fallback and reports only metrics/evidence", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network permitted."));
    const result = benchmarkDefinitions(publicContractFixture());
    expect(BULK_DEFINITION_RUNTIME_GATE.enabled).toBe(false);
    expect(result.measurement.networkRequests).toBe(0);
    expect(result.measurement.networkDurationMs).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.perItem.metrics).toMatchObject({ requests: 4, failedItems: 0, fallbackAttempted: 0 });
    expect(result.bulk.metrics).toMatchObject({
      requests: 3, failedItems: 0, projectionFailures: 2,
      fallbackRequested: 2, fallbackAttempted: 2, fallbackSucceeded: 2,
    });
    expect(result.bulk.items.map((item) => item.source)).toEqual(["bulk", "bulk", "fallback", "fallback"]);
    expect(result.bulk.items.slice(2).map((item) => item.fallbackReason))
      .toEqual(["report-by-path-unsupported", "format-unsupported"]);
    expect(result.parity).toEqual({ matched: 4, mismatched: 0, unavailable: 0 });
    expect(result.bulk.metrics.projectedBytes).toBe(result.perItem.metrics.projectedBytes);
    expect(result.bulk.metrics.responseBytes).toBeGreaterThan(result.bulk.metrics.projectedBytes);
    expect(result.bulk.metrics.requestBytes).toBeGreaterThan(0);
    expect(result.bulk.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/definitionParts|InlineBase64|graphType\.json|nodeTypes|model\.bim/);
  });

  it("uses the same per-item fallback after whole-operation permission failure", () => {
    const { fixture } = sample();
    fixture.bulk = [{ status: 403, body: { message: "PRIVATE_ERROR_SENTINEL" } }];
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.metrics).toMatchObject({ requests: 5, requestFailures: 1, fallbackSucceeded: 4 });
    expect(result.parity.matched).toBe(4);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR_SENTINEL");
  });

  it("does not request bulk for types without reviewed bulk support", () => {
    const { fixture } = sample();
    const id = fixture.items[0].id;
    fixture.items = [{ id, type: "Ontology" }];
    fixture.perItem = {
      [id]: [{
        status: 200, body: { definition: { parts: [{
          path: ".platform", payload: "e30=", payloadType: "InlineBase64",
        }] } },
      }],
    };
    fixture.bulk = [{ status: 403 }];
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.metrics).toMatchObject({ requests: 1, requestFailures: 0, fallbackSucceeded: 1 });
    expect(result.bulk.items[0].fallbackReason).toBe("bulk-type-not-reviewed");
  });

  it("does not fan out after throttling", () => {
    const { fixture } = sample();
    fixture.bulk = [{ status: 429 }];
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.metrics).toMatchObject({ requests: 1, fallbackRequested: 4, fallbackAttempted: 0, failedItems: 4 });
    expect(result.bulk.items.every((item) => item.status === "not-attempted" && item.code === "rate-limited")).toBe(true);
  });

  it("falls back only for a missing item and independent format failures", () => {
    const { fixture, body } = sample();
    const missing = body.itemDefinitionsIndex.shift()!;
    body.definitionParts = body.definitionParts.filter((part) => !part.path.startsWith(`${missing.rootPath}/`));
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.metrics.fallbackAttempted).toBe(3);
    expect(result.bulk.items[0].fallbackReason).toBe("missing-bulk-item");
    expect(result.bulk.items[1].source).toBe("bulk");
    expect(result.parity.matched).toBe(4);
  });

  it("counts initial, poll and result requests rather than treating LRO as one call", () => {
    const { fixture } = sample();
    fixture.bulk = [
      { status: 202 }, { status: 200, body: { status: "Running" } },
      { status: 200, body: { status: "Succeeded" } }, ...fixture.bulk,
    ];
    expect(benchmarkDefinitions(fixture).bulk.metrics.requests).toBe(6);
  });

  it("bounds LRO polling and falls back after operation failure", () => {
    const { fixture } = sample();
    fixture.bulk = [{ status: 202 }, { status: 200, body: { status: "Failed", error: "PRIVATE" } }];
    const failed = benchmarkDefinitions(fixture);
    expect(failed.bulk.metrics).toMatchObject({ requests: 6, fallbackSucceeded: 4 });
    expect(failed.bulk.items[0].fallbackReason).toBe("operation-failed");
    fixture.bulk = [{ status: 202 }, ...Array.from({ length: 12 }, () => ({ status: 200, body: { status: "Running" } }))];
    expect(benchmarkDefinitions(fixture).bulk.items[0].fallbackReason).toBe("operation-incomplete");
  });

  it("never exceeds a shared request ceiling including fallback", () => {
    const result = benchmarkDefinitions(publicContractFixture(), { mode: "fixture-replay", maxRequests: 1 });
    expect(result.perItem.metrics.requests).toBe(1);
    expect(result.bulk.metrics.requests).toBe(1);
    expect(result.bulk.metrics.fallbackAttempted).toBe(0);
    expect(result.bulk.items[2].code).toBe("request-budget-exhausted");
    for (const maxRequests of [0, 65, 1.5, NaN]) {
      expect(() => benchmarkDefinitions(publicContractFixture(), { mode: "fixture-replay", maxRequests })).toThrow();
    }
  });

  it("keeps fallback failure visible instead of reporting a successful bulk snapshot", () => {
    const { fixture } = sample();
    fixture.bulk = [{ status: 404 }];
    fixture.perItem[fixture.items[0].id] = [{ status: 403 }];
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.metrics).toMatchObject({ failedItems: 1, fallbackSucceeded: 3 });
    expect(result.parity).toEqual({ matched: 3, mismatched: 0, unavailable: 1 });
  });

  it("detects projection differences even if both paths succeed", () => {
    const { fixture, body } = sample();
    const graph = body.definitionParts.find((part) => part.path === "/GraphA.GraphModel/graphType.json")!;
    graph.payload = Buffer.from(JSON.stringify({ nodeTypes: [], edgeTypes: [] })).toString("base64");
    expect(benchmarkDefinitions(fixture).parity).toEqual({ matched: 3, mismatched: 1, unavailable: 0 });
  });

  it("does not retain unexpected content from parts or error messages", () => {
    const { fixture, body } = sample();
    const part = body.definitionParts.find((value) => value.path.endsWith("/graphDefinition.json"))!;
    part.payload = Buffer.from(JSON.stringify({
      nodeTables: [], edgeTables: [], queries: ["PRIVATE_QUERY"], instructions: "PRIVATE_INSTRUCTIONS",
      rows: [{ value: "PRIVATE_BUSINESS_VALUE" }],
    })).toString("base64");
    expect(JSON.stringify(benchmarkDefinitions(fixture))).not.toMatch(/PRIVATE_/);
  });

  it("rejects malformed Base64 and requires complete graph parts before accepting projection", () => {
    const { fixture, body } = sample();
    body.definitionParts.find((part) => part.path === "/GraphA.GraphModel/graphType.json")!.payload = "!invalid!";
    expect(benchmarkDefinitions(fixture).bulk.items[0].fallbackReason).toBe("invalid-definition");
    body.definitionParts = body.definitionParts.filter((part) => part.path !== "/GraphA.GraphModel/graphType.json");
    expect(benchmarkDefinitions(fixture).bulk.items[0].fallbackReason).toBe("projection-incomplete");
  });

  it("does not accept a caller-provided live mode or persist callback", () => {
    expect(() => benchmarkDefinitions(publicContractFixture(), { mode: "live" } as never)).toThrow();
    expect(() => benchmarkDefinitions(publicContractFixture(), { mode: "fixture-replay", persist: () => {} } as never)).toThrow();
  });
});

describe("strict bulk index and fixture validation", () => {
  it.each(["/../Graph", "/Graph/.", "/Graph//Child", "/Graph\\Child", "/Graph%2fChild", "/Graph?secret", "/Graph/", "relative", "/Graph\nChild"])(
    "rejects ambiguous root %j", (rootPath) => {
      const { fixture, body } = sample();
      body.itemDefinitionsIndex[0].rootPath = rootPath;
      expect(() => splitBulkDefinitions(body, fixture.items)).toThrow();
    },
  );

  it("rejects duplicate IDs, overlapping roots, unrequested IDs and foreign parts", () => {
    const changes = [
      (body: ReturnType<typeof sample>["body"]) => { body.itemDefinitionsIndex[1].id = body.itemDefinitionsIndex[0].id; },
      (body: ReturnType<typeof sample>["body"]) => { body.itemDefinitionsIndex[1].rootPath = "/GraphA.GraphModel/Child"; },
      (body: ReturnType<typeof sample>["body"]) => { body.itemDefinitionsIndex[1].rootPath = "/grapha.graphmodel"; },
      (body: ReturnType<typeof sample>["body"]) => { body.itemDefinitionsIndex[0].id = "99999999-9999-4999-8999-999999999999"; },
      (body: ReturnType<typeof sample>["body"]) => { body.definitionParts[0].path = "/GraphA.GraphModelOther/.platform"; },
      (body: ReturnType<typeof sample>["body"]) => { body.definitionParts.push({ ...body.definitionParts[0] }); },
    ];
    for (const change of changes) {
      const { fixture, body } = sample();
      change(body);
      expect(() => splitBulkDefinitions(body, fixture.items)).toThrow();
    }
  });

  it("rejects unbounded or noncanonical fixture inputs", () => {
    const invalid = [
      { ...publicContractFixture(), token: "NEVER_ACCEPT" },
      { ...publicContractFixture(), version: 2 },
      { ...publicContractFixture(), items: [] },
      { ...publicContractFixture(), items: Array(9).fill(publicContractFixture().items[0]) },
      { ...publicContractFixture(), items: [publicContractFixture().items[0], publicContractFixture().items[0]] },
      { ...publicContractFixture(), items: [{ id: "../escape", type: "GraphModel" }] },
      { ...publicContractFixture(), items: [{ id: publicContractFixture().items[0].id, type: "Notebook" }] },
      { ...publicContractFixture(), bulk: Array(15).fill({ status: 200 }) },
    ];
    for (const fixture of invalid) expect(() => validateBenchmarkFixture(fixture)).toThrow();
  });

  it("bounds response bytes and does not serialize oversized content", () => {
    const { fixture } = sample();
    fixture.bulk = [{ status: 200, body: { content: "X".repeat(BULK_BENCHMARK_LIMITS.maxResponseBytes) } }];
    const result = benchmarkDefinitions(fixture);
    expect(result.bulk.items[0].fallbackReason).toBe("response-size-exceeded");
    expect(result.bulk.metrics.fallbackSucceeded).toBe(4);
    expect(JSON.stringify(result).length).toBeLessThan(15_000);
  });
});
