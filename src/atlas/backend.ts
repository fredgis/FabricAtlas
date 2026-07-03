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
import { invokeSyncAll, mapSyncToAtlas } from "./live-sync";
import type {
  AtlasData,
  Comment,
  Edge,
  Grant,
  Item,
  Job,
  Principal,
  WorkspaceInfo,
} from "./model";

type Row = Record<string, unknown>;
interface EntityApi {
  findMany: (f?: unknown) => Promise<Row[]>;
  findFirst?: (f?: unknown) => Promise<Row | null>;
  create: (v: Row) => Promise<Row>;
  delete: (w: Row) => Promise<Row>;
}

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
  displayName: "FGI-MAIN",
  capacity: "fgiswe (F16)",
  region: "Central US",
};

/* --------------------------- comments --------------------------- */

/** Persist a new comment to the Fabric-backed database (no-op in preview). */
export async function persistComment(
  isPreview: boolean,
  comment: Comment,
): Promise<void> {
  if (isPreview) return;
  try {
    const data = await dataApi();
    await data.Comment.create({
      workspace_id: workspaceId(),
      itemFabricId: comment.itemFabricId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorEmail: comment.authorEmail,
      body: comment.body,
      createdAt: new Date(comment.createdAt),
    });
  } catch (err) {
    console.warn("[atlas] persistComment failed", err);
  }
}

/* ----------------------------- sync ----------------------------- */

/**
 * Live sync: invoke the `sync_all` UDF, map the result, persist it to the
 * Rayfin entities, and return it. Returns `null` in preview (no token/backend),
 * so the store keeps its sample data.
 */
export async function runFabricSync(
  isPreview: boolean,
  user: { name: string; email?: string },
): Promise<AtlasData | null> {
  if (isPreview) {
    await new Promise((r) => setTimeout(r, 650));
    return null;
  }
  const raw = await invokeSyncAll(workspaceId());
  const atlas = mapSyncToAtlas(raw, WS_FALLBACK);
  // Carry over comments that already live in the DB (sync doesn't touch them).
  try {
    const existing = await loadFromDb(false);
    if (existing) atlas.comments = existing.comments;
  } catch {
    /* ignore */
  }
  await persistSync(atlas, user);
  return atlas;
}

/** Replace the catalog rows in the Rayfin DB with a freshly synced snapshot. */
async function persistSync(
  atlas: AtlasData,
  user: { name: string; email?: string },
): Promise<void> {
  const wid = workspaceId();
  let data: Record<string, EntityApi>;
  try {
    data = await dataApi();
  } catch (err) {
    console.warn("[atlas] persistSync: no data client", err);
    return;
  }

  const wipe = async (entity: string) => {
    try {
      const rows = await data[entity].findMany();
      await Promise.all(
        rows.map((r) => data[entity].delete({ id: r.id }).catch(() => undefined)),
      );
    } catch {
      /* entity may be empty or unavailable */
    }
  };

  const insertAll = async (entity: string, rows: Row[]) => {
    for (const row of rows) {
      try {
        await data[entity].create({ workspace_id: wid, ...row });
      } catch (err) {
        console.warn(`[atlas] create ${entity} failed`, err);
      }
    }
  };

  await Promise.all(
    ["FabricItem", "Principal", "AccessGrant", "JobRun", "LineageEdge", "ConfigEntry"].map(wipe),
  );

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

  // Workspace summary (single row) + a sync-run audit record.
  try {
    await wipe("Workspace");
    await data.Workspace.create({
      fabricId: atlas.workspace.fabricId,
      displayName: atlas.workspace.displayName,
      capacity: atlas.workspace.capacity,
      region: atlas.workspace.region,
      itemCount: atlas.items.length,
      syncedAt: new Date(),
    });
  } catch (err) {
    console.warn("[atlas] persist Workspace failed", err);
  }
  try {
    await data.SyncRun.create({
      workspace_id: wid,
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "completed",
      itemsSynced: atlas.items.length,
      triggeredBy: user.name,
      summary: `${atlas.items.length} items · ${atlas.edges.length} lineage edges · ${atlas.principals.length} principals · ${atlas.jobs.length} jobs`,
    });
  } catch (err) {
    console.warn("[atlas] persist SyncRun failed", err);
  }
}

/* ----------------------------- load ----------------------------- */

/**
 * Read the previously synced catalog back out of the Rayfin entities. Returns
 * `null` in preview or when nothing has been synced yet (so the caller shows
 * the empty state), and never throws.
 */
export async function loadFromDb(isPreview: boolean): Promise<AtlasData | null> {
  if (isPreview) return null;
  let data: Record<string, EntityApi>;
  try {
    data = await dataApi();
  } catch {
    return null;
  }

  const read = async (entity: string): Promise<Row[]> => {
    try {
      return await data[entity].findMany();
    } catch {
      return [];
    }
  };

  const [
    itemRows,
    edgeRows,
    principalRows,
    grantRows,
    jobRows,
    configRows,
    commentRows,
    syncRows,
    wsRows,
  ] = await Promise.all([
    read("FabricItem"),
    read("LineageEdge"),
    read("Principal"),
    read("AccessGrant"),
    read("JobRun"),
    read("ConfigEntry"),
    read("Comment"),
    read("SyncRun"),
    read("Workspace"),
  ]);

  const items: Item[] = itemRows.map((r) => ({
    fabricId: String(r.fabricId),
    displayName: String(r.displayName),
    itemType: r.itemType as Item["itemType"],
    description: (r.description as string) || undefined,
    ownerName: (r.ownerName as string) || undefined,
    ownerEmail: (r.ownerEmail as string) || undefined,
    health: (r.health as Item["health"]) ?? "unknown",
    endorsement: (r.endorsement as Item["endorsement"]) ?? "none",
    sensitivity: (r.sensitivity as string) || undefined,
    tags: r.tags ? String(r.tags).split(",").map((t) => t.trim()).filter(Boolean) : [],
    lastRefresh: r.lastRefresh ? new Date(r.lastRefresh as string).toISOString() : undefined,
  }));

  if (items.length === 0 && commentRows.length === 0) return null;

  const edges: Edge[] = edgeRows.map((r) => ({
    source: String(r.sourceFabricId),
    target: String(r.targetFabricId),
    relation: String(r.relation),
    broken: !!r.broken,
  }));
  const principals: Principal[] = principalRows.map((r) => ({
    principalId: String(r.principalId),
    displayName: String(r.displayName),
    kind: r.kind as Principal["kind"],
    email: (r.email as string) || undefined,
    external: !!r.external,
    workspaceRole: "Viewer",
  }));
  const grants: Grant[] = grantRows.map((r) => ({
    itemFabricId: (r.itemFabricId as string) || undefined,
    principalRef: String(r.principalRef),
    accessLevel: r.accessLevel as Grant["accessLevel"],
    source: r.source as Grant["source"],
    roleName: (r.roleName as string) || undefined,
    flag: (r.flag as Grant["flag"]) || undefined,
  }));
  const jobs: Job[] = jobRows.map((r) => ({
    itemFabricId: String(r.itemFabricId),
    itemName: String(r.itemName),
    jobType: String(r.jobType),
    status: r.status as Job["status"],
    startedAt: r.startedAt ? new Date(r.startedAt as string).toISOString() : new Date().toISOString(),
    durationSec: Number(r.durationSec ?? 0),
    message: (r.message as string) || undefined,
  }));
  const config = configRows.map((r) => ({
    itemFabricId: String(r.itemFabricId),
    section: String(r.section),
    label: String(r.label),
    value: String(r.value ?? ""),
  }));
  const comments: Comment[] = commentRows.map((r) => ({
    id: String(r.id),
    itemFabricId: (r.itemFabricId as string) || undefined,
    authorId: String(r.authorId),
    authorName: String(r.authorName),
    authorEmail: (r.authorEmail as string) || undefined,
    body: String(r.body),
    createdAt: r.createdAt ? new Date(r.createdAt as string).toISOString() : new Date().toISOString(),
  }));
  const syncRuns = syncRows.map((r) => ({
    id: String(r.id),
    startedAt: r.startedAt ? new Date(r.startedAt as string).toISOString() : new Date().toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt as string).toISOString() : undefined,
    status: (r.status as "running" | "completed" | "failed") ?? "completed",
    itemsSynced: r.itemsSynced != null ? Number(r.itemsSynced) : undefined,
    triggeredBy: (r.triggeredBy as string) || undefined,
    summary: (r.summary as string) || undefined,
  }));

  const ws = wsRows[0];
  const workspace: WorkspaceInfo = ws
    ? {
        fabricId: String(ws.fabricId),
        displayName: String(ws.displayName),
        capacity: (ws.capacity as string) || WS_FALLBACK.capacity,
        region: (ws.region as string) || WS_FALLBACK.region,
      }
    : WS_FALLBACK;

  return { workspace, items, edges, principals, grants, jobs, config, comments, syncRuns };
}
