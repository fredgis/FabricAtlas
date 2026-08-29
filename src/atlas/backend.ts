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
}

const ENTITY_FIELDS: Record<string, readonly string[]> = {
  Workspace: [
    "id",
    "snapshotId",
    "writerEmail",
    "deploymentId",
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
    "health",
    "endorsement",
    "sensitivity",
    "tags",
    "lastRefresh",
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
  await persistSync(atlas, user, reportProgress);
  reportProgress?.(100, "Sync complete");
  return atlas;
}

/** Replace the catalog rows in the Rayfin DB with a freshly synced snapshot. */
async function persistSync(
  atlas: AtlasData,
  user: SyncIdentity,
  reportProgress?: SyncProgressReporter,
): Promise<void> {
  const wid = workspaceId();
  const snapshotId = crypto.randomUUID();
  const writerEmail = requireSyncWriter(user);
  const data = await dataApi();

  const insertAll = async (entity: string, rows: Row[]) => {
    for (const row of rows) {
      await data[entity].create({
        workspace_id: wid,
        snapshotId,
        writerEmail,
        ...row,
      });
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
      health: i.health,
      endorsement: i.endorsement,
      sensitivity: i.sensitivity,
      tags: i.tags?.length ? i.tags.join(", ") : undefined,
      lastRefresh: i.lastRefresh ? new Date(i.lastRefresh) : undefined,
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
        rows: t.rows,
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
  await data.SyncRun.create({
    workspace_id: wid,
    snapshotId,
    writerEmail,
    startedAt: new Date(),
    finishedAt: new Date(),
    status: "completed",
    itemsSynced: atlas.items.length,
    triggeredBy: user.name,
    summary: `${atlas.items.length} items · ${atlas.edges.length} lineage edges · ${atlas.principals.length} principals · ${atlas.jobs.length} jobs`,
  });
  await data.Workspace.create({
    snapshotId,
    writerEmail,
    deploymentId: DEPLOYMENT_ID,
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
    syncedAt: new Date(),
  });
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

function rowBelongsToWorkspace(row: Row, wid: string): boolean {
  return sameText(row.workspace_id, wid);
}

function rowsForSnapshot(
  rows: Row[],
  wid: string,
  snapshotId?: string,
): Row[] {
  return rows.filter(
    (row) =>
      rowBelongsToWorkspace(row, wid) &&
      sameText(row.snapshotId, snapshotId) &&
      sameText(row.writerEmail, ATLAS_CONFIG.syncAdminEmail),
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
    !sameText(marker.writerEmail, ATLAS_CONFIG.syncAdminEmail)
  ) {
    throw new Error("snapshot manifest is not signed by the configured writer");
  }
  for (const [field, label] of MANIFEST_COUNTS) {
    if (marker[field] == null || Number(marker[field]) !== counts[field]) {
      throw new Error(`snapshot manifest mismatch for ${label}`);
    }
  }
  if (counts.itemCount === 0) {
    throw new Error("snapshot manifest contains no workspace items");
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
        new Set(chunks.map((chunk) => chunk.part)).size !== total
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
    const read = (entity: string, filter: Row) => {
      const api = data[entity];
      if (!api) throw new Error(`Rayfin entity ${entity} is unavailable`);
      const fields = ENTITY_FIELDS[entity];
      if (!fields) throw new Error(`Rayfin fields for ${entity} are unavailable`);
      return readWithRetry(api, fields, filter);
    };
    const workspaceFilter = { workspace_id: { eq: wid } };
    const [
      allItemRows,
      allEdgeRows,
      allPrincipalRows,
      allGrantRows,
      allJobRows,
      allConfigRows,
      allCommentRows,
      allSyncRows,
      workspaceRows,
    ] = await Promise.all([
      read("FabricItem", workspaceFilter),
      read("LineageEdge", workspaceFilter),
      read("Principal", workspaceFilter),
      read("AccessGrant", workspaceFilter),
      read("JobRun", workspaceFilter),
      read("ConfigEntry", workspaceFilter),
      read("Comment", workspaceFilter),
      read("SyncRun", workspaceFilter),
      read("Workspace", { fabricId: { eq: wid } }),
    ]);

    const markers = workspaceRows
      .filter(
        (row) =>
          sameText(row.fabricId, wid) &&
          !!textOrFallback(row.snapshotId, "") &&
          sameText(row.writerEmail, ATLAS_CONFIG.syncAdminEmail),
      )
      .sort(
        (left, right) =>
          Date.parse(String(right.syncedAt ?? 0)) -
          Date.parse(String(left.syncedAt ?? 0)),
      );
    const candidates: Row[] = markers;
    const commentRows = allCommentRows.filter((row) =>
      rowBelongsToWorkspace(row, wid),
    );
    const comments: Comment[] = commentRows.map((row) => ({
      id: String(row.id),
      itemFabricId: (row.itemFabricId as string) || undefined,
      authorId: String(row.authorId),
      authorName: textOrFallback(row.authorEmail, String(row.authorName)),
      authorEmail: (row.authorEmail as string) || undefined,
      body: String(row.body),
      createdAt: row.createdAt
        ? new Date(row.createdAt as string).toISOString()
        : new Date().toISOString(),
    }));

    for (const marker of candidates) {
      try {
        const snapshotId = marker?.snapshotId
          ? String(marker.snapshotId)
          : undefined;
        const itemRows = rowsForSnapshot(allItemRows, wid, snapshotId);
        const edgeRows = rowsForSnapshot(allEdgeRows, wid, snapshotId);
        const principalRows = rowsForSnapshot(
          allPrincipalRows,
          wid,
          snapshotId,
        );
        const grantRows = rowsForSnapshot(allGrantRows, wid, snapshotId);
        const jobRows = rowsForSnapshot(allJobRows, wid, snapshotId);
        const configRows = rowsForSnapshot(allConfigRows, wid, snapshotId);
        const schemaRows = configRows.filter(
          (row) => String(row.section) === "__schema__",
        );
        const regularConfigRows = configRows.filter(
          (row) => String(row.section) !== "__schema__",
        );

        if (marker) {
          validateManifest(marker, {
            itemCount: itemRows.length,
            edgeCount: edgeRows.length,
            principalCount: principalRows.length,
            grantCount: grantRows.length,
            jobCount: jobRows.length,
            configCount: regularConfigRows.length,
            schemaEntryCount: schemaRows.length,
          });
        }

        const items: Item[] = itemRows.map((row) => {
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
            health: (row.health as Item["health"]) ?? "unknown",
            endorsement:
              (row.endorsement as Item["endorsement"]) ?? "none",
            sensitivity: realText(row.sensitivity),
            tags: row.tags
              ? String(row.tags)
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              : [],
            lastRefresh: row.lastRefresh
              ? new Date(row.lastRefresh as string).toISOString()
              : undefined,
          };
        });
        if (
          new Set(items.map((item) => item.fabricId)).size !== items.length
        ) {
          throw new Error("snapshot contains duplicate Fabric item IDs");
        }
        if (items.length === 0 && comments.length === 0) continue;

        const itemIds = new Set(items.map((item) => item.fabricId));
        const edges: Edge[] = normalizeLineageEdges(
          items,
          edgeRows.map((row) => ({
            source: String(row.sourceFabricId),
            target: String(row.targetFabricId),
            relation: String(row.relation),
            broken: !!row.broken,
          })),
        );
        const principals: Principal[] = principalRows.map((row) => ({
          principalId: String(row.principalId),
          displayName: String(row.displayName),
          kind: row.kind as Principal["kind"],
          email: (row.email as string) || undefined,
          external: !!row.external,
          workspaceRole: "Viewer",
        }));
        const grants: Grant[] = grantRows.map((row) => ({
          itemFabricId: (row.itemFabricId as string) || undefined,
          principalRef: String(row.principalRef),
          accessLevel: row.accessLevel as Grant["accessLevel"],
          source: row.source as Grant["source"],
          roleName: (row.roleName as string) || undefined,
          flag: (row.flag as Grant["flag"]) || undefined,
        }));
        const jobs: Job[] = jobRows.map((row) => ({
          itemFabricId: String(row.itemFabricId),
          itemName: String(row.itemName),
          jobType: String(row.jobType),
          status: row.status as Job["status"],
          startedAt: row.startedAt
            ? new Date(row.startedAt as string).toISOString()
            : new Date().toISOString(),
          durationSec: Number(row.durationSec ?? 0),
          message: (row.message as string) || undefined,
        }));
        const config = regularConfigRows.map((row) => ({
          itemFabricId: String(row.itemFabricId),
          section: String(row.section),
          label: String(row.label),
          value: String(row.value ?? ""),
        }));
        const schema = parseSchemaRows(schemaRows, itemIds);
        const syncRuns = rowsForSnapshot(allSyncRows, wid, snapshotId)
          .map((row) => ({
            id: String(row.id),
            startedAt: row.startedAt
              ? new Date(row.startedAt as string).toISOString()
              : new Date().toISOString(),
            finishedAt: row.finishedAt
              ? new Date(row.finishedAt as string).toISOString()
              : undefined,
            status:
              (row.status as "running" | "completed" | "failed") ??
              "completed",
            itemsSynced:
              row.itemsSynced != null ? Number(row.itemsSynced) : undefined,
            triggeredBy: (row.triggeredBy as string) || undefined,
            summary: (row.summary as string) || undefined,
          }))
          .sort(
            (left, right) =>
              Date.parse(right.startedAt) - Date.parse(left.startedAt),
          );
        const workspace: WorkspaceInfo = marker
          ? {
              fabricId: textOrFallback(
                marker.fabricId,
                WS_FALLBACK.fabricId,
              ),
              displayName: textOrFallback(
                marker.displayName,
                WS_FALLBACK.displayName,
              ),
              capacity: textOrFallback(
                marker.capacity,
                WS_FALLBACK.capacity,
              ),
              region: textOrFallback(marker.region, WS_FALLBACK.region),
              deploymentId:
                textOrFallback(marker.deploymentId, "") || undefined,
            }
          : WS_FALLBACK;

        return {
          workspace,
          items,
          edges,
          principals,
          grants,
          jobs,
          config,
          schema,
          comments,
          syncRuns,
        };
      } catch (error) {
        console.warn(
          "[atlas] ignored incomplete database snapshot",
          marker?.snapshotId,
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
