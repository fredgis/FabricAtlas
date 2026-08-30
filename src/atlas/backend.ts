// Persistence + sync boundary.
//
// Preview / standalone: everything is kept in-memory from the sample dataset,
// so the app is fully explorable without a backend (and drives the screenshots).
//
// Deployed inside Fabric:
//  - `runFabricSync` acquires a token (MSAL), invokes the `sync_all` Fabric User
//    Data Function, maps the Fabric REST payload onto the Atlas model, writes it
//    into the Rayfin entities, and returns it for immediate display.
//  - `loadFromDb` re-reads the Rayfin entities on startup so a previous sync is
//    shown without re-calling Fabric.
//  - `persistComment` writes a new comment to the Comment entity.
//
// Every backend call is wired defensively so a missing/ës misconfigured backend
// never breaks the UI — see docs/architecture.md for the full flow.

import { ATLAS_CONFIG } from "./config";
import {
  invokeSyncAll,
  mapSyncToAtlas,
  realText,
  toItemType,
  type SyncIdentity,
} from "./live-sync";
import { normalizeLineageEdges } from "./lineage";
import { DEPLOYMENT_ID } from "./release";
import {
  buildAtlasHistory,
  snapshotFromData,
  summarizeSnapshot,
  type AtlasHistory,
  type HistoricalSnapshot,
  type SnapshotCatalog,
  type SnapshotSummary,
} from "./history";
import type {
  AtlasData,
  Comment,
  Edge,
  Grant,
  Item,
  Job,
  ModelTableSchema,
  Principal,
  WorkspaceInfo,
} from "./model";

export type SyncProgressReporter = (progress: number, stage: string) => void;

type Row = Record<string, unknown>;
const SNAPSHOT_WRITE_BATCH_SIZE = 8;
interface EntityQuery {
  where: (filter: Row) => EntityQuery;
  first: (count: number) => EntityQuery;
  after: (cursor: string) => EntityQuery;
  executePaginated: () => Promise<{
    items: Row[];
    endCursor?: string;
    hasNextPage: boolean;
  }>;
}
interface EntityApi {
  select?: (fields: readonly string[]) => EntityQuery;
  findMany?: (f?: unknown) => Promise<Row[]>;
  create: (v: Row) => Promise<Row>;
  delete?: (filter: Row) => Promise<unknown>;
}

const ENTITY_FIELDS: Record<string, readonly string[]> = {
  Workspace: [
    "id",
    "snapshotId",
    "writerEmail",
    "deploymentId",
    "syncSectionsJson",
    "fabricId",
    "displayName",
    "capacity",
    "region",
    "itemCount",
    "edgeCount",
    "principalCount",
    "grantCount",
    "jobCount",
    "configCount",
    "schemaEntryCount",
    "summaryVersion",
    "healthyCount",
    "staleCount",
    "failingCount",
    "labelCount",
    "externalPrincipalCount",
    "failedJobCount",
    "brokenEdgeCount",
    "tableCount",
    "columnCount",
    "measureCount",
    "syncedAt",
  ],
  FabricItem: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "fabricId",
    "displayName",
    "itemType",
    "description",
    "ownerName",
    "ownerEmail",
    "configuredBy",
    "modifiedBy",
    "health",
    "endorsement",
    "endorsementRaw",
    "endorsementBy",
    "sensitivity",
    "sensitivityLabelId",
    "tags",
    "tagIds",
    "ownerMetadataAvailable",
    "sensitivityMetadataAvailable",
    "endorsementMetadataAvailable",
    "tagMetadataAvailable",
    "lastRefresh",
    "itemCreatedAt",
    "itemUpdatedAt",
  ],
  LineageEdge: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "sourceFabricId",
    "targetFabricId",
    "relation",
    "broken",
  ],
  Principal: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "principalId",
    "displayName",
    "kind",
    "email",
    "external",
  ],
  AccessGrant: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "itemFabricId",
    "principalRef",
    "accessLevel",
    "source",
    "roleName",
    "flag",
  ],
  JobRun: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "itemFabricId",
    "itemName",
    "jobType",
    "status",
    "startedAt",
    "durationSec",
    "message",
  ],
  ConfigEntry: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "itemFabricId",
    "section",
    "label",
    "value",
  ],
  Comment: [
    "id",
    "workspace_id",
    "itemFabricId",
    "authorId",
    "authorName",
    "authorEmail",
    "body",
    "createdAt",
  ],
  SyncRun: [
    "id",
    "workspace_id",
    "snapshotId",
    "writerEmail",
    "startedAt",
    "finishedAt",
    "status",
    "itemsSynced",
    "triggeredBy",
    "summary",
  ],
};

async function dataApi(): Promise<Record<string, EntityApi>> {
  const { getRayfinClient } = await import("@/lib/rayfin-client");
  return getRayfinClient().data as unknown as Record<string, EntityApi>;
}

function workspaceId(): string {
  return (
    (window as unknown as { __atlasWorkspaceId?: string }).__atlasWorkspaceId ??
    ATLAS_CONFIG.workspaceId
  );
}

const WS_FALLBACK: WorkspaceInfo = {
  fabricId: ATLAS_CONFIG.workspaceId,
  displayName: ATLAS_CONFIG.workspaceName,
  capacity: "",
  region: "",
};

function textOrFallback(value: unknown, fallback: string): string {
  const text = value == null ? "" : String(value).trim();
  return !text || text === "undefined" || text === "null" ? fallback : text;
}

function requireSyncWriter(user: SyncIdentity): string {
  const expected = ATLAS_CONFIG.syncAdminEmail.trim().toLowerCase();
  const actual = user.email?.trim().toLowerCase() ?? "";
  if (!expected || !actual || actual !== expected) {
    throw new Error(
      "Only the configured Atlas sync administrator can publish workspace snapshots.",
    );
  }
  return actual;
}

/* --------------------------- comments --------------------------- */

/** Persist a new comment to the Fabric-backed database (no-op in preview). */
export async function persistComment(
  isPreview: boolean,
  comment: Comment,
): Promise<void> {
  if (isPreview) return;
  if (
    !comment.authorId.trim() ||
    !comment.authorEmail?.trim()
  ) {
    throw new Error("An authenticated comment author is required.");
  }
  if (!comment.body.trim() || comment.body.length > 2000) {
    throw new Error("Comments must contain between 1 and 2000 characters.");
  }
  const data = await dataApi();
  await data.Comment.create({
    workspace_id: workspaceId(),
    itemFabricId: comment.itemFabricId,
    authorId: comment.authorId,
    authorName: comment.authorEmail,
    authorEmail: comment.authorEmail,
    body: comment.body,
    createdAt: new Date(comment.createdAt),
  });
}

/* ----------------------------- sync ----------------------------- */

/**
 * Live sync: invoke the `sync_all` UDF, map the result, persist it to the
 * Rayfin entities, and return it. Returns `null` in preview (no token/backend),
 * so the store keeps its sample data.
 */
export async function runFabricSync(
  isPreview: boolean,
  user: SyncIdentity,
  reportProgress?: SyncProgressReporter,
): Promise<AtlasData | null> {
  if (isPreview) {
    reportProgress?.(15, "Preparing preview sync");
    await new Promise((r) => setTimeout(r, 250));
    reportProgress?.(65, "Refreshing sample workspace");
    await new Promise((r) => setTimeout(r, 400));
    reportProgress?.(100, "Sync complete");
    return null;
  }
  requireSyncWriter(user);
  reportProgress?.(8, "Connecting to Microsoft Fabric");
  const raw = await invokeSyncAll(workspaceId(), user);
  reportProgress?.(48, "Workspace metadata received");
  const atlas = mapSyncToAtlas(raw, WS_FALLBACK);
  reportProgress?.(58, "Building the governance catalog");
  // Carry over comments that already live in the DB (sync doesn't touch them).
  try {
    const existing = await loadFromDb(false);
    if (existing) atlas.comments = existing.comments;
  } catch {
    /* ignore */
  }
  reportProgress?.(66, "Preserving team notes");
  const persisted = await persistSync(atlas, user, reportProgress);
  reportProgress?.(100, "Sync complete");
  return persisted;
}

/** Replace the catalog rows in the Rayfin DB with a freshly synced snapshot. */
async function persistSync(
  atlas: AtlasData,
  user: SyncIdentity,
  reportProgress?: SyncProgressReporter,
): Promise<AtlasData> {
  const wid = workspaceId();
  const snapshotId = crypto.randomUUID();
  const syncedAt = new Date();
  const writerEmail = requireSyncWriter(user);
  const data = await dataApi();

  const insertAll = async (entity: string, rows: Row[]) => {
    for (
      let offset = 0;
      offset < rows.length;
      offset += SNAPSHOT_WRITE_BATCH_SIZE
    ) {
      const results = await Promise.allSettled(
        rows
          .slice(offset, offset + SNAPSHOT_WRITE_BATCH_SIZE)
          .map((row) =>
            data[entity].create({
              workspace_id: wid,
              snapshotId,
              writerEmail,
              ...row,
            }),
          ),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    }
  };

  reportProgress?.(70, "Preparing the Atlas database");
  reportProgress?.(76, "Writing workspace items");

  await insertAll(
    "FabricItem",
    atlas.items.map((i) => ({
      fabricId: i.fabricId,
      displayName: i.displayName,
      itemType: i.itemType,
      description: i.description,
      ownerName: i.ownerName,
      ownerEmail: i.ownerEmail,
      configuredBy: i.configuredBy,
      modifiedBy: i.modifiedBy,
      health: i.health,
      endorsement: i.endorsement,
      endorsementRaw: i.endorsementRaw,
      endorsementBy: i.endorsementBy,
      sensitivity: i.sensitivity,
      sensitivityLabelId: i.sensitivityLabelId,
      tags: i.tags?.length ? i.tags.join(", ") : undefined,
      tagIds: i.tagIds?.length ? i.tagIds.join(",") : undefined,
      ownerMetadataAvailable: i.ownerMetadataAvailable,
      sensitivityMetadataAvailable: i.sensitivityMetadataAvailable,
      endorsementMetadataAvailable: i.endorsementMetadataAvailable,
      tagMetadataAvailable: i.tagMetadataAvailable,
      lastRefresh: i.lastRefresh ? new Date(i.lastRefresh) : undefined,
      itemCreatedAt: i.createdAt ? new Date(i.createdAt) : undefined,
      itemUpdatedAt: i.updatedAt ? new Date(i.updatedAt) : undefined,
    })),
  );
  reportProgress?.(82, "Writing principals and access");
  await insertAll(
    "Principal",
    atlas.principals.map((p) => ({
      principalId: p.principalId,
      displayName: p.displayName,
      kind: p.kind,
      email: p.email,
      external: !!p.external,
    })),
  );
  await insertAll(
    "AccessGrant",
    atlas.grants.map((g) => ({
      itemFabricId: g.itemFabricId,
      principalRef: g.principalRef,
      accessLevel: g.accessLevel,
      source: g.source,
      roleName: g.roleName,
      flag: g.flag,
    })),
  );
  reportProgress?.(88, "Writing jobs and lineage");
  await insertAll(
    "JobRun",
    atlas.jobs.map((j) => ({
      itemFabricId: j.itemFabricId,
      itemName: j.itemName,
      jobType: j.jobType,
      status: j.status,
      startedAt: j.startedAt ? new Date(j.startedAt) : undefined,
      durationSec: j.durationSec,
      message: j.message,
    })),
  );
  await insertAll(
    "LineageEdge",
    atlas.edges.map((e) => ({
      sourceFabricId: e.source,
      targetFabricId: e.target,
      relation: e.relation,
      broken: !!e.broken,
    })),
  );
  await insertAll(
    "ConfigEntry",
    atlas.config.map((c) => ({
      itemFabricId: c.itemFabricId,
      section: c.section,
      label: c.label,
      value: c.value,
    })),
  );
  reportProgress?.(94, "Writing object metadata");
  // Persist the sub-object schema (tables/columns/measures) as hidden ConfigEntry
  // rows so the Asset Catalog and deep lineage survive a reload without re-sync.
  // Values are chunked instead of truncated so wide table schemas retain every
  // real column while staying within ConfigEntry.value's 2,000-character limit.
  const schemaRows: Row[] = [];
  for (const [itemId, tables] of Object.entries(atlas.schema ?? {})) {
    for (const t of tables) {
      const serialized = JSON.stringify({
        rows:
          typeof t.rows === "number" &&
          Number.isFinite(t.rows) &&
          t.rows >= 0
            ? t.rows
            : undefined,
        objectType: t.objectType,
        source: t.source,
        description: t.description,
        isHidden: t.isHidden,
        columns: t.columns,
        measures: t.measures,
      });
      const chunks = serialized.match(/[\s\S]{1,1960}/g) ?? [""];
      for (let part = 0; part < chunks.length; part += 1) {
        schemaRows.push({
          itemFabricId: itemId,
          section: "__schema__",
          label: t.name,
          value: `v1:${String(part + 1).padStart(4, "0")}:${String(chunks.length).padStart(4, "0")}:${chunks[part]}`,
        });
      }
    }
  }
  if (schemaRows.length) await insertAll("ConfigEntry", schemaRows);

  // The audit row and every snapshot row must succeed before the Workspace
  // marker is written. That final marker is the atomic visibility switch:
  // orphaned rows from a failed attempt are never selected by hydration.
  reportProgress?.(97, "Finalizing the workspace snapshot");
  const snapshotSummary = summarizeSnapshot(
    snapshotFromData(atlas, snapshotId, syncedAt.toISOString()),
  );
  await data.SyncRun.create({
    workspace_id: wid,
    snapshotId,
    writerEmail,
    startedAt: syncedAt,
    finishedAt: syncedAt,
    status: "completed",
    itemsSynced: atlas.items.length,
    triggeredBy: user.name,
    summary: `${atlas.items.length} items · ${atlas.edges.length} lineage edges · ${atlas.principals.length} principals · ${atlas.jobs.length} jobs`,
  });
  await data.Workspace.create({
    snapshotId,
    writerEmail,
    deploymentId: DEPLOYMENT_ID,
    syncSectionsJson: atlas.workspace.syncSections
      ? JSON.stringify(atlas.workspace.syncSections)
      : undefined,
    fabricId: atlas.workspace.fabricId,
    displayName: atlas.workspace.displayName,
    capacity: atlas.workspace.capacity,
    region: atlas.workspace.region,
    itemCount: atlas.items.length,
    edgeCount: atlas.edges.length,
    principalCount: atlas.principals.length,
    grantCount: atlas.grants.length,
    jobCount: atlas.jobs.length,
    configCount: atlas.config.length,
    schemaEntryCount: schemaRows.length,
    summaryVersion: 1,
    healthyCount: snapshotSummary.healthyCount,
    staleCount: snapshotSummary.staleCount,
    failingCount: snapshotSummary.failingCount,
    labelCount: snapshotSummary.labelCount,
    externalPrincipalCount: snapshotSummary.externalPrincipalCount,
    failedJobCount: snapshotSummary.failedJobCount,
    brokenEdgeCount: snapshotSummary.brokenEdgeCount,
    tableCount: snapshotSummary.tableCount,
    columnCount: snapshotSummary.columnCount,
    measureCount: snapshotSummary.measureCount,
    syncedAt,
  });
  reportProgress?.(99, "Applying snapshot retention");
  try {
    await pruneSnapshots(data, wid, snapshotId, writerEmail);
  } catch (error) {
    console.warn("[atlas] snapshot retention deferred", error);
  }
  return {
    ...atlas,
    workspace: {
      ...atlas.workspace,
      deploymentId: DEPLOYMENT_ID,
      snapshotId,
      syncedAt: syncedAt.toISOString(),
    },
  };
}

/* ----------------------------- load ----------------------------- */

const READ_RETRY_DELAYS_MS = [0, 120, 360];

async function readWithRetry(
  api: EntityApi,
  fields: readonly string[],
  filter: Row,
): Promise<Row[]> {
  let lastError: unknown;
  for (const delay of READ_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      if (!api.select) {
        if (!api.findMany) {
          throw new Error("Rayfin entity does not support reads");
        }
        return await api.findMany(filter);
      }
      const rows: Row[] = [];
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        let query = api.select(fields).where(filter).first(100);
        if (cursor) query = query.after(cursor);
        const page = await query.executePaginated();
        rows.push(...page.items);
        if (!page.hasNextPage) return rows;
        if (!page.endCursor || page.endCursor === cursor) {
          throw new Error("Rayfin pagination did not advance");
        }
        cursor = page.endCursor;
      }
      throw new Error("Rayfin pagination exceeded the safety limit");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function sameText(left: unknown, right: unknown): boolean {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function trustedWriterEmails(): string[] {
  return [
    ...new Set(
      [
        ATLAS_CONFIG.syncAdminEmail,
        ...ATLAS_CONFIG.previousSyncWriters,
      ]
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function isTrustedWriter(value: unknown): boolean {
  return trustedWriterEmails().some((email) => sameText(value, email));
}

function rowBelongsToWorkspace(row: Row, wid: string): boolean {
  return sameText(row.workspace_id, wid);
}

function rowsForSnapshot(
  rows: Row[],
  wid: string,
  snapshotId?: string,
  writerEmail = ATLAS_CONFIG.syncAdminEmail,
): Row[] {
  return rows.filter(
    (row) =>
      rowBelongsToWorkspace(row, wid) &&
      sameText(row.snapshotId, snapshotId) &&
      sameText(row.writerEmail, writerEmail),
  );
}

const MANIFEST_COUNTS = [
  ["itemCount", "items"],
  ["edgeCount", "lineage edges"],
  ["principalCount", "principals"],
  ["grantCount", "access grants"],
  ["jobCount", "jobs"],
  ["configCount", "configuration rows"],
  ["schemaEntryCount", "schema chunks"],
] as const;

function validateManifest(
  marker: Row,
  counts: Record<(typeof MANIFEST_COUNTS)[number][0], number>,
): void {
  if (
    !marker.snapshotId ||
    !isTrustedWriter(marker.writerEmail)
  ) {
    throw new Error("snapshot manifest is not signed by the configured writer");
  }
  for (const [field, label] of MANIFEST_COUNTS) {
    if (marker[field] == null || Number(marker[field]) !== counts[field]) {
      throw new Error(`snapshot manifest mismatch for ${label}`);
    }
  }
}

function parseSchemaRows(
  rows: Row[],
  itemIds: Set<string>,
): Record<string, ModelTableSchema[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const itemId = String(row.itemFabricId ?? "");
    const label = String(row.label ?? "");
    if (!itemIds.has(itemId) || !label) {
      throw new Error("snapshot contains schema for an unknown item");
    }
    const key = JSON.stringify([itemId, label]);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }

  const schema: Record<string, ModelTableSchema[]> = {};
  for (const [key, parts] of grouped) {
    const [itemId, label] = JSON.parse(key) as [string, string];
    const rawValues = parts.map((part) => String(part.value ?? ""));
    let serialized: string;
    if (rawValues.length === 1 && !rawValues[0].startsWith("v1:")) {
      serialized = rawValues[0];
    } else {
      const chunks = rawValues.map((value) => {
        const match = /^v1:(\d{4}):(\d{4}):([\s\S]*)$/.exec(value);
        if (!match) throw new Error("snapshot contains a malformed schema chunk");
        return {
          part: Number(match[1]),
          total: Number(match[2]),
          value: match[3],
        };
      });
      const total = chunks[0]?.total ?? 0;
      if (
        total !== chunks.length ||
        chunks.some((chunk) => chunk.total !== total) ||
        new Set(chunks.map((chunk) => chunk.part)).size !== total ||
        chunks.some((chunk) => chunk.part < 1 || chunk.part > total)
      ) {
        throw new Error("snapshot contains an incomplete schema");
      }
      serialized = chunks
        .sort((left, right) => left.part - right.part)
        .map((chunk) => chunk.value)
        .join("");
    }
    const parsed = JSON.parse(serialized) as {
      rows?: number;
      objectType?: string;
      source?: string;
      description?: string;
      isHidden?: boolean;
      columns?: ModelTableSchema["columns"];
      measures?: ModelTableSchema["measures"];
    };
    const tables = schema[itemId] ?? [];
    tables.push({
      name: label,
      rows: parsed.rows,
      objectType: parsed.objectType,
      source: parsed.source,
      description: parsed.description,
      isHidden: parsed.isHidden,
      columns: Array.isArray(parsed.columns) ? parsed.columns : [],
      measures: Array.isArray(parsed.measures) ? parsed.measures : [],
    });
    schema[itemId] = tables;
  }
  return schema;
}

type ReadEntity = (entity: string, filter: Row) => Promise<Row[]>;

interface SnapshotRows {
  itemRows: Row[];
  edgeRows: Row[];
  principalRows: Row[];
  grantRows: Row[];
  jobRows: Row[];
  regularConfigRows: Row[];
  schemaRows: Row[];
  syncRows: Row[];
}

function readerFor(data: Record<string, EntityApi>): ReadEntity {
  return (entity, filter) => {
    const api = data[entity];
    if (!api) throw new Error(`Rayfin entity ${entity} is unavailable`);
    const fields = ENTITY_FIELDS[entity];
    if (!fields) throw new Error(`Rayfin fields for ${entity} are unavailable`);
    return readWithRetry(api, fields, filter);
  };
}

async function readTrustedWorkspaceMarkers(
  read: ReadEntity,
  wid: string,
  snapshotId?: string,
): Promise<Row[]> {
  const groups = await Promise.all(
    trustedWriterEmails().map((writerEmail) =>
      read("Workspace", {
        fabricId: { eq: wid },
        ...(snapshotId ? { snapshotId: { eq: snapshotId } } : {}),
        writerEmail: { eq: writerEmail },
      }),
    ),
  );
  return groups.flat();
}

function validDateIso(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nonNegativeInteger(row: Row, field: string): number | undefined {
  const value = Number(row[field]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function snapshotSummaryFromManifest(
  marker: Row,
): SnapshotSummary | undefined {
  if (Number(marker.summaryVersion) !== 1) return undefined;
  const snapshotId = realText(marker.snapshotId);
  const syncedAt = validDateIso(marker.syncedAt);
  if (!snapshotId || !syncedAt) return undefined;

  const values = {
    items: nonNegativeInteger(marker, "itemCount"),
    healthy: nonNegativeInteger(marker, "healthyCount"),
    stale: nonNegativeInteger(marker, "staleCount"),
    failing: nonNegativeInteger(marker, "failingCount"),
    labels: nonNegativeInteger(marker, "labelCount"),
    principals: nonNegativeInteger(marker, "principalCount"),
    externalPrincipals: nonNegativeInteger(
      marker,
      "externalPrincipalCount",
    ),
    grants: nonNegativeInteger(marker, "grantCount"),
    failedJobs: nonNegativeInteger(marker, "failedJobCount"),
    lineage: nonNegativeInteger(marker, "edgeCount"),
    brokenEdges: nonNegativeInteger(marker, "brokenEdgeCount"),
    tables: nonNegativeInteger(marker, "tableCount"),
    columns: nonNegativeInteger(marker, "columnCount"),
    measures: nonNegativeInteger(marker, "measureCount"),
  };
  if (Object.values(values).some((value) => value == null)) return undefined;

  const summary = values as Record<keyof typeof values, number>;
  if (
    summary.healthy + summary.stale + summary.failing > summary.items ||
    summary.labels > summary.items ||
    summary.externalPrincipals > summary.principals ||
    summary.failedJobs >
      (nonNegativeInteger(marker, "jobCount") ?? -1) ||
    summary.brokenEdges > summary.lineage
  ) {
    return undefined;
  }

  return {
    snapshotId,
    syncedAt,
    label: syncedAt.slice(0, 10),
    deploymentId: realText(marker.deploymentId),
    items: summary.items,
    itemCount: summary.items,
    healthy: summary.healthy,
    healthyCount: summary.healthy,
    stale: summary.stale,
    staleCount: summary.stale,
    failing: summary.failing,
    failingCount: summary.failing,
    labels: summary.labels,
    labelCount: summary.labels,
    principals: summary.principals,
    principalCount: summary.principals,
    externalPrincipals: summary.externalPrincipals,
    externalPrincipalCount: summary.externalPrincipals,
    grants: summary.grants,
    grantCount: summary.grants,
    failedJobs: summary.failedJobs,
    failedJobCount: summary.failedJobs,
    lineage: summary.lineage,
    lineageEdges: summary.lineage,
    lineageEdgeCount: summary.lineage,
    brokenEdges: summary.brokenEdges,
    brokenEdgeCount: summary.brokenEdges,
    tables: summary.tables,
    tableCount: summary.tables,
    columns: summary.columns,
    columnCount: summary.columns,
    measures: summary.measures,
    measureCount: summary.measures,
  };
}

function trustedMarkers(rows: Row[], wid: string): Row[] {
  return rows
    .filter(
      (row) =>
        sameText(row.fabricId, wid) &&
        !!textOrFallback(row.snapshotId, "") &&
        isTrustedWriter(row.writerEmail),
    )
    .sort(
      (left, right) =>
        (Date.parse(String(right.syncedAt ?? "")) || 0) -
          (Date.parse(String(left.syncedAt ?? "")) || 0) ||
        String(right.snapshotId).localeCompare(String(left.snapshotId)),
    );
}

function parseSyncSections(
  value: unknown,
): WorkspaceInfo["syncSections"] {
  const serialized = realText(value);
  if (!serialized) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("snapshot contains malformed sync section status");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("snapshot contains malformed sync section status");
  }
  const sections: NonNullable<WorkspaceInfo["syncSections"]> = {};
  for (const [name, raw] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new Error("snapshot contains malformed sync section status");
    }
    const status = (raw as { status?: unknown }).status;
    if (
      status !== "complete" &&
      status !== "unsupported" &&
      status !== "failed"
    ) {
      throw new Error("snapshot contains malformed sync section status");
    }
    const code = realText((raw as { code?: unknown }).code);
    sections[name] = { status, code };
  }
  return sections;
}

async function readSnapshotRows(
  read: ReadEntity,
  wid: string,
  snapshotId: string,
  includeSyncRuns: boolean,
  writerEmail = ATLAS_CONFIG.syncAdminEmail,
): Promise<SnapshotRows> {
  const filter = {
    workspace_id: { eq: wid },
    snapshotId: { eq: snapshotId },
    writerEmail: { eq: writerEmail },
  };
  const [
    allItemRows,
    allEdgeRows,
    allPrincipalRows,
    allGrantRows,
    allJobRows,
    allConfigRows,
    allSyncRows,
  ] = await Promise.all([
    read("FabricItem", filter),
    read("LineageEdge", filter),
    read("Principal", filter),
    read("AccessGrant", filter),
    read("JobRun", filter),
    read("ConfigEntry", filter),
    includeSyncRuns ? read("SyncRun", filter) : Promise.resolve([]),
  ]);
  const configRows = rowsForSnapshot(
    allConfigRows,
    wid,
    snapshotId,
    writerEmail,
  );
  return {
    itemRows: rowsForSnapshot(allItemRows, wid, snapshotId, writerEmail),
    edgeRows: rowsForSnapshot(allEdgeRows, wid, snapshotId, writerEmail),
    principalRows: rowsForSnapshot(
      allPrincipalRows,
      wid,
      snapshotId,
      writerEmail,
    ),
    grantRows: rowsForSnapshot(allGrantRows, wid, snapshotId, writerEmail),
    jobRows: rowsForSnapshot(allJobRows, wid, snapshotId, writerEmail),
    regularConfigRows: configRows.filter(
      (row) => String(row.section) !== "__schema__",
    ),
    schemaRows: configRows.filter(
      (row) => String(row.section) === "__schema__",
    ),
    syncRows: rowsForSnapshot(allSyncRows, wid, snapshotId, writerEmail),
  };
}

function catalogFromRows(
  marker: Row,
  rows: SnapshotRows,
): SnapshotCatalog {
  validateManifest(marker, {
    itemCount: rows.itemRows.length,
    edgeCount: rows.edgeRows.length,
    principalCount: rows.principalRows.length,
    grantCount: rows.grantRows.length,
    jobCount: rows.jobRows.length,
    configCount: rows.regularConfigRows.length,
    schemaEntryCount: rows.schemaRows.length,
  });

  const items: Item[] = rows.itemRows.map((row) => {
    const fabricId = realText(row.fabricId);
    const itemType = toItemType(row.itemType);
    if (!fabricId || !itemType) {
      throw new Error("snapshot contains malformed Fabric item metadata");
    }
    return {
      fabricId,
      displayName: realText(row.displayName) ?? fabricId,
      itemType,
      description: realText(row.description),
      ownerName: realText(row.ownerName),
      ownerEmail: realText(row.ownerEmail),
      configuredBy: realText(row.configuredBy),
      modifiedBy: realText(row.modifiedBy),
      health: (row.health as Item["health"]) ?? "unknown",
      endorsement: (row.endorsement as Item["endorsement"]) ?? "none",
      endorsementRaw: realText(row.endorsementRaw),
      endorsementBy: realText(row.endorsementBy),
      sensitivity: realText(row.sensitivity),
      sensitivityLabelId: realText(row.sensitivityLabelId),
      tags: row.tags
        ? String(row.tags)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      tagIds: row.tagIds
        ? String(row.tagIds)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      ownerMetadataAvailable:
        typeof row.ownerMetadataAvailable === "boolean"
          ? row.ownerMetadataAvailable
          : undefined,
      sensitivityMetadataAvailable:
        typeof row.sensitivityMetadataAvailable === "boolean"
          ? row.sensitivityMetadataAvailable
          : undefined,
      endorsementMetadataAvailable:
        typeof row.endorsementMetadataAvailable === "boolean"
          ? row.endorsementMetadataAvailable
          : undefined,
      tagMetadataAvailable:
        typeof row.tagMetadataAvailable === "boolean"
          ? row.tagMetadataAvailable
          : undefined,
      lastRefresh: validDateIso(row.lastRefresh),
      createdAt: validDateIso(row.itemCreatedAt),
      updatedAt: validDateIso(row.itemUpdatedAt),
    };
  });
  if (new Set(items.map((item) => item.fabricId)).size !== items.length) {
    throw new Error("snapshot contains duplicate Fabric item IDs");
  }

  const itemIds = new Set(items.map((item) => item.fabricId));
  const edges: Edge[] = normalizeLineageEdges(
    items,
    rows.edgeRows.map((row) => ({
      source: String(row.sourceFabricId),
      target: String(row.targetFabricId),
      relation: String(row.relation),
      broken: !!row.broken,
    })),
  );
  const principals: Principal[] = rows.principalRows.map((row) => ({
    principalId: String(row.principalId),
    displayName: String(row.displayName),
    kind: row.kind as Principal["kind"],
    email: (row.email as string) || undefined,
    external: !!row.external,
    workspaceRole: "Viewer",
  }));
  const grants: Grant[] = rows.grantRows.map((row) => ({
    itemFabricId: (row.itemFabricId as string) || undefined,
    principalRef: String(row.principalRef),
    accessLevel: row.accessLevel as Grant["accessLevel"],
    source: row.source as Grant["source"],
    roleName: (row.roleName as string) || undefined,
    flag: (row.flag as Grant["flag"]) || undefined,
  }));
  const markerTime =
    validDateIso(marker.syncedAt) ?? new Date(0).toISOString();
  const jobs: Job[] = rows.jobRows.map((row) => ({
    itemFabricId: String(row.itemFabricId),
    itemName: String(row.itemName),
    jobType: String(row.jobType),
    status: row.status as Job["status"],
    startedAt: validDateIso(row.startedAt) ?? markerTime,
    durationSec: Number(row.durationSec ?? 0),
    message: (row.message as string) || undefined,
  }));
  const config = rows.regularConfigRows.map((row) => ({
    itemFabricId: String(row.itemFabricId),
    section: String(row.section),
    label: String(row.label),
    value: String(row.value ?? ""),
  }));
  const schema = parseSchemaRows(rows.schemaRows, itemIds);
  const snapshotId = String(marker.snapshotId);
  const syncedAt = validDateIso(marker.syncedAt) ?? markerTime;
  const workspace: WorkspaceInfo = {
    fabricId: textOrFallback(marker.fabricId, WS_FALLBACK.fabricId),
    displayName: textOrFallback(marker.displayName, WS_FALLBACK.displayName),
    capacity: textOrFallback(marker.capacity, WS_FALLBACK.capacity),
    region: textOrFallback(marker.region, WS_FALLBACK.region),
    deploymentId: textOrFallback(marker.deploymentId, "") || undefined,
    snapshotId,
    syncedAt,
    syncSections: parseSyncSections(marker.syncSectionsJson),
  };

  return {
    workspace,
    items,
    edges,
    principals,
    grants,
    jobs,
    config,
    schema,
  };
}

const SNAPSHOT_DELETE_BATCH_SIZE = 8;
const MAX_SNAPSHOTS_PRUNED_PER_SYNC = 4;
const MAX_RETENTION_CANDIDATES = 100;

async function deleteScopedRows(
  data: Record<string, EntityApi>,
  entity: string,
  rows: Row[],
  wid: string,
  snapshotId: string,
  writerEmail: string,
  workspaceMarker = false,
): Promise<void> {
  const api = data[entity];
  if (!api?.delete) {
    throw new Error(`Rayfin entity ${entity} does not support deletion`);
  }
  const scoped = rows.filter((row) => {
    const belongsToTarget = workspaceMarker
      ? sameText(row.fabricId, wid)
      : rowBelongsToWorkspace(row, wid);
    return (
      belongsToTarget &&
      sameText(row.snapshotId, snapshotId) &&
      sameText(row.writerEmail, writerEmail) &&
      !!realText(row.id)
    );
  });
  if (scoped.length !== rows.length) {
    throw new Error(`snapshot retention rejected unscoped ${entity} rows`);
  }

  for (
    let offset = 0;
    offset < scoped.length;
    offset += SNAPSHOT_DELETE_BATCH_SIZE
  ) {
    const results = await Promise.allSettled(
      scoped
        .slice(offset, offset + SNAPSHOT_DELETE_BATCH_SIZE)
        .map((row) => api.delete!({ id: String(row.id) })),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}

async function deleteSnapshot(
  data: Record<string, EntityApi>,
  marker: Row,
  rows: SnapshotRows,
  wid: string,
  writerEmail: string,
): Promise<void> {
  const snapshotId = String(marker.snapshotId);
  const groups: Array<[string, Row[]]> = [
    ["ConfigEntry", [...rows.regularConfigRows, ...rows.schemaRows]],
    ["JobRun", rows.jobRows],
    ["AccessGrant", rows.grantRows],
    ["Principal", rows.principalRows],
    ["LineageEdge", rows.edgeRows],
    ["FabricItem", rows.itemRows],
    ["SyncRun", rows.syncRows],
  ];
  for (const [entity, entityRows] of groups) {
    await deleteScopedRows(
      data,
      entity,
      entityRows,
      wid,
      snapshotId,
      writerEmail,
    );
  }
  await deleteScopedRows(
    data,
    "Workspace",
    [marker],
    wid,
    snapshotId,
    writerEmail,
    true,
  );
}

async function pruneSnapshots(
  data: Record<string, EntityApi>,
  wid: string,
  currentSnapshotId: string,
  writerEmail: string,
): Promise<void> {
  const read = readerFor(data);
  const workspaceRows = await readTrustedWorkspaceMarkers(read, wid);
  const unique = new Map<string, Row>();
  for (const marker of trustedMarkers(workspaceRows, wid)) {
    const snapshotId = String(marker.snapshotId);
    if (!unique.has(snapshotId)) unique.set(snapshotId, marker);
  }
  const current = unique.get(currentSnapshotId);
  if (!current || !sameText(current.writerEmail, writerEmail)) return;
  const candidates = [
    current,
    ...[...unique.values()].filter(
      (marker) => !sameText(marker.snapshotId, currentSnapshotId),
    ),
  ].slice(0, MAX_RETENTION_CANDIDATES);

  let retained = 0;
  let pruned = 0;
  for (const marker of candidates) {
    const snapshotId = String(marker.snapshotId);
    const markerWriter = realText(marker.writerEmail);
    if (!markerWriter) continue;
    const manifestSummary = snapshotSummaryFromManifest(marker);
    let rows: SnapshotRows | undefined;
    let valid = !!manifestSummary;

    if (!valid || retained >= ATLAS_CONFIG.snapshotRetentionCount) {
      try {
        rows = await readSnapshotRows(
          read,
          wid,
          snapshotId,
          true,
          markerWriter,
        );
        catalogFromRows(marker, rows);
        valid = true;
      } catch (error) {
        console.warn(
          "[atlas] skipped invalid retention candidate",
          snapshotId,
          error,
        );
        if (
          rows &&
          retained >= ATLAS_CONFIG.snapshotRetentionCount &&
          pruned < MAX_SNAPSHOTS_PRUNED_PER_SYNC
        ) {
          await deleteSnapshot(data, marker, rows, wid, markerWriter);
          pruned += 1;
        }
        continue;
      }
    }
    if (!valid) continue;

    if (
      sameText(snapshotId, currentSnapshotId) ||
      retained < ATLAS_CONFIG.snapshotRetentionCount
    ) {
      retained += 1;
      continue;
    }
    if (pruned >= MAX_SNAPSHOTS_PRUNED_PER_SYNC) break;
    if (!rows) {
      rows = await readSnapshotRows(
        read,
        wid,
        snapshotId,
        true,
        markerWriter,
      );
      catalogFromRows(marker, rows);
    }
    await deleteSnapshot(data, marker, rows, wid, markerWriter);
    pruned += 1;
  }
}

function commentsFromRows(rows: Row[], wid: string): Comment[] {
  return rows
    .filter((row) => rowBelongsToWorkspace(row, wid))
    .map((row) => ({
      id: String(row.id),
      itemFabricId: (row.itemFabricId as string) || undefined,
      authorId: String(row.authorId),
      authorName: textOrFallback(row.authorEmail, String(row.authorName)),
      authorEmail: (row.authorEmail as string) || undefined,
      body: String(row.body),
      createdAt: validDateIso(row.createdAt) ?? new Date(0).toISOString(),
    }));
}

function syncRunsFromRows(rows: Row[], fallbackTime: string): AtlasData["syncRuns"] {
  return rows
    .map((row) => ({
      id: String(row.id),
      startedAt: validDateIso(row.startedAt) ?? fallbackTime,
      finishedAt: validDateIso(row.finishedAt),
      status:
        (row.status as "running" | "completed" | "failed") ?? "completed",
      itemsSynced:
        row.itemsSynced != null ? Number(row.itemsSynced) : undefined,
      triggeredBy: (row.triggeredBy as string) || undefined,
      summary: (row.summary as string) || undefined,
    }))
    .sort(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );
}

/**
 * Read the previously synced catalog back out of the Rayfin entities. Returns
 * `null` in preview or when nothing has been synced yet (so the caller shows
 * the empty state), and never exposes an incomplete snapshot.
 */
export async function loadFromDb(isPreview: boolean): Promise<AtlasData | null> {
  if (isPreview) return null;
  try {
    const data = await dataApi();
    const wid = workspaceId();
    const read = readerFor(data);
    const [allCommentRows, workspaceRows] = await Promise.all([
      read("Comment", { workspace_id: { eq: wid } }),
      readTrustedWorkspaceMarkers(read, wid),
    ]);
    const comments = commentsFromRows(allCommentRows, wid);

    for (const marker of trustedMarkers(workspaceRows, wid)) {
      try {
        const snapshotId = String(marker.snapshotId);
        const markerWriter = realText(marker.writerEmail);
        if (!markerWriter) continue;
        const rows = await readSnapshotRows(
          read,
          wid,
          snapshotId,
          true,
          markerWriter,
        );
        const catalog = catalogFromRows(marker, rows);
        return {
          ...catalog,
          comments,
          syncRuns: syncRunsFromRows(
            rows.syncRows,
            catalog.workspace.syncedAt ?? new Date(0).toISOString(),
          ),
        };
      } catch (error) {
        console.warn(
          "[atlas] ignored incomplete database snapshot",
          marker.snapshotId,
          error,
        );
      }
    }
    return null;
  } catch (error) {
    console.warn("[atlas] loadFromDb failed", error);
    return null;
  }
}

export async function loadHistoricalSnapshotFromDb(
  isPreview: boolean,
  snapshotId: string,
): Promise<HistoricalSnapshot | undefined> {
  if (isPreview || !snapshotId) return undefined;
  const data = await dataApi();
  const wid = workspaceId();
  const read = readerFor(data);
  const workspaceRows = await readTrustedWorkspaceMarkers(
    read,
    wid,
    snapshotId,
  );
  const marker = trustedMarkers(workspaceRows, wid).find((candidate) =>
    sameText(candidate.snapshotId, snapshotId),
  );
  if (!marker) return undefined;
  const markerWriter = realText(marker.writerEmail);
  if (!markerWriter) return undefined;
  const rows = await readSnapshotRows(
    read,
    wid,
    snapshotId,
    false,
    markerWriter,
  );
  const catalog = catalogFromRows(marker, rows);
  return {
    snapshotId,
    syncedAt: catalog.workspace.syncedAt ?? String(marker.syncedAt ?? ""),
    catalog,
  };
}

/**
 * Build snapshot history from the validated current catalog and older trusted
 * manifests. Invalid older snapshots are skipped without affecting current data.
 */
export async function loadHistoryFromDb(
  isPreview: boolean,
  currentData: AtlasData,
  limit = ATLAS_CONFIG.snapshotRetentionCount,
): Promise<AtlasHistory> {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return buildAtlasHistory([]);

  const current = snapshotFromData(
    currentData,
    currentData.workspace.snapshotId ?? (isPreview ? "preview-current" : "current"),
    currentData.workspace.syncedAt ??
      currentData.syncRuns[0]?.finishedAt ??
      currentData.syncRuns[0]?.startedAt ??
      "",
  );
  if (isPreview || !currentData.workspace.snapshotId || cap === 1) {
    return buildAtlasHistory([current]);
  }

  const data = await dataApi();
  const wid = workspaceId();
  const read = readerFor(data);
  const workspaceRows = await readTrustedWorkspaceMarkers(read, wid);
  const currentTime = Date.parse(current.syncedAt);
  const snapshots: HistoricalSnapshot[] = [current];
  const summaries: SnapshotSummary[] = [];
  let previousLoaded = false;

  for (const marker of trustedMarkers(workspaceRows, wid)) {
    if (summaries.length >= cap - 1 && previousLoaded) break;
    const snapshotId = String(marker.snapshotId);
    const markerWriter = realText(marker.writerEmail);
    if (!markerWriter) continue;
    if (sameText(snapshotId, current.snapshotId)) continue;
    const markerTime = Date.parse(String(marker.syncedAt ?? ""));
    if (
      Number.isFinite(currentTime) &&
      Number.isFinite(markerTime) &&
      markerTime > currentTime
    ) {
      continue;
    }
    const manifestSummary = snapshotSummaryFromManifest(marker);
    let loaded: HistoricalSnapshot | undefined;
    if (!manifestSummary || !previousLoaded) {
      try {
        const rows = await readSnapshotRows(
          read,
          wid,
          snapshotId,
          false,
          markerWriter,
        );
        const catalog = catalogFromRows(marker, rows);
        loaded = {
          snapshotId,
          syncedAt:
            catalog.workspace.syncedAt ?? String(marker.syncedAt ?? ""),
          catalog,
        };
      } catch (error) {
        console.warn(
          "[atlas] ignored invalid historical snapshot details",
          snapshotId,
          error,
        );
      }
    }
    if (summaries.length < cap - 1) {
      if (manifestSummary) summaries.push(manifestSummary);
      else if (loaded) summaries.push(summarizeSnapshot(loaded));
    }
    if (loaded && !previousLoaded) {
      snapshots.push(loaded);
      previousLoaded = true;
    }
  }

  return buildAtlasHistory(snapshots, summaries);
}
