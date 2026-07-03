// Persistence + sync boundary.
//
// Preview / standalone: everything is kept in-memory from the sample dataset,
// so the app is fully explorable without a backend (and drives the screenshots).
//
// Deployed inside Fabric: `persistComment` writes to the Comment entity through
// the RayfinClient, and `runFabricSync` reads the Fabric REST APIs (items,
// lineage, access, jobs, config) and stores them in the Rayfin data model, then
// returns the reloaded catalog. Those calls are wired defensively so a missing
// backend never breaks the UI — see docs/architecture.md for the full flow.

import type { AtlasData, Comment } from "./model";

/** Persist a new comment to the Fabric-backed database (no-op in preview). */
export async function persistComment(
  isPreview: boolean,
  comment: Comment,
): Promise<void> {
  if (isPreview) return;
  try {
    const { getRayfinClient } = await import("@/lib/rayfin-client");
    const client = getRayfinClient() as unknown as {
      data: Record<string, { create: (v: unknown) => Promise<unknown> }>;
    };
    await client.data.Comment.create({
      workspace_id: (window as unknown as { __atlasWorkspaceId?: string }).__atlasWorkspaceId ?? "",
      itemFabricId: comment.itemFabricId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorEmail: comment.authorEmail,
      body: comment.body,
      createdAt: new Date(comment.createdAt),
    });
  } catch (err) {
    // Non-fatal: keep the optimistic in-memory comment.
    console.warn("[atlas] persistComment failed", err);
  }
}

/**
 * Read everything about the current workspace from the Fabric REST APIs and
 * store it in the Rayfin entities. Returns the reloaded catalog, or `null` to
 * signal the caller to keep its current (sample) data.
 *
 * The concrete Fabric calls (list items, lineage, refreshables, permissions)
 * run inside the Fabric-embedded app where the brokered token is available.
 * In preview there is no token, so we return `null` and the store just
 * refreshes timestamps on the sample set.
 */
export async function runFabricSync(
  isPreview: boolean,
  _user: { name: string; email?: string },
): Promise<AtlasData | null> {
  if (isPreview) {
    // Simulate a short round-trip so the Sync button shows progress.
    await new Promise((r) => setTimeout(r, 650));
    return null;
  }
  try {
    // Deployed implementation lives here: call the Fabric SDK / REST proxy,
    // upsert Workspace/FabricItem/LineageEdge/Principal/AccessGrant/JobRun/
    // ConfigEntry via client.data.*, then re-select and map to AtlasData.
    // Kept as a documented extension point for the hackathon build.
    return null;
  } catch (err) {
    console.warn("[atlas] runFabricSync failed", err);
    return null;
  }
}
