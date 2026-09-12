import { getRayfinClient } from "@/lib/rayfin-client";
import type { ItemRelationsBetaCollection } from "./item-relations-beta";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK_LENGTH = 3_200;
const MAX_CHUNKS = 10_000;
const PAGE_SIZE = 100;
const RETAINED_SNAPSHOTS = 2;

export interface ItemRelationsBetaSnapshotRow {
  id: string;
  workspace_id: string;
  snapshotId: string;
  writerEmail: string;
  rowType: "manifest" | "chunk";
  chunkIndex: number;
  chunkCount: number;
  payload: string;
  collectedAt: string | Date;
}

interface SnapshotQuery {
  where(filter: Record<string, unknown>): SnapshotQuery;
  orderBy(
    order: Record<string, "asc" | "desc">,
  ): SnapshotQuery;
  first(count: number): SnapshotQuery;
  after(cursor: string): SnapshotQuery;
  executePaginated(): Promise<{
    items: ItemRelationsBetaSnapshotRow[];
    endCursor?: string;
    hasNextPage: boolean;
  }>;
}

interface SnapshotApi {
  select(fields: readonly string[]): SnapshotQuery;
  create(
    value: Record<string, unknown>,
  ): Promise<ItemRelationsBetaSnapshotRow>;
  delete(filter: Record<string, unknown>): Promise<unknown>;
}

export interface ItemRelationsBetaPersistResult {
  cleanupWarning?: string;
}

const FIELDS = [
  "id",
  "workspace_id",
  "snapshotId",
  "writerEmail",
  "rowType",
  "chunkIndex",
  "chunkCount",
  "payload",
  "collectedAt",
] as const;

function api(): SnapshotApi {
  return (
    getRayfinClient().data as unknown as {
      ItemRelationsBetaSnapshot: SnapshotApi;
    }
  ).ItemRelationsBetaSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`Persisted Item Relations ${label} is invalid.`);
  }
  return value;
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Persisted Item Relations ${label} is invalid.`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`Persisted Item Relations ${label} is invalid.`);
  }
  return value;
}

function stringArray(
  value: unknown,
  label: string,
  uuid = false,
): string[] {
  if (!Array.isArray(value) || value.length > 50_000) {
    throw new Error(`Persisted Item Relations ${label} is invalid.`);
  }
  return value.map((entry, index) =>
    uuid
      ? requiredUuid(entry, `${label}[${index}]`)
      : requiredString(entry, `${label}[${index}]`, 500),
  );
}

function objectArray(
  value: unknown,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 50_000) {
    throw new Error(`Persisted Item Relations ${label} is invalid.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `Persisted Item Relations ${label}[${index}] is invalid.`,
      );
    }
    return entry;
  });
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

function validateCollection(
  value: unknown,
  workspaceId: string,
  snapshotId: string,
): ItemRelationsBetaCollection {
  if (!isRecord(value)) {
    throw new Error("Persisted Item Relations payload is invalid.");
  }
  const parsedWorkspaceId = requiredUuid(
    value.workspaceId,
    "workspace ID",
  );
  const parsedSnapshotId = requiredUuid(
    value.correlationId,
    "snapshot ID",
  );
  if (
    parsedWorkspaceId.toLowerCase() !== workspaceId.toLowerCase() ||
    parsedSnapshotId.toLowerCase() !== snapshotId.toLowerCase()
  ) {
    throw new Error(
      "Persisted Item Relations payload targets another snapshot.",
    );
  }

  const requestedItemIds = stringArray(
    value.requestedItemIds,
    "requested item IDs",
    true,
  );
  const completedItemIds = stringArray(
    value.completedItemIds,
    "completed item IDs",
    true,
  );
  if (!sameIds(requestedItemIds, completedItemIds)) {
    throw new Error(
      "Persisted Item Relations payload is not a complete collection.",
    );
  }

  const items = objectArray(value.items, "items").map((item) => ({
    id: requiredUuid(item.id, "item ID"),
    workspaceId: requiredUuid(
      item.workspaceId,
      "item workspace ID",
    ),
    type: requiredString(item.type, "item type", 100),
    displayName: requiredString(item.displayName, "item name", 300),
  }));
  const relations = objectArray(value.relations, "relations").map(
    (relation) => ({
      itemId: requiredUuid(relation.itemId, "relation item ID"),
      dependentOnItemId: requiredUuid(
        relation.dependentOnItemId,
        "relation dependency ID",
      ),
      relationType: requiredString(
        relation.relationType,
        "relation type",
        100,
      ),
    }),
  );
  const workspaces = objectArray(value.workspaces, "workspaces").map(
    (workspace) => ({
      id: requiredUuid(workspace.id, "workspace ID"),
      displayName: requiredString(
        workspace.displayName,
        "workspace name",
        300,
      ),
    }),
  );
  const queries = objectArray(value.queries, "queries").map((query) => {
    const direction = requiredString(
      query.direction,
      "query direction",
      20,
    );
    const status = requiredString(query.status, "query status", 20);
    if (
      (direction !== "upstream" && direction !== "downstream") ||
      (status !== "complete" && status !== "failed")
    ) {
      throw new Error(
        "Persisted Item Relations query evidence is invalid.",
      );
    }
    return {
      itemId: requiredUuid(query.itemId, "query item ID"),
      direction,
      status,
      itemCount:
        query.itemCount == null
          ? undefined
          : requiredInteger(query.itemCount, "query item count"),
      relationCount:
        query.relationCount == null
          ? undefined
          : requiredInteger(
              query.relationCount,
              "query relation count",
            ),
      workspaceCount:
        query.workspaceCount == null
          ? undefined
          : requiredInteger(
              query.workspaceCount,
              "query workspace count",
            ),
      code:
        query.code == null
          ? undefined
          : requiredString(query.code, "query failure code", 100),
      durationMs: requiredInteger(
        query.durationMs,
        "query duration",
      ),
    } as ItemRelationsBetaCollection["queries"][number];
  });
  if (!isRecord(value.itemFailures)) {
    throw new Error(
      "Persisted Item Relations item failures are invalid.",
    );
  }
  const itemFailures =
    value.itemFailures as ItemRelationsBetaCollection["itemFailures"];
  for (const [itemId, failures] of Object.entries(itemFailures)) {
    requiredUuid(itemId, "failed item ID");
    if (!isRecord(failures)) {
      throw new Error(
        "Persisted Item Relations failure evidence is invalid.",
      );
    }
    for (const [direction, code] of Object.entries(failures)) {
      if (direction !== "upstream" && direction !== "downstream") {
        throw new Error(
          "Persisted Item Relations failure direction is invalid.",
        );
      }
      requiredString(code, "failure code", 100);
    }
  }

  const collectedAt = requiredString(
    value.collectedAt,
    "collection timestamp",
    100,
  );
  if (!Number.isFinite(Date.parse(collectedAt))) {
    throw new Error(
      "Persisted Item Relations collection timestamp is invalid.",
    );
  }
  return {
    correlationId: parsedSnapshotId,
    workspaceId: parsedWorkspaceId,
    requestedItemIds,
    completedItemIds,
    itemFailures,
    items,
    relations,
    workspaces,
    queries,
    errors: stringArray(value.errors, "errors"),
    requestCount: requiredInteger(value.requestCount, "request count"),
    sliceCount: requiredInteger(value.sliceCount, "slice count"),
    durationMs: requiredInteger(value.durationMs, "duration"),
    collectedAt,
  };
}

function splitPayload(value: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + CHUNK_LENGTH);
    const lastCode = value.charCodeAt(end - 1);
    if (
      end < value.length &&
      lastCode >= 0xd800 &&
      lastCode <= 0xdbff
    ) {
      end -= 1;
    }
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  if (chunks.length === 0 || chunks.length > MAX_CHUNKS) {
    throw new Error(
      "The Item Relations scan exceeds the Beta persistence limit.",
    );
  }
  return chunks;
}

export function itemRelationsSnapshotRows(
  collection: ItemRelationsBetaCollection,
  writerEmail: string,
): ItemRelationsBetaSnapshotRow[] {
  const email = writerEmail.trim().toLowerCase();
  if (!email || email.length > 160) {
    throw new Error(
      "An authenticated email is required to persist the Item Relations scan.",
    );
  }
  const serialized = JSON.stringify(collection);
  const chunks = splitPayload(serialized);
  const collectedAt = new Date(collection.collectedAt);
  if (!Number.isFinite(collectedAt.getTime())) {
    throw new Error("The Item Relations collection timestamp is invalid.");
  }
  const base = {
    workspace_id: requiredUuid(
      collection.workspaceId,
      "workspace ID",
    ),
    snapshotId: requiredUuid(
      collection.correlationId,
      "snapshot ID",
    ),
    writerEmail: email,
    chunkCount: chunks.length,
    collectedAt,
  };
  return [
    ...chunks.map((payload, index) => ({
      id: crypto.randomUUID(),
      ...base,
      rowType: "chunk" as const,
      chunkIndex: index + 1,
      payload,
    })),
    {
      id: crypto.randomUUID(),
      ...base,
      rowType: "manifest" as const,
      chunkIndex: 0,
      payload: JSON.stringify({
        schemaVersion: 1,
        payloadLength: serialized.length,
      }),
    },
  ];
}

export function collectionFromSnapshotRows(
  manifest: ItemRelationsBetaSnapshotRow,
  chunks: ItemRelationsBetaSnapshotRow[],
  workspaceId: string,
): ItemRelationsBetaCollection {
  if (
    manifest.rowType !== "manifest" ||
    manifest.workspace_id.toLowerCase() !== workspaceId.toLowerCase() ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount > MAX_CHUNKS ||
    chunks.length !== manifest.chunkCount
  ) {
    throw new Error("Persisted Item Relations manifest is invalid.");
  }
  const indexes = new Set<number>();
  for (const chunk of chunks) {
    if (
      chunk.rowType !== "chunk" ||
      chunk.snapshotId.toLowerCase() !==
        manifest.snapshotId.toLowerCase() ||
      chunk.workspace_id.toLowerCase() !== workspaceId.toLowerCase() ||
      chunk.chunkCount !== manifest.chunkCount ||
      chunk.chunkIndex < 1 ||
      chunk.chunkIndex > manifest.chunkCount ||
      indexes.has(chunk.chunkIndex)
    ) {
      throw new Error("Persisted Item Relations chunks are invalid.");
    }
    indexes.add(chunk.chunkIndex);
  }
  const serialized = [...chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => chunk.payload)
    .join("");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Persisted Item Relations payload is invalid JSON.");
  }
  return validateCollection(
    value,
    workspaceId,
    manifest.snapshotId,
  );
}

async function readRows(
  filter: Record<string, unknown>,
  order: Record<string, "asc" | "desc">,
): Promise<ItemRelationsBetaSnapshotRow[]> {
  const rows: ItemRelationsBetaSnapshotRow[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  while (true) {
    let query = api()
      .select(FIELDS)
      .where(filter)
      .orderBy(order)
      .first(PAGE_SIZE);
    if (cursor) query = query.after(cursor);
    const page = await query.executePaginated();
    rows.push(...page.items);
    if (!page.hasNextPage) return rows;
    if (
      !page.endCursor ||
      page.endCursor === cursor ||
      cursors.has(page.endCursor)
    ) {
      throw new Error(
        "Item Relations snapshot pagination did not advance.",
      );
    }
    cursors.add(page.endCursor);
    cursor = page.endCursor;
  }
}

export async function loadItemRelationsBetaSnapshot(
  isPreview: boolean,
  workspaceId: string,
): Promise<ItemRelationsBetaCollection | null> {
  if (isPreview) return null;
  const manifests = await readRows(
    {
      workspace_id: { eq: workspaceId },
      rowType: { eq: "manifest" },
    },
    { collectedAt: "desc" },
  );
  let lastError: unknown;
  for (const manifest of manifests.slice(0, RETAINED_SNAPSHOTS)) {
    try {
      const chunks = await readRows(
        {
          workspace_id: { eq: workspaceId },
          snapshotId: { eq: manifest.snapshotId },
          rowType: { eq: "chunk" },
        },
        { chunkIndex: "asc" },
      );
      return collectionFromSnapshotRows(manifest, chunks, workspaceId);
    } catch (error) {
      console.warn(
        "[atlas] ignored invalid persisted Item Relations snapshot",
        manifest.snapshotId,
        error,
      );
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function saveItemRelationsBetaSnapshot(
  isPreview: boolean,
  collection: ItemRelationsBetaCollection,
  writerEmail: string | undefined,
): Promise<ItemRelationsBetaPersistResult> {
  if (isPreview) return {};
  const rows = itemRelationsSnapshotRows(
    collection,
    writerEmail ?? "",
  );
  const manifest = rows[rows.length - 1];
  const chunks = rows.slice(0, -1);
  for (let offset = 0; offset < chunks.length; offset += 20) {
    await Promise.all(
      chunks.slice(offset, offset + 20).map((row) =>
        api().create({
          ...row,
          collectedAt: new Date(row.collectedAt),
        }),
      ),
    );
  }
  await api().create({
    ...manifest,
    collectedAt: new Date(manifest.collectedAt),
  });

  try {
    const manifests = await readRows(
      {
        workspace_id: { eq: collection.workspaceId },
        rowType: { eq: "manifest" },
      },
      { collectedAt: "desc" },
    );
    const obsoleteIds = [
      ...new Set(
        manifests
          .slice(RETAINED_SNAPSHOTS)
          .map((row) => row.snapshotId),
      ),
    ];
    await Promise.all(
      obsoleteIds.map((snapshotId) =>
        api().delete({ snapshotId: { eq: snapshotId } }),
      ),
    );
    return {};
  } catch (error) {
    console.warn(
      "[atlas] Item Relations snapshot cleanup deferred",
      error,
    );
    return {
      cleanupWarning:
        "The scan was saved, but older Beta snapshots could not be pruned.",
    };
  }
}
