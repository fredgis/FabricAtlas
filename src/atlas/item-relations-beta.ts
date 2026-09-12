import {
  acquireFabricItemRelationsToken,
  isUdfTimeoutFailure,
  readBoundedResponseText,
  tokenNeedsRefresh,
  type SyncIdentity,
} from "./live-sync";
import { getUdfUrl, validateUdfUrl } from "./config";
import type { Edge, Item } from "./model";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELATIONS_BATCH_SIZE = 4;
const MAX_RELATIONS_RESPONSE_BYTES = 26 * 1024 * 1024;
const RELATIONS_SLICE_TIMEOUT_MS = 195_000;
const MAX_SINGLE_ITEM_ATTEMPTS = 3;
const MAX_COLLECTION_ITEMS = 5_000;

export type ItemRelationsDirection = "upstream" | "downstream";

export type ItemRelationClass =
  | "data"
  | "association"
  | "orchestration"
  | "lifecycle"
  | "visibility";

export interface ItemRelationsBetaItem {
  id: string;
  workspaceId: string;
  type: string;
  displayName: string;
}

export interface ItemRelationsBetaWorkspace {
  id: string;
  displayName: string;
}

export interface ItemRelationsBetaRelation {
  itemId: string;
  dependentOnItemId: string;
  relationType: string;
}

export interface ItemRelationsBetaQuery {
  itemId: string;
  direction: ItemRelationsDirection;
  status: "complete" | "failed";
  itemCount?: number;
  relationCount?: number;
  workspaceCount?: number;
  code?: string;
  durationMs: number;
}

export interface ItemRelationsBetaSlice {
  schemaVersion: 1;
  source: "fabric-item-relations-api-beta";
  apiVersion: "beta";
  correlationId: string | null;
  workspaceId: string;
  directions: ItemRelationsDirection[];
  requestedItemIds: string[];
  completedItemIds: string[];
  remainingItemIds: string[];
  itemFailures: Record<
    string,
    Partial<Record<ItemRelationsDirection, string>>
  >;
  items: ItemRelationsBetaItem[];
  relations: ItemRelationsBetaRelation[];
  workspaces: ItemRelationsBetaWorkspace[];
  queries: ItemRelationsBetaQuery[];
  requestCount: number;
  errors: string[];
  durationMs: number;
  syncedAt: string;
}

export interface ItemRelationsBetaCollection {
  correlationId: string;
  workspaceId: string;
  requestedItemIds: string[];
  completedItemIds: string[];
  itemFailures: ItemRelationsBetaSlice["itemFailures"];
  items: ItemRelationsBetaItem[];
  relations: ItemRelationsBetaRelation[];
  workspaces: ItemRelationsBetaWorkspace[];
  queries: ItemRelationsBetaQuery[];
  errors: string[];
  requestCount: number;
  sliceCount: number;
  durationMs: number;
  collectedAt: string;
}

export interface ItemRelationsBetaProgress {
  completedItems: number;
  totalItems: number;
  requestCount: number;
  sliceCount: number;
}

export interface ItemRelationsBetaNode {
  key: string;
  id: string;
  workspaceId: string;
  workspaceName: string;
  displayName: string;
  itemType: string;
  isLocal: boolean;
}

export interface ItemRelationsBetaGraphEdge {
  id: string;
  sourceKey: string;
  targetKey: string;
  rawItemId: string;
  rawDependentOnItemId: string;
  relationType: string;
  relationClass: ItemRelationClass;
}

export interface ItemRelationsBetaGraph {
  nodes: ItemRelationsBetaNode[];
  edges: ItemRelationsBetaGraphEdge[];
  unresolvedRelationCount: number;
}

export interface ItemRelationsComparison {
  matching: Set<string>;
  betaOnly: Set<string>;
  currentOnly: Set<string>;
  directionConflicts: Set<string>;
  matchingCount: number;
  betaOnlyCount: number;
  currentOnlyCount: number;
  directionConflictCount: number;
  localRelationCount: number;
  crossWorkspaceRelationCount: number;
}

class RetryableRelationsSliceError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  label: string,
  maxLength = 500,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid ${label} in the Item Relations response.`);
  }
  return value;
}

function requiredUuid(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 64);
  if (!UUID_PATTERN.test(parsed)) {
    throw new Error(`Invalid ${label} in the Item Relations response.`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`Invalid ${label} in the Item Relations response.`);
  }
  return value;
}

function stringArray(
  value: unknown,
  label: string,
  mapValue: (entry: unknown, entryLabel: string) => string,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label} in the Item Relations response.`);
  }
  return value.map((entry, index) =>
    mapValue(entry, `${label}[${index}]`),
  );
}

function objectArray<T>(
  value: unknown,
  label: string,
  mapValue: (entry: Record<string, unknown>, index: number) => T,
): T[] {
  if (!Array.isArray(value) || value.length > 50_000) {
    throw new Error(`Invalid ${label} in the Item Relations response.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}] in the response.`);
    }
    return mapValue(entry, index);
  });
}

function unwrapUdfResponse(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("output" in value) return value.output;
  if ("body" in value) {
    const body = value.body;
    if (typeof body === "string") {
      try {
        return unwrapUdfResponse(JSON.parse(body));
      } catch {
        throw new Error("The Item Relations UDF returned invalid JSON.");
      }
    }
    return unwrapUdfResponse(body);
  }
  return value;
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalize = (values: string[]) =>
    values.map((value) => value.toLowerCase()).sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function parseItemFailures(
  value: unknown,
  requestedIds: Set<string>,
): ItemRelationsBetaSlice["itemFailures"] {
  if (!isRecord(value)) {
    throw new Error("Invalid item failures in the Item Relations response.");
  }
  const failures: ItemRelationsBetaSlice["itemFailures"] = {};
  for (const [itemId, rawDirections] of Object.entries(value)) {
    const normalizedId = requiredUuid(itemId, "failed item ID");
    if (!requestedIds.has(normalizedId.toLowerCase())) {
      throw new Error(
        "The Item Relations response included an unexpected failed item.",
      );
    }
    if (!isRecord(rawDirections)) {
      throw new Error(
        "Invalid item failure directions in the Item Relations response.",
      );
    }
    const directions: Partial<Record<ItemRelationsDirection, string>> = {};
    for (const [direction, rawCode] of Object.entries(rawDirections)) {
      if (direction !== "upstream" && direction !== "downstream") {
        throw new Error(
          "Invalid item failure direction in the Item Relations response.",
        );
      }
      directions[direction] = requiredString(
        rawCode,
        "item failure code",
        100,
      );
    }
    failures[normalizedId] = directions;
  }
  return failures;
}

export function parseItemRelationsBetaSlice(
  text: string,
  expectedWorkspaceId: string,
  expectedItemIds: string[],
  expectedCorrelationId: string,
): ItemRelationsBetaSlice {
  let parsed: unknown;
  try {
    parsed = unwrapUdfResponse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("The Item Relations UDF returned invalid JSON.");
    }
    throw error;
  }
  if (!isRecord(parsed)) {
    throw new Error("The Item Relations UDF returned an invalid response.");
  }
  if (
    parsed.schemaVersion !== 1 ||
    parsed.source !== "fabric-item-relations-api-beta" ||
    parsed.apiVersion !== "beta"
  ) {
    throw new Error("Unsupported Item Relations response contract.");
  }

  const workspaceId = requiredUuid(parsed.workspaceId, "workspace ID");
  if (workspaceId.toLowerCase() !== expectedWorkspaceId.toLowerCase()) {
    throw new Error("The Item Relations response targeted another workspace.");
  }
  const correlationId =
    parsed.correlationId == null
      ? null
      : requiredUuid(parsed.correlationId, "correlation ID");
  if (
    correlationId?.toLowerCase() !== expectedCorrelationId.toLowerCase()
  ) {
    throw new Error("The Item Relations response correlation ID did not match.");
  }

  const requestedItemIds = stringArray(
    parsed.requestedItemIds,
    "requested item IDs",
    requiredUuid,
  );
  if (!sameIds(requestedItemIds, expectedItemIds)) {
    throw new Error(
      "The Item Relations response did not match the requested items.",
    );
  }
  const requestedSet = new Set(
    requestedItemIds.map((value) => value.toLowerCase()),
  );
  const completedItemIds = stringArray(
    parsed.completedItemIds,
    "completed item IDs",
    requiredUuid,
  );
  const remainingItemIds = stringArray(
    parsed.remainingItemIds,
    "remaining item IDs",
    requiredUuid,
  );
  const completionSet = new Set(
    completedItemIds.map((value) => value.toLowerCase()),
  );
  for (const itemId of remainingItemIds) {
    if (completionSet.has(itemId.toLowerCase())) {
      throw new Error(
        "The Item Relations response marked an item complete and remaining.",
      );
    }
  }
  if (
    !sameIds(
      [...completedItemIds, ...remainingItemIds],
      requestedItemIds,
    )
  ) {
    throw new Error(
      "The Item Relations response omitted requested continuation state.",
    );
  }

  const directions = stringArray(
    parsed.directions,
    "directions",
    (entry, label) => requiredString(entry, label, 20),
  );
  if (
    directions.length !== 2 ||
    !directions.includes("upstream") ||
    !directions.includes("downstream")
  ) {
    throw new Error("The Item Relations response omitted an API direction.");
  }

  const items = objectArray(
    parsed.items,
    "items",
    (entry): ItemRelationsBetaItem => ({
      id: requiredUuid(entry.id, "item ID"),
      workspaceId: requiredUuid(entry.workspaceId, "item workspace ID"),
      type: requiredString(entry.type, "item type", 100),
      displayName: requiredString(entry.displayName, "item name", 300),
    }),
  );
  const relations = objectArray(
    parsed.relations,
    "relations",
    (entry): ItemRelationsBetaRelation => ({
      itemId: requiredUuid(entry.itemId, "relation item ID"),
      dependentOnItemId: requiredUuid(
        entry.dependentOnItemId,
        "relation dependency ID",
      ),
      relationType: requiredString(
        entry.relationType,
        "relation type",
        100,
      ),
    }),
  );
  const workspaces = objectArray(
    parsed.workspaces,
    "workspaces",
    (entry): ItemRelationsBetaWorkspace => ({
      id: requiredUuid(entry.id, "workspace ID"),
      displayName: requiredString(
        entry.displayName,
        "workspace name",
        300,
      ),
    }),
  );

  const knownItemIds = new Set([
    ...requestedSet,
    ...items.map((item) => item.id.toLowerCase()),
  ]);
  for (const relation of relations) {
    if (
      !knownItemIds.has(relation.itemId.toLowerCase()) ||
      !knownItemIds.has(relation.dependentOnItemId.toLowerCase())
    ) {
      throw new Error(
        "The Item Relations response omitted metadata for a relation endpoint.",
      );
    }
  }

  const queries = objectArray(
    parsed.queries,
    "queries",
    (entry): ItemRelationsBetaQuery => {
      const itemId = requiredUuid(entry.itemId, "query item ID");
      if (!requestedSet.has(itemId.toLowerCase())) {
        throw new Error(
          "The Item Relations response included an unexpected query item.",
        );
      }
      const direction = requiredString(
        entry.direction,
        "query direction",
        20,
      );
      if (direction !== "upstream" && direction !== "downstream") {
        throw new Error(
          "Invalid query direction in the Item Relations response.",
        );
      }
      const status = requiredString(entry.status, "query status", 20);
      if (status !== "complete" && status !== "failed") {
        throw new Error(
          "Invalid query status in the Item Relations response.",
        );
      }
      const query: ItemRelationsBetaQuery = {
        itemId,
        direction,
        status,
        durationMs: nonNegativeInteger(
          entry.durationMs,
          "query duration",
        ),
      };
      if (status === "complete") {
        query.itemCount = nonNegativeInteger(
          entry.itemCount,
          "query item count",
        );
        query.relationCount = nonNegativeInteger(
          entry.relationCount,
          "query relation count",
        );
        query.workspaceCount = nonNegativeInteger(
          entry.workspaceCount,
          "query workspace count",
        );
      } else {
        query.code = requiredString(entry.code, "query error code", 100);
      }
      return query;
    },
  );
  const requestCount = nonNegativeInteger(
    parsed.requestCount,
    "request count",
  );
  if (
    requestCount > expectedItemIds.length * 2 ||
    queries.length > requestCount
  ) {
    throw new Error("Invalid request evidence in the Item Relations response.");
  }
  const errors = stringArray(
    parsed.errors,
    "errors",
    (entry, label) => requiredString(entry, label, 300),
  );

  return {
    schemaVersion: 1,
    source: "fabric-item-relations-api-beta",
    apiVersion: "beta",
    correlationId,
    workspaceId,
    directions: ["upstream", "downstream"],
    requestedItemIds,
    completedItemIds,
    remainingItemIds,
    itemFailures: parseItemFailures(parsed.itemFailures, requestedSet),
    items,
    relations,
    workspaces,
    queries,
    requestCount,
    errors,
    durationMs: nonNegativeInteger(parsed.durationMs, "duration"),
    syncedAt: requiredString(parsed.syncedAt, "sync timestamp", 100),
  };
}

export function itemRelationsUdfUrl(
  workspaceId: string,
  configuredUrl = getUdfUrl(),
): string {
  const rawUrl = configuredUrl?.trim();
  if (!rawUrl) {
    throw new Error(
      "The Fabric Atlas UDF URL is not configured for this deployment.",
    );
  }
  const url = new URL(validateUdfUrl(rawUrl, workspaceId));
  const suffix = /\/functions\/sync_all\/invoke\/?$/i;
  url.pathname = url.pathname.replace(
    suffix,
    "/functions/sync_item_relations/invoke",
  );
  url.search = "";
  url.hash = "";
  return url.toString();
}

function linkedTimeoutSignal(parent?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    RELATIONS_SLICE_TIMEOUT_MS,
  );
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function delay(milliseconds: number, signal?: AbortSignal) {
  assertActive(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    window.setTimeout(
      () => signal?.removeEventListener("abort", abort),
      milliseconds,
    );
  });
}

async function invokeRelationsSlice(
  token: string,
  workspaceId: string,
  itemIds: string[],
  correlationId: string,
  signal?: AbortSignal,
): Promise<ItemRelationsBetaSlice> {
  const linked = linkedTimeoutSignal(signal);
  try {
    const response = await fetch(itemRelationsUdfUrl(workspaceId), {
      method: "POST",
      signal: linked.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify({
        arguments: {
          fabricToken: token,
          workspaceId,
          itemIds: JSON.stringify(itemIds),
          correlationId,
        },
      }),
    });
    if (!response.ok) {
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        isUdfTimeoutFailure(response.status, response.statusText)
      ) {
        throw new RetryableRelationsSliceError(
          `Item Relations collection was deferred (${response.status}).`,
        );
      }
      throw new Error(
        `Item Relations UDF failed with HTTP ${response.status}.`,
      );
    }
    const text = await readBoundedResponseText(
      response,
      MAX_RELATIONS_RESPONSE_BYTES,
    );
    return parseItemRelationsBetaSlice(
      text,
      workspaceId,
      itemIds,
      correlationId,
    );
  } catch (error) {
    if (
      linked.signal.aborted &&
      !signal?.aborted &&
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new RetryableRelationsSliceError(
        "Item Relations collection exceeded the slice deadline.",
      );
    }
    throw error;
  } finally {
    linked.cleanup();
  }
}

function relationKey(relation: ItemRelationsBetaRelation): string {
  return [
    relation.dependentOnItemId.toLowerCase(),
    relation.itemId.toLowerCase(),
    relation.relationType.toLowerCase(),
  ].join("|");
}

function itemKey(item: ItemRelationsBetaItem): string {
  return itemRelationsNodeKey(item.workspaceId, item.id);
}

export async function collectItemRelationsBeta(
  workspaceId: string,
  itemIds: string[],
  identity: SyncIdentity,
  reportProgress?: (progress: ItemRelationsBetaProgress) => void,
  signal?: AbortSignal,
): Promise<ItemRelationsBetaCollection> {
  const normalizedWorkspaceId = requiredUuid(workspaceId, "workspace ID");
  const normalizedItemIds = [
    ...new Map(
      itemIds.map((itemId) => {
        const parsed = requiredUuid(itemId, "item ID");
        return [parsed.toLowerCase(), parsed];
      }),
    ).values(),
  ];
  if (
    normalizedItemIds.length === 0 ||
    normalizedItemIds.length > MAX_COLLECTION_ITEMS
  ) {
    throw new Error(
      "Item Relations collection requires between 1 and 5,000 items.",
    );
  }

  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  const items = new Map<string, ItemRelationsBetaItem>();
  const relations = new Map<string, ItemRelationsBetaRelation>();
  const workspaces = new Map<string, ItemRelationsBetaWorkspace>();
  const completed = new Set<string>();
  const itemFailures: ItemRelationsBetaSlice["itemFailures"] = {};
  const queries: ItemRelationsBetaQuery[] = [];
  const errors: string[] = [];
  let requestCount = 0;
  let sliceCount = 0;
  let token = await acquireFabricItemRelationsToken(
    identity,
    true,
    signal,
  );
  const queue = Array.from(
    { length: Math.ceil(normalizedItemIds.length / RELATIONS_BATCH_SIZE) },
    (_, index) => ({
      itemIds: normalizedItemIds.slice(
        index * RELATIONS_BATCH_SIZE,
        (index + 1) * RELATIONS_BATCH_SIZE,
      ),
      attempt: 0,
    }),
  );

  while (queue.length > 0) {
    assertActive(signal);
    const batch = queue.shift();
    if (!batch) break;
    if (tokenNeedsRefresh(token)) {
      token = await acquireFabricItemRelationsToken(
        identity,
        false,
        signal,
      );
    }

    let slice: ItemRelationsBetaSlice;
    try {
      slice = await invokeRelationsSlice(
        token,
        normalizedWorkspaceId,
        batch.itemIds,
        correlationId,
        signal,
      );
    } catch (error) {
      if (!(error instanceof RetryableRelationsSliceError)) throw error;
      if (batch.itemIds.length > 1) {
        const middle = Math.ceil(batch.itemIds.length / 2);
        queue.unshift(
          { itemIds: batch.itemIds.slice(0, middle), attempt: 0 },
          { itemIds: batch.itemIds.slice(middle), attempt: 0 },
        );
        continue;
      }
      if (batch.attempt + 1 >= MAX_SINGLE_ITEM_ATTEMPTS) {
        throw new Error(
          `Item Relations collection repeatedly timed out for ${batch.itemIds[0]}.`,
        );
      }
      await delay(750 * 2 ** batch.attempt, signal);
      queue.unshift({
        itemIds: batch.itemIds,
        attempt: batch.attempt + 1,
      });
      continue;
    }

    sliceCount += 1;
    requestCount += slice.requestCount;
    for (const item of slice.items) items.set(itemKey(item), item);
    for (const relation of slice.relations) {
      relations.set(relationKey(relation), relation);
    }
    for (const workspace of slice.workspaces) {
      workspaces.set(workspace.id.toLowerCase(), workspace);
    }
    for (const itemId of slice.completedItemIds) {
      completed.add(itemId.toLowerCase());
    }
    for (const [itemId, failures] of Object.entries(
      slice.itemFailures,
    )) {
      itemFailures[itemId] = {
        ...itemFailures[itemId],
        ...failures,
      };
    }
    queries.push(...slice.queries);
    errors.push(...slice.errors);

    if (slice.remainingItemIds.length > 0) {
      if (
        sameIds(slice.remainingItemIds, batch.itemIds) &&
        batch.itemIds.length > 1
      ) {
        const middle = Math.ceil(batch.itemIds.length / 2);
        queue.unshift(
          { itemIds: batch.itemIds.slice(0, middle), attempt: 0 },
          { itemIds: batch.itemIds.slice(middle), attempt: 0 },
        );
      } else if (
        sameIds(slice.remainingItemIds, batch.itemIds) &&
        batch.attempt + 1 >= MAX_SINGLE_ITEM_ATTEMPTS
      ) {
        throw new Error(
          `Item Relations collection made no progress for ${batch.itemIds[0]}.`,
        );
      } else {
        queue.unshift({
          itemIds: slice.remainingItemIds,
          attempt: batch.attempt + 1,
        });
      }
    }

    reportProgress?.({
      completedItems: completed.size,
      totalItems: normalizedItemIds.length,
      requestCount,
      sliceCount,
    });
  }

  if (completed.size !== normalizedItemIds.length) {
    throw new Error("Item Relations collection ended before all items completed.");
  }
  return {
    correlationId,
    workspaceId: normalizedWorkspaceId,
    requestedItemIds: normalizedItemIds,
    completedItemIds: normalizedItemIds.filter((itemId) =>
      completed.has(itemId.toLowerCase()),
    ),
    itemFailures,
    items: [...items.values()],
    relations: [...relations.values()],
    workspaces: [...workspaces.values()],
    queries,
    errors,
    requestCount,
    sliceCount,
    durationMs: Date.now() - startedAt,
    collectedAt: new Date().toISOString(),
  };
}

export function itemRelationsNodeKey(
  workspaceId: string,
  itemId: string,
): string {
  return `${workspaceId.toLowerCase()}:${itemId.toLowerCase()}`;
}

export function classifyItemRelation(
  relationType: string,
): ItemRelationClass {
  switch (relationType.toLowerCase()) {
    case "datasource":
    case "shortcut":
    case "pushdata":
      return "data";
    case "orchestration":
      return "orchestration";
    case "cascadedelete":
      return "lifecycle";
    case "hiddeninworkspace":
      return "visibility";
    default:
      return "association";
  }
}

function localItemNode(
  workspaceId: string,
  workspaceName: string,
  item: Pick<Item, "fabricId" | "displayName" | "itemType">,
): ItemRelationsBetaNode {
  return {
    key: itemRelationsNodeKey(workspaceId, item.fabricId),
    id: item.fabricId,
    workspaceId,
    workspaceName,
    displayName: item.displayName,
    itemType: item.itemType,
    isLocal: true,
  };
}

export function buildItemRelationsBetaGraph(
  collection: ItemRelationsBetaCollection,
  localItems: Pick<Item, "fabricId" | "displayName" | "itemType">[],
  localWorkspaceName: string,
): ItemRelationsBetaGraph {
  const workspaceNames = new Map(
    collection.workspaces.map((workspace) => [
      workspace.id.toLowerCase(),
      workspace.displayName,
    ]),
  );
  workspaceNames.set(
    collection.workspaceId.toLowerCase(),
    workspaceNames.get(collection.workspaceId.toLowerCase()) ??
      localWorkspaceName,
  );

  const nodes = new Map<string, ItemRelationsBetaNode>();
  const nodeKeyByItemId = new Map<string, string>();
  for (const item of localItems) {
    const node = localItemNode(
      collection.workspaceId,
      localWorkspaceName,
      item,
    );
    nodes.set(node.key, node);
    nodeKeyByItemId.set(item.fabricId.toLowerCase(), node.key);
  }
  for (const item of collection.items) {
    const key = itemRelationsNodeKey(item.workspaceId, item.id);
    const existing = nodes.get(key);
    nodes.set(key, {
      key,
      id: item.id,
      workspaceId: item.workspaceId,
      workspaceName:
        workspaceNames.get(item.workspaceId.toLowerCase()) ??
        "Unknown workspace",
      displayName: item.displayName,
      itemType: item.type,
      isLocal:
        item.workspaceId.toLowerCase() ===
        collection.workspaceId.toLowerCase(),
      ...(existing
        ? {
            displayName: existing.displayName,
            itemType: existing.itemType,
          }
        : {}),
    });
    nodeKeyByItemId.set(item.id.toLowerCase(), key);
  }

  let unresolvedRelationCount = 0;
  const edges = new Map<string, ItemRelationsBetaGraphEdge>();
  for (const relation of collection.relations) {
    const itemKey = nodeKeyByItemId.get(relation.itemId.toLowerCase());
    const dependencyKey = nodeKeyByItemId.get(
      relation.dependentOnItemId.toLowerCase(),
    );
    if (!itemKey || !dependencyKey) {
      unresolvedRelationCount += 1;
      continue;
    }
    const sourceKey = dependencyKey;
    const targetKey = itemKey;
    const id = [
      sourceKey,
      targetKey,
      relation.relationType.toLowerCase(),
    ].join("|");
    edges.set(id, {
      id,
      sourceKey,
      targetKey,
      rawItemId: relation.itemId,
      rawDependentOnItemId: relation.dependentOnItemId,
      relationType: relation.relationType,
      relationClass: classifyItemRelation(relation.relationType),
    });
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    unresolvedRelationCount,
  };
}

function endpointKey(sourceId: string, targetId: string): string {
  return `${sourceId.toLowerCase()}|${targetId.toLowerCase()}`;
}

function currentEdgeId(edge: Edge): string {
  return `${edge.source}\u0000${edge.target}\u0000${edge.relation}`;
}

export function compareItemRelationsWithCurrent(
  graph: ItemRelationsBetaGraph,
  currentEdges: Edge[],
): ItemRelationsComparison {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const betaEdges = new Map<string, string[]>();
  let localRelationCount = 0;
  let crossWorkspaceRelationCount = 0;
  for (const edge of graph.edges) {
    const source = nodeByKey.get(edge.sourceKey);
    const target = nodeByKey.get(edge.targetKey);
    if (!source || !target) continue;
    if (source.isLocal && target.isLocal) {
      localRelationCount += 1;
      const key = endpointKey(source.id, target.id);
      const ids = betaEdges.get(key) ?? [];
      ids.push(edge.id);
      betaEdges.set(key, ids);
    } else {
      crossWorkspaceRelationCount += 1;
    }
  }

  const currentByEndpoints = new Map<string, string[]>();
  for (const edge of currentEdges) {
    const key = endpointKey(edge.source, edge.target);
    const ids = currentByEndpoints.get(key) ?? [];
    ids.push(currentEdgeId(edge));
    currentByEndpoints.set(key, ids);
  }

  const matching = new Set<string>();
  const betaOnly = new Set<string>();
  const directionConflicts = new Set<string>();
  for (const [key, edgeIds] of betaEdges) {
    const [sourceId, targetId] = key.split("|");
    if (currentByEndpoints.has(key)) {
      edgeIds.forEach((edgeId) => matching.add(edgeId));
    } else if (currentByEndpoints.has(endpointKey(targetId, sourceId))) {
      edgeIds.forEach((edgeId) => directionConflicts.add(edgeId));
    } else {
      edgeIds.forEach((edgeId) => betaOnly.add(edgeId));
    }
  }

  const currentOnly = new Set<string>();
  for (const [key, edgeIds] of currentByEndpoints) {
    const [sourceId, targetId] = key.split("|");
    if (
      !betaEdges.has(key) &&
      !betaEdges.has(endpointKey(targetId, sourceId))
    ) {
      edgeIds.forEach((edgeId) => currentOnly.add(edgeId));
    }
  }

  return {
    matching,
    betaOnly,
    currentOnly,
    directionConflicts,
    matchingCount: matching.size,
    betaOnlyCount: betaOnly.size,
    currentOnlyCount: currentOnly.size,
    directionConflictCount: directionConflicts.size,
    localRelationCount,
    crossWorkspaceRelationCount,
  };
}
