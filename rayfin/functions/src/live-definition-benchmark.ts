import {
  ExecutionDeadline, FabricRestClient, FabricRestError, RequestBudget, fabricSafeErrorCode,
} from "./fabric-rest.js";
import {
  projectBenchmarkDefinition, splitBulkDefinitions, type BenchmarkItem,
} from "./bulk-definition-benchmark.js";
import { strictUuid } from "./sync/protocol.js";

export const LIVE_BENCHMARK_LIMITS = {
  maxItems: 3, maxRequests: 40, executionMs: 120_000, requestMs: 20_000,
  responseBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024,
  maxPolls: 4, maxPages: 5, maxRecords: 1_000,
} as const;
const TYPES = ["GraphModel", "Report", "SemanticModel"] as const;
const ROUTES = { GraphModel: "graphModels", Report: "reports", SemanticModel: "semanticModels" };
const PROJECTION_CODES = new Set([
  "invalid-fixture", "invalid-bulk-response", "invalid-definition", "missing-bulk-item",
  "bulk-type-not-reviewed", "format-unsupported", "report-by-path-unsupported",
  "projection-incomplete", "unsafe-content-rejected", "projection-limit-exceeded",
  "response-size-exceeded", "definition-part-missing",
]);
const STOP_CODES = new Set([
  "rate-limited", "deadline-exhausted", "request-timeout", "retry-after-deferred",
  "request-budget-exhausted", "cancelled",
]);

export class LiveBenchmarkError extends Error {
  constructor(readonly code: string) { super(`Live definition benchmark stopped (${code}).`); }
}
type Metrics = {
  requests: number; requestBytes: number; responseBytesConsumed: number;
  declaredResponseBytes: number; responsesWithoutContentLength: number;
  elapsedMs: number; httpStatuses: Record<string, number>;
};
type Evidence = {
  ordinal: number; type: string; status: "complete" | "failed" | "not-attempted";
  source: "bulk" | "per-item" | "fallback"; format: string;
  code?: string; fallbackReason?: string;
};
function metrics(): Metrics {
  return { requests: 0, requestBytes: 0, responseBytesConsumed: 0, declaredResponseBytes: 0,
    responsesWithoutContentLength: 0, elapsedMs: 0, httpStatuses: {} };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LiveBenchmarkError("invalid-metadata");
  return value as Record<string, unknown>;
}
function code(error: unknown): string {
  if (error instanceof FabricRestError) return fabricSafeErrorCode(error, true);
  if (error instanceof LiveBenchmarkError) return error.code;
  if (error instanceof Error && "code" in error && typeof error.code === "string" && PROJECTION_CODES.has(error.code)) {
    return error.code;
  }
  return "projection-failed";
}
function format(response: unknown, item: BenchmarkItem): string {
  const parts = object(object(response).definition).parts;
  if (!Array.isArray(parts)) return "unknown";
  const paths = parts.map((part) => object(part).path);
  if (paths.includes("model.bim")) return "TMSL";
  if (paths.some((path) => typeof path === "string" && path.startsWith("definition/") && path.endsWith(".tmdl"))) return "TMDL";
  if (paths.includes("definition.pbir")) return "PBIR";
  if (item.type === "GraphModel" && paths.includes("graphType.json")) return "GraphJSON";
  return "unknown";
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export interface LiveBenchmarkDependencies {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

/** Authoring-only metadata experiment. Not registered as a deployed Function. */
export async function runLiveDefinitionBenchmark(
  token: string, workspaceName: string, confirmReadOnly: boolean,
  dependencies: LiveBenchmarkDependencies = {},
) {
  if (confirmReadOnly !== true || typeof workspaceName !== "string" || !workspaceName.trim() ||
      workspaceName.length > 100 || typeof token !== "string" || !token || /\s/.test(token)) {
    throw new LiveBenchmarkError("invalid-benchmark-input");
  }
  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  const deadline = new ExecutionDeadline(LIVE_BENCHMARK_LIMITS.executionMs, now);
  const budget = new RequestBudget(LIVE_BENCHMARK_LIMITS.maxRequests);
  const discovery = metrics(), perItem = metrics(), bulk = metrics();
  let active = discovery;
  let consumed = 0;
  const fetcher = dependencies.fetch ?? fetch;
  const measuredFetch: typeof fetch = async (input, init) => {
    if (consumed >= LIVE_BENCHMARK_LIMITS.totalBytes) throw new FabricRestError("response-size-exceeded");
    active.requests++;
    if (typeof init?.body === "string") active.requestBytes += new TextEncoder().encode(init.body).byteLength;
    const headers = new Headers(init?.headers);
    headers.set("x-ms-fabric-skill", "deployment-pipelines-authoring-cli");
    const response = await fetcher(input, { ...init, headers });
    const current = active;
    current.httpStatuses[String(response.status)] = (current.httpStatuses[String(response.status)] ?? 0) + 1;
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))) current.declaredResponseBytes += Number(length);
    else current.responsesWithoutContentLength++;
    if (!response.body) return response;
    return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        consumed += chunk.byteLength;
        current.responseBytesConsumed += chunk.byteLength;
        if (consumed > LIVE_BENCHMARK_LIMITS.totalBytes) throw new FabricRestError("response-size-exceeded");
        controller.enqueue(chunk);
      },
    })), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  // No HTTP retries: this is one controlled measurement, not a load test.
  const client = new FabricRestClient(token, {
    deadline, fetch: measuredFetch, sleep: dependencies.sleep,
    maxAttempts: 1, requestTimeoutMs: LIVE_BENCHMARK_LIMITS.requestMs,
    maxResponseBytes: LIVE_BENCHMARK_LIMITS.responseBytes,
  });
  const listLimits = { maxPages: LIVE_BENCHMARK_LIMITS.maxPages, maxRecords: LIVE_BENCHMARK_LIMITS.maxRecords };
  const workspaces = await client.list("/v1/workspaces", listLimits, budget);
  const matches = workspaces.map(object).filter((workspace) => workspace.displayName === workspaceName);
  if (matches.length !== 1) throw new LiveBenchmarkError("workspace-not-uniquely-resolved");
  const workspaceId = strictUuid(matches[0].id);
  const catalog = (await client.list(`/v1/workspaces/${workspaceId}/items`, listLimits, budget)).map(object);
  const available = catalog.filter((item) => TYPES.includes(item.type as typeof TYPES[number]))
    .map((item): BenchmarkItem => ({ id: strictUuid(item.id), type: item.type as BenchmarkItem["type"] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(available.map((item) => item.id)).size !== available.length) throw new LiveBenchmarkError("duplicate-item-identity");
  // One of each reviewed type first, then fill any empty slots deterministically.
  const selected = TYPES.flatMap((type) => available.filter((item) => item.type === type).slice(0, 1));
  for (const item of available) {
    if (selected.length >= LIVE_BENCHMARK_LIMITS.maxItems) break;
    if (!selected.some((chosen) => chosen.id === item.id)) selected.push(item);
  }
  if (!selected.length) throw new LiveBenchmarkError("no-reviewed-item-types");
  discovery.elapsedMs = now() - started;
  const baseline = new Map<string, unknown>(), effective = new Map<string, unknown>(), direct = new Map<string, unknown>();
  const baselineEvidence: Evidence[] = [], bulkEvidence: Evidence[] = [];
  let stopped: string | undefined;
  let bulkFailure: string | undefined;
  const lro = { maxPolls: LIVE_BENCHMARK_LIMITS.maxPolls, minPollDelayMs: 1_000,
    maxPollDelayMs: 30_000, maxResponseBytes: LIVE_BENCHMARK_LIMITS.responseBytes };
  const stop = (reason: string) => {
    if (STOP_CODES.has(reason) || consumed >= LIVE_BENCHMARK_LIMITS.totalBytes) stopped = reason;
  };
  const collectOne = async (item: BenchmarkItem, ordinal: number, fallbackReason?: string): Promise<Evidence> => {
    const evidence: Evidence = {
      ordinal, type: item.type, source: fallbackReason ? "fallback" : "per-item", format: "unknown",
      status: "not-attempted", ...(fallbackReason ? { fallbackReason } : {}),
    };
    if (stopped) return { ...evidence, code: stopped };
    try {
      const route = ROUTES[item.type as keyof typeof ROUTES];
      const response = await client.postLongRunning(`/v1/workspaces/${workspaceId}/${route}/${item.id}/getDefinition`,
        lro, budget, item.type === "SemanticModel" ? { format: "TMSL" } : undefined);
      evidence.format = format(response, item);
      const projection = projectBenchmarkDefinition(item, response);
      (fallbackReason ? effective : baseline).set(item.id, projection);
      return { ...evidence, status: "complete" };
    } catch (error) {
      const reason = code(error);
      stop(reason);
      return { ...evidence, status: "failed", code: reason };
    }
  };
  active = perItem;
  const baselineStart = now();
  for (const [index, item] of selected.entries()) baselineEvidence.push(await collectOne(item, index + 1));
  perItem.elapsedMs = now() - baselineStart;
  active = bulk;
  const bulkStart = now();
  if (!stopped) {
    try {
      const response = await client.postLongRunning(`/v1/workspaces/${workspaceId}/items/bulkExportDefinitions`,
        lro, budget, undefined, { mode: "Selective", items: selected.map(({ id }) => ({ id })) });
      const definitions = splitBulkDefinitions(response, selected);
      for (const [index, item] of selected.entries()) {
        const value = definitions.get(item.id);
        const evidence: Evidence = {
          ordinal: index + 1, type: item.type, source: "bulk", status: "failed", format: "unknown",
        };
        try {
          if (!value) throw new LiveBenchmarkError("missing-bulk-item");
          evidence.format = format(value, item);
          const projection = projectBenchmarkDefinition(item, value);
          direct.set(item.id, projection);
          effective.set(item.id, projection);
          bulkEvidence.push({ ...evidence, status: "complete" });
        } catch (error) {
          bulkEvidence.push({ ...evidence, code: code(error) });
        }
      }
    } catch (error) { bulkFailure = code(error); stop(bulkFailure); }
  } else bulkFailure = stopped;
  const bulkDirectEvidence = bulkEvidence.map((item) => ({ ...item }));
  for (const [index, item] of selected.entries()) {
    const evidence = bulkEvidence[index];
    const reason = bulkFailure ?? evidence?.code;
    if (reason) bulkEvidence[index] = await collectOne(item, index + 1, reason);
  }
  bulk.elapsedMs = now() - bulkStart;
  const parity = (comparison: Map<string, unknown>) => {
    const result = { matched: 0, mismatched: 0, unavailable: 0 };
    for (const item of selected) {
      if (!baseline.has(item.id) || !comparison.has(item.id)) result.unavailable++;
      else if (canonical(baseline.get(item.id)) === canonical(comparison.get(item.id))) result.matched++;
      else result.mismatched++;
    }
    return result;
  };
  const summary = (evidence: Evidence[]) => ({
    complete: evidence.filter((item) => item.status === "complete").length,
    failed: evidence.filter((item) => item.status === "failed").length,
    notAttempted: evidence.filter((item) => item.status === "not-attempted").length,
  });
  return {
    contractVersion: 1, measuredAt: new Date().toISOString(),
    mode: "live-authoring-identity-read-only", deploymentPerformed: false, persistedDefinitions: false,
    publicationAuthorized: false, deployedBulkGateEnabled: false,
    identity: { sameCredentialForBothPaths: true, deployedAppIdentityTested: false },
    limits: LIVE_BENCHMARK_LIMITS,
    selection: { policy: "one-per-reviewed-type-then-fill-by-id", count: selected.length, availableReviewedItems: available.length },
    measurement: {
      order: "per-item-then-bulk-once", repetitions: 1,
      responseBytes: "consumed decompressed body bytes, not compressed wire bytes",
      elapsed: "request, response-read, LRO-wait and projection wall time",
      errors: "error bodies are cancelled without logging; consumed bytes can be less than Content-Length",
      noPerformanceClaim: true,
    },
    discovery,
    perItem: { metrics: perItem, summary: summary(baselineEvidence), items: baselineEvidence },
    bulk: {
      metrics: bulk, operationFailure: bulkFailure ?? null,
      directItems: bulkDirectEvidence, finalItems: bulkEvidence, summary: summary(bulkEvidence),
      fallbackAttempted: bulkEvidence.filter((item) => item.source === "fallback" && item.status !== "not-attempted").length,
      fallbackSucceeded: bulkEvidence.filter((item) => item.source === "fallback" && item.status === "complete").length,
    },
    parity: { direct: parity(direct), afterFallback: parity(effective) },
    total: { requests: discovery.requests + perItem.requests + bulk.requests,
      responseBytesConsumed: consumed, elapsedMs: now() - started },
  };
}
