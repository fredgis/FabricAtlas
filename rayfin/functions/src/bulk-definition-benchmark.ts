import {
  DefinitionProjectionError,
  projectDefinition,
} from "./definition-projections.js";
import {
  PowerBiProjectionError,
  projectReport,
  projectSemanticModel,
} from "./powerbi-projections.js";
import { strictUuid } from "./sync/protocol.js";

// Deliberately not registered in function_app.ts or connected to snapshot publication.
export const BULK_DEFINITION_RUNTIME_GATE = {
  enabled: false,
  mode: "fixture-replay-only",
  reason: "Bulk identity, format and projection parity require a tenant canary.",
} as const;

export const BULK_BENCHMARK_LIMITS = {
  maxItems: 8,
  maxParts: 4_096,
  maxPathLength: 512,
  maxFixtureBytes: 8 * 1024 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxTotalResponseBytes: 16 * 1024 * 1024,
  maxProjectionBytes: 4 * 1024 * 1024,
  maxRequests: 64,
  maxPolls: 12,
  maxReplayMs: 10_000,
} as const;

type ItemType = "GraphModel" | "Ontology" | "DataAgent" | "Report" | "SemanticModel";
const BULK_REVIEWED_TYPES: ReadonlySet<ItemType> = new Set(["GraphModel", "Report", "SemanticModel"]);
export type BenchmarkItem = { id: string; type: ItemType };
export type ReplayExchange = { status: number; body?: unknown };
export type DefinitionBenchmarkFixture = {
  version: 1;
  items: BenchmarkItem[];
  bulk: ReplayExchange[];
  perItem: Record<string, ReplayExchange[]>;
};
type Part = { path: string; payload: string; payloadType: "InlineBase64" };
type Code =
  | "invalid-fixture" | "invalid-bulk-response" | "invalid-definition"
  | "missing-bulk-item" | "bulk-type-not-reviewed" | "format-unsupported"
  | "report-by-path-unsupported" | "projection-incomplete"
  | "unsafe-content-rejected" | "projection-limit-exceeded"
  | "read-write-permission-required" | "endpoint-unsupported"
  | "encrypted-label-blocked" | "rate-limited" | "upstream-failure"
  | "operation-failed" | "operation-incomplete"
  | "response-size-exceeded" | "request-budget-exhausted" | "deadline-exhausted";

class ReplayError extends Error {
  constructor(readonly code: Code) {
    super(`Definition benchmark failed (${code}).`);
  }
}

function fail(code: Code): never { throw new ReplayError(code); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid-fixture");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("invalid-fixture");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail("invalid-fixture");
}
function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}
function safeCode(error: unknown): Code {
  if (error instanceof ReplayError || error instanceof DefinitionProjectionError ||
      error instanceof PowerBiProjectionError) {
    return error.code === "definition-part-missing" ? "invalid-definition" : error.code;
  }
  return "invalid-definition";
}
function validateItems(value: unknown): BenchmarkItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > BULK_BENCHMARK_LIMITS.maxItems) {
    return fail("invalid-fixture");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = record(entry);
    exactKeys(item, ["id", "type"]);
    let id: string;
    try { id = strictUuid(item.id); } catch { return fail("invalid-fixture"); }
    if (seen.has(id) || typeof item.type !== "string" ||
        !["GraphModel", "Ontology", "DataAgent", "Report", "SemanticModel"].includes(item.type)) {
      return fail("invalid-fixture");
    }
    seen.add(id);
    return { id, type: item.type as ItemType };
  });
}
function tape(value: unknown): ReplayExchange[] {
  if (!Array.isArray(value) || !value.length || value.length > BULK_BENCHMARK_LIMITS.maxPolls + 2) {
    return fail("invalid-fixture");
  }
  return value.map((entry) => {
    const exchange = record(entry);
    exactKeys(exchange, Object.hasOwn(exchange, "body") ? ["status", "body"] : ["status"]);
    if (!Number.isInteger(exchange.status) || Number(exchange.status) < 200 || Number(exchange.status) > 599) {
      return fail("invalid-fixture");
    }
    return { status: exchange.status as number, body: exchange.body };
  });
}
export function validateBenchmarkFixture(value: unknown): DefinitionBenchmarkFixture {
  if (bytes(value) > BULK_BENCHMARK_LIMITS.maxFixtureBytes) fail("response-size-exceeded");
  const fixture = record(value);
  exactKeys(fixture, ["version", "items", "bulk", "perItem"]);
  if (fixture.version !== 1) fail("invalid-fixture");
  const items = validateItems(fixture.items);
  const perItem = record(fixture.perItem);
  exactKeys(perItem, items.map((item) => item.id));
  return {
    version: 1, items, bulk: tape(fixture.bulk),
    perItem: Object.fromEntries(items.map((item) => [item.id, tape(perItem[item.id])])),
  };
}

function path(value: unknown, absolute: boolean): string {
  if (typeof value !== "string" || !value || value.length > BULK_BENCHMARK_LIMITS.maxPathLength ||
      /[\\:%?#]/.test(value) ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      value.startsWith("/") !== absolute) {
    return fail("invalid-bulk-response");
  }
  const segments = (absolute ? value.slice(1) : value).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return fail("invalid-bulk-response");
  }
  return value;
}

/** In-memory demultiplexing only. Paths are never used for filesystem access. */
export function splitBulkDefinitions(
  response: unknown, requestedItems: BenchmarkItem[],
): Map<string, { definition: { parts: Part[] } }> {
  const items = validateItems(requestedItems);
  if (bytes(response) > BULK_BENCHMARK_LIMITS.maxResponseBytes) fail("response-size-exceeded");
  const body = record(response);
  if (!Array.isArray(body.itemDefinitionsIndex) || !Array.isArray(body.definitionParts) ||
      body.itemDefinitionsIndex.length > items.length || body.definitionParts.length > BULK_BENCHMARK_LIMITS.maxParts) {
    return fail("invalid-bulk-response");
  }
  const requested = new Set(items.map((item) => item.id));
  const roots = new Map<string, string>();
  const result = new Map<string, { definition: { parts: Part[] } }>();
  for (const value of body.itemDefinitionsIndex) {
    const entry = record(value);
    let id: string;
    try { id = strictUuid(entry.id); } catch { return fail("invalid-bulk-response"); }
    const root = path(entry.rootPath, true);
    if (!requested.has(id) || result.has(id) || [...roots.keys()].some((other) => {
      const a = root.toLowerCase(), b = other.toLowerCase();
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    })) fail("invalid-bulk-response");
    roots.set(root, id);
    result.set(id, { definition: { parts: [] } });
  }
  const seenPaths = new Set<string>();
  for (const value of body.definitionParts) {
    const part = record(value);
    const fullPath = path(part.path, true);
    if (seenPaths.has(fullPath.toLowerCase()) || part.payloadType !== "InlineBase64" ||
        typeof part.payload !== "string") fail("invalid-bulk-response");
    seenPaths.add(fullPath.toLowerCase());
    const owner = [...roots.entries()].find(([root]) => fullPath.startsWith(`${root}/`));
    if (!owner) fail("invalid-bulk-response");
    result.get(owner[1])!.definition.parts.push({
      path: path(fullPath.slice(owner[0].length + 1), false),
      payload: part.payload, payloadType: "InlineBase64",
    });
  }
  return result;
}

export function projectBenchmarkDefinition(item: BenchmarkItem, response: unknown): unknown {
  const parts = record(record(response).definition).parts;
  if (!Array.isArray(parts) || !parts.length || parts.length > BULK_BENCHMARK_LIMITS.maxParts) {
    return fail("invalid-definition");
  }
  const paths = new Set<string>();
  for (const value of parts) {
    const part = record(value);
    const relative = path(part.path, false).toLowerCase();
    if (paths.has(relative) || part.payloadType !== "InlineBase64" || typeof part.payload !== "string") {
      return fail("invalid-definition");
    }
    paths.add(relative);
    // Validate encoding even on skipped parts, but never parse their content.
    try { if (btoa(atob(part.payload)) !== part.payload) fail("invalid-definition"); }
    catch { return fail("invalid-definition"); }
  }
  if (item.type === "SemanticModel") return projectSemanticModel(response);
  if (item.type === "Report") {
    const projection = projectReport(response);
    if (projection.referenceStatus === "by-path-unsupported") fail("report-by-path-unsupported");
    return projection;
  }
  if (item.type === "GraphModel" &&
      ["graphtype.json", "graphdefinition.json", "datasources.json"].some((name) => !paths.has(name))) {
    return fail("projection-incomplete");
  }
  const projection = projectDefinition(item.type, response);
  if (projection.metadataTruncated || projection.factsTruncated || projection.unknownParts) fail("projection-incomplete");
  return projection;
}

type ItemResult = BenchmarkItem & {
  status: "complete" | "failed" | "not-attempted";
  source: "bulk" | "per-item" | "fallback";
  code?: Code;
  fallbackReason?: Code;
};
export type BenchmarkMetrics = {
  requests: number;
  requestBytes: number;
  responseBytes: number;
  projectedBytes: number;
  durationMs: number;
  requestFailures: number;
  projectionFailures: number;
  failedItems: number;
  fallbackRequested: number;
  fallbackAttempted: number;
  fallbackSucceeded: number;
  failures: Partial<Record<Code, number>>;
};
const STOP_CODES = new Set<Code>(["rate-limited", "request-budget-exhausted", "deadline-exhausted"]);
class Replay {
  readonly metrics: BenchmarkMetrics = {
    requests: 0, requestBytes: 0, responseBytes: 0, projectedBytes: 0, durationMs: 0,
    requestFailures: 0, projectionFailures: 0, failedItems: 0,
    fallbackRequested: 0, fallbackAttempted: 0, fallbackSucceeded: 0, failures: {},
  };
  readonly projections = new Map<string, unknown>();
  readonly items: ItemResult[] = [];
  readonly started = performance.now();
  stopped?: Code;
  constructor(private readonly maxRequests: number) {}
  check(): void {
    if (this.stopped) fail(this.stopped);
    if (performance.now() - this.started >= BULK_BENCHMARK_LIMITS.maxReplayMs) fail("deadline-exhausted");
    if (this.metrics.requests >= this.maxRequests) fail("request-budget-exhausted");
  }
  failure(error: unknown, kind: "request" | "projection"): Code {
    const code = safeCode(error);
    this.metrics[kind === "request" ? "requestFailures" : "projectionFailures"]++;
    this.metrics.failures[code] = (this.metrics.failures[code] ?? 0) + 1;
    if (STOP_CODES.has(code)) this.stopped = code;
    return code;
  }
  operation(exchanges: ReplayExchange[], bulkBody?: unknown): unknown {
    let index = 0;
    const next = (): ReplayExchange => {
      this.check();
      const exchange = exchanges[index++];
      if (!exchange) fail("operation-incomplete");
      this.metrics.requests++;
      if (index === 1 && bulkBody) this.metrics.requestBytes += bytes(bulkBody);
      const size = exchange.body === undefined ? 0 : bytes(exchange.body);
      this.metrics.responseBytes += size;
      if (size > BULK_BENCHMARK_LIMITS.maxResponseBytes ||
          this.metrics.responseBytes > BULK_BENCHMARK_LIMITS.maxTotalResponseBytes) fail("response-size-exceeded");
      if (exchange.status === 401 || exchange.status === 403) fail("read-write-permission-required");
      if (exchange.status === 400 || exchange.status === 404) fail("endpoint-unsupported");
      if (exchange.status === 423) fail("encrypted-label-blocked");
      if (exchange.status === 429) fail("rate-limited");
      if (exchange.status !== 200 && exchange.status !== 202) fail("upstream-failure");
      return exchange;
    };
    let response = next();
    if (response.status === 202) {
      let completed = false;
      for (let poll = 0; poll < BULK_BENCHMARK_LIMITS.maxPolls; poll++) {
        response = next();
        if (response.status !== 200) fail("operation-incomplete");
        const status = record(response.body).status;
        if (status === "Failed") fail("operation-failed");
        if (status === "Succeeded") { completed = true; break; }
        if (status !== "Running" && status !== "NotStarted") fail("operation-incomplete");
      }
      if (!completed) fail("operation-incomplete");
      response = next();
      if (response.status !== 200) fail("operation-incomplete");
    }
    if (index !== exchanges.length) fail("invalid-fixture");
    return response.body;
  }
  save(item: BenchmarkItem, response: unknown): void {
    const projection = projectBenchmarkDefinition(item, response);
    const size = bytes(projection);
    if (this.metrics.projectedBytes + size > BULK_BENCHMARK_LIMITS.maxProjectionBytes) fail("projection-limit-exceeded");
    this.projections.set(item.id, projection);
    this.metrics.projectedBytes += size;
  }
  perItem(item: BenchmarkItem, exchanges: ReplayExchange[], fallbackReason?: Code): void {
    const source = fallbackReason ? "fallback" : "per-item";
    const result = { ...item, source, ...(fallbackReason ? { fallbackReason } : {}) } as const;
    if (fallbackReason) this.metrics.fallbackRequested++;
    try { this.check(); } catch (error) {
      this.items.push({ ...result, status: "not-attempted", code: safeCode(error) });
      return;
    }
    if (fallbackReason) this.metrics.fallbackAttempted++;
    let response: unknown;
    try { response = this.operation(exchanges); } catch (error) {
      this.items.push({ ...result, status: "failed", code: this.failure(error, "request") });
      return;
    }
    try {
      this.save(item, response);
      this.items.push({ ...result, status: "complete" });
      if (fallbackReason) this.metrics.fallbackSucceeded++;
    } catch (error) {
      this.items.push({ ...result, status: "failed", code: this.failure(error, "projection") });
    }
  }
  finish(): { metrics: BenchmarkMetrics; items: ItemResult[] } {
    this.metrics.durationMs = performance.now() - this.started;
    this.metrics.failedItems = this.items.filter((item) => item.status !== "complete").length;
    return { metrics: this.metrics, items: this.items };
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Offline replay of sanitized contracts. No token, network transport, database,
 * raw-payload output or caller-supplied persistence callback is accepted.
 */
export function benchmarkDefinitions(
  input: unknown,
  options: { mode: "fixture-replay"; maxRequests?: number } = { mode: "fixture-replay" },
) {
  if (options.mode !== "fixture-replay" ||
      Object.keys(options).some((key) => !["mode", "maxRequests"].includes(key))) fail("invalid-fixture");
  const maxRequests = options.maxRequests ?? BULK_BENCHMARK_LIMITS.maxRequests;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > BULK_BENCHMARK_LIMITS.maxRequests) fail("invalid-fixture");
  const fixture = validateBenchmarkFixture(input);
  const baseline = new Replay(maxRequests);
  for (const item of fixture.items) baseline.perItem(item, fixture.perItem[item.id]);
  const perItem = baseline.finish();
  const bulk = new Replay(maxRequests);
  const selected = fixture.items.filter((item) => BULK_REVIEWED_TYPES.has(item.type));
  let definitions: ReturnType<typeof splitBulkDefinitions> | undefined;
  let bulkFailure: Code | undefined;
  let response: unknown;
  if (selected.length) {
    try {
      response = bulk.operation(fixture.bulk, {
        mode: "Selective", items: selected.map((item) => ({ id: item.id })),
      });
    } catch (error) { bulkFailure = bulk.failure(error, "request"); }
  }
  if (selected.length && !bulkFailure) {
    try { definitions = splitBulkDefinitions(response, selected); }
    catch (error) { bulkFailure = bulk.failure(error, "projection"); }
  }
  for (const item of fixture.items) {
    let reason = BULK_REVIEWED_TYPES.has(item.type) ? bulkFailure : "bulk-type-not-reviewed" as const;
    if (!reason) {
      try {
        const definition = definitions!.get(item.id);
        if (!definition) fail("missing-bulk-item");
        bulk.save(item, definition);
        bulk.items.push({ ...item, status: "complete", source: "bulk" });
      } catch (error) { reason = bulk.failure(error, "projection"); }
    }
    if (reason) bulk.perItem(item, fixture.perItem[item.id], reason);
  }
  const bulkResult = bulk.finish();
  const parity = { matched: 0, mismatched: 0, unavailable: 0 };
  for (const item of fixture.items) {
    if (!baseline.projections.has(item.id) || !bulk.projections.has(item.id)) parity.unavailable++;
    else if (canonical(baseline.projections.get(item.id)) === canonical(bulk.projections.get(item.id))) parity.matched++;
    else parity.mismatched++;
  }
  return {
    contractVersion: 1, runtimeGate: BULK_DEFINITION_RUNTIME_GATE,
    measurement: {
      kind: "sanitized-fixture-replay", networkRequests: 0, networkDurationMs: null,
      duration: "local replay and projection CPU/wall time, not Fabric latency",
      payload: "UTF-8 JSON fixture bodies, not compressed HTTP wire bytes",
    },
    perItem, bulk: bulkResult, parity,
  };
}
