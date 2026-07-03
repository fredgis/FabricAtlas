// Live Sync: acquire a Power BI token in the browser (MSAL), invoke the Fabric
// User Data Function `sync_all`, and map the Fabric REST payload onto the Atlas
// data model. See the "Why a Fabric User Data Function?" note in the README for
// why this hop through a server-side function is required.

import { ATLAS_CONFIG, getUdfUrl } from "./config";
import {
  ITEM_TYPES,
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
  errors?: string[];
}

export function isSyncConfigured(): boolean {
  return !!getUdfUrl();
}

export async function invokeSyncAll(workspaceId: string): Promise<RawSync> {
  const url = getUdfUrl();
  if (!url) {
    throw new Error(
      "Sync endpoint not configured yet — publish the atlas_sync_functions UDF and paste its invoke URL.",
    );
  }
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
  return typeof t === "string" && t in ITEM_TYPES ? (t as ItemType) : null;
}

function jobStatus(s: unknown): Job["status"] {
  const v = String(s ?? "").toLowerCase();
  if (v === "completed") return "completed";
  if (v === "failed" || v === "deduped") return "failed";
  if (v.includes("progress") || v === "notstarted") return "running";
  return "cancelled";
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

  // Deterministic lineage we can assert without the scanner API: a Lakehouse
  // and its auto-provisioned SQL endpoint.
  const edges: Edge[] = [];
  const lakes = items.filter((i) => i.itemType === "Lakehouse");
  for (const se of items.filter((i) => i.itemType === "SQLEndpoint")) {
    const lh =
      lakes.find((l) => se.displayName.includes(l.displayName)) ?? lakes[0];
    if (lh) edges.push({ source: lh.fabricId, target: se.fabricId, relation: "SQL endpoint" });
  }

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
    config: [],
    comments: [],
    syncRuns: [],
  };
}
