// Live Sync: acquire a Power BI token in the browser (MSAL), invoke the Fabric
// User Data Function `sync_all`, and map the Fabric REST payload onto the Atlas
// data model. See the "Why a Fabric User Data Function?" note in the README for
// why this hop through a server-side function is required.

import { ATLAS_CONFIG, getUdfUrl } from "./config";
import {
  type AtlasData,
  type Item,
  type ItemType,
  type Principal,
  type Grant,
  type Job,
  type Edge,
  type WorkspaceInfo,
  type Health,
  type PrincipalKind,
  type WorkspaceRole,
  type ConfigKV,
  type AccessLevel,
} from "./model";

/* -------------------------------- MSAL --------------------------------- */

// Loosely typed to avoid pulling MSAL types into the module graph eagerly.
let msalApp: {
  initialize: () => Promise<void>;
  getAllAccounts: () => Array<unknown>;
  acquireTokenSilent: (r: unknown) => Promise<{ accessToken: string }>;
  ssoSilent: (r: unknown) => Promise<{ accessToken: string }>;
  acquireTokenPopup: (r: unknown) => Promise<{ accessToken: string }>;
} | null = null;

async function acquireToken(): Promise<string> {
  const { PublicClientApplication } = await import("@azure/msal-browser");
  if (!msalApp) {
    msalApp = new PublicClientApplication({
      auth: {
        clientId: ATLAS_CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${ATLAS_CONFIG.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "localStorage" },
    }) as unknown as typeof msalApp;
    await msalApp!.initialize();
  }
  const scopes = [ATLAS_CONFIG.scope];
  const account = msalApp!.getAllAccounts()[0];
  try {
    const res = account
      ? await msalApp!.acquireTokenSilent({ scopes, account })
      : await msalApp!.ssoSilent({ scopes });
    return res.accessToken;
  } catch {
    // Silent SSO can be blocked inside the Fabric iframe (3rd-party cookies);
    // fall back to a popup, which opens as a top-level window.
    const res = await msalApp!.acquireTokenPopup({ scopes });
    return res.accessToken;
  }
}

/* ----------------------------- UDF invoke ------------------------------ */

export interface RawSync {
  workspace?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  roleAssignments?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  lineage?: Array<{ source?: string; target?: string; relation?: string }>;
  access?: Array<{ itemId?: string; principalName?: string; principalEmail?: string; principalType?: string; accessRight?: string }>;
  config?: Array<{ itemId?: string; section?: string; label?: string; value?: string }>;
  errors?: string[];
}

export function isSyncConfigured(): boolean {
  return !!getUdfUrl();
}

// The portal gives one invoke URL per function; if the user pastes another
// function's URL (e.g. ping), retarget the last function segment to sync_all.
function retargetToSyncAll(url: string): string {
  if (/sync_all/i.test(url)) return url;
  return url.replace(/\/(ping|list_items|list_role_assignments|get_workspace)(\/|:|\?|$)/i, "/sync_all$2");
}

export async function invokeSyncAll(workspaceId: string): Promise<RawSync> {
  const raw = getUdfUrl();
  if (!raw) {
    throw new Error(
      "Sync endpoint not configured yet — publish the atlas_sync_functions UDF and paste its invoke URL.",
    );
  }
  const url = retargetToSyncAll(raw);
  const token = await acquireToken();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fabricToken: token, workspaceId }),
  });
  if (!resp.ok) {
    throw new Error(`Sync failed (HTTP ${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as Record<string, unknown>;
  // Fabric UDF wraps the return under `output`; accept a raw body too.
  return (json.output ?? json.body ?? json) as RawSync;
}

/* ------------------------------ mapping -------------------------------- */

const ROLE_TO_ACCESS: Record<string, "owner" | "edit" | "view"> = {
  Admin: "owner",
  Member: "edit",
  Contributor: "edit",
  Viewer: "view",
};

function toItemType(t: unknown): ItemType | null {
  // Keep every real workspace item; unknown types render with a neutral glyph.
  return typeof t === "string" && t.length > 0 ? (t as ItemType) : null;
}

function jobStatus(s: unknown): Job["status"] {
  const v = String(s ?? "").toLowerCase();
  if (v === "completed") return "completed";
  if (v === "failed" || v === "deduped") return "failed";
  if (v.includes("progress") || v === "notstarted") return "running";
  return "cancelled";
}

function accessLevelFrom(ar?: string | null): AccessLevel {
  const s = (ar || "").toLowerCase();
  if (s.includes("owner")) return "owner";
  if (s.includes("write")) return "edit";
  if (s.includes("read")) return "view";
  return "none";
}

export function mapSyncToAtlas(raw: RawSync, fallback: WorkspaceInfo): AtlasData {
  const items: Item[] = (raw.items ?? [])
    .map((it): Item | null => {
      const type = toItemType(it.type);
      if (!type) return null; // skip non-visual types (e.g. UserDataFunction)
      return {
        fabricId: String(it.id),
        displayName: String(it.displayName ?? it.id),
        itemType: type,
        description: (it.description as string) || undefined,
        health: "unknown" as Health,
        endorsement: "none",
        tags: [],
      };
    })
    .filter((x): x is Item => x !== null);

  const itemIds = new Set(items.map((i) => i.fabricId));

  const jobs: Job[] = (raw.jobs ?? []).map((j) => {
    const start = j.startTimeUtc as string | undefined;
    const end = j.endTimeUtc as string | undefined;
    return {
      itemFabricId: String(j.itemId ?? ""),
      itemName: String(j.itemDisplayName ?? j.itemId ?? ""),
      jobType: String(j.jobType ?? "Job"),
      status: jobStatus(j.status),
      startedAt: start ?? new Date().toISOString(),
      durationSec:
        start && end
          ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))
          : 0,
    };
  });

  // Roll job outcomes up into per-item health.
  const byItem = new Map<string, Job[]>();
  for (const j of jobs) {
    const a = byItem.get(j.itemFabricId) ?? [];
    a.push(j);
    byItem.set(j.itemFabricId, a);
  }
  for (const it of items) {
    const js = byItem.get(it.fabricId) ?? [];
    if (js.some((j) => j.status === "failed")) it.health = "failing";
    else if (js.some((j) => j.status === "completed")) {
      it.health = "healthy";
      it.lastRefresh = js[0].startedAt;
    }
  }

  // Workspace users + their access, from role assignments.
  const principals: Principal[] = [];
  const grants: Grant[] = [];
  for (const ra of raw.roleAssignments ?? []) {
    const p = (ra.principal ?? {}) as Record<string, unknown>;
    const details = (p.userDetails ?? {}) as Record<string, unknown>;
    const email = details.userPrincipalName as string | undefined;
    const isGuest = !!email && email.toUpperCase().includes("#EXT#");
    const kind: PrincipalKind =
      p.type === "Group"
        ? "group"
        : p.type === "ServicePrincipal"
          ? "servicePrincipal"
          : isGuest
            ? "guest"
            : "user";
    const name = String(p.displayName ?? email ?? p.id ?? "Unknown");
    const role = String(ra.role ?? "Viewer") as WorkspaceRole;
    principals.push({
      principalId: String(p.id ?? name),
      displayName: name,
      kind,
      email,
      external: isGuest,
      workspaceRole: role,
    });
    grants.push({
      principalRef: name,
      accessLevel: ROLE_TO_ACCESS[role] ?? "view",
      source: "workspaceRole",
      roleName: role,
      flag:
        role === "Admin"
          ? "admin"
          : kind === "servicePrincipal"
            ? "servicePrincipal"
            : kind === "guest"
              ? "external"
              : undefined,
    });
  }

  // Per-item access from the scanner (who can see each item, beyond workspace roles).
  const principalRefs = new Set(principals.map((p) => p.displayName));
  for (const g of raw.access ?? []) {
    const name = String(g.principalName || g.principalEmail || "Unknown");
    const email = g.principalEmail;
    const isGuest = !!email && email.toUpperCase().includes("#EXT#");
    const kind: PrincipalKind =
      g.principalType === "Group"
        ? "group"
        : g.principalType === "App" || g.principalType === "ServicePrincipal"
          ? "servicePrincipal"
          : isGuest
            ? "guest"
            : "user";
    if (!principalRefs.has(name)) {
      principalRefs.add(name);
      principals.push({
        principalId: String(email || name),
        displayName: name,
        kind,
        email: email || undefined,
        external: isGuest,
        workspaceRole: "Viewer",
      });
    }
    if (g.itemId && itemIds.has(g.itemId)) {
      grants.push({
        itemFabricId: g.itemId,
        principalRef: name,
        accessLevel: accessLevelFrom(g.accessRight),
        source: "directShare",
        roleName: g.accessRight || undefined,
        flag: isGuest ? "external" : kind === "servicePrincipal" ? "servicePrincipal" : undefined,
      });
    }
  }

  // Real lineage computed server-side by the UDF (item relations + report→model).
  // Fall back to the one edge we can assert locally (Lakehouse and its SQL endpoint).
  const edges: Edge[] = [];
  if (Array.isArray(raw.lineage) && raw.lineage.length) {
    for (const e of raw.lineage) {
      if (e.source && e.target && itemIds.has(e.source) && itemIds.has(e.target)) {
        edges.push({ source: e.source, target: e.target, relation: e.relation || "depends on" });
      }
    }
  } else {
    const lakes = items.filter((i) => i.itemType === "Lakehouse");
    for (const se of items.filter((i) => i.itemType === "SQLEndpoint")) {
      const n = se.displayName.toLowerCase();
      const lh = lakes.find((l) => n === l.displayName.toLowerCase() || n.includes(l.displayName.toLowerCase()));
      if (lh) edges.push({ source: lh.fabricId, target: se.fabricId, relation: "SQL endpoint" });
    }
  }

  const config: ConfigKV[] = (raw.config ?? [])
    .filter((c) => !!c.itemId && itemIds.has(c.itemId))
    .map((c) => ({
      itemFabricId: String(c.itemId),
      section: String(c.section || "General"),
      label: String(c.label || ""),
      value: String(c.value ?? ""),
    }));

  const ws = (raw.workspace ?? {}) as Record<string, unknown>;
  const workspace: WorkspaceInfo = {
    fabricId: String(ws.id ?? fallback.fabricId),
    displayName: String(ws.displayName ?? fallback.displayName),
    capacity: fallback.capacity,
    region: fallback.region,
  };

  return {
    workspace,
    items,
    edges,
    principals,
    grants,
    jobs,
    config,
    comments: [],
    syncRuns: [],
  };
}
