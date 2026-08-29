// Live Sync: acquire a Power BI token in the browser (MSAL), invoke the Fabric
// User Data Function `sync_all`, and map the Fabric REST payload onto the Atlas
// data model. See the "Why a Fabric User Data Function?" note in the README for
// why this hop through a server-side function is required.

import { ATLAS_CONFIG, getUdfUrl } from "./config";
import { normalizeLineageEdges } from "./lineage";
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
  type ModelTableSchema,
} from "./model";

/* -------------------------------- MSAL --------------------------------- */

export interface SyncIdentity {
  id?: string;
  name: string;
  email?: string;
}

export interface MsalAccount {
  homeAccountId?: string;
  localAccountId?: string;
  tenantId?: string;
  username?: string;
  idTokenClaims?: Record<string, unknown>;
}

interface MsalResult {
  accessToken: string;
  account?: MsalAccount | null;
}

// Loosely typed to avoid pulling MSAL types into the module graph eagerly.
let msalApp: {
  initialize: () => Promise<void>;
  getAllAccounts: () => MsalAccount[];
  acquireTokenSilent: (r: unknown) => Promise<MsalResult>;
  ssoSilent: (r: unknown) => Promise<MsalResult>;
  acquireTokenPopup: (r: unknown) => Promise<MsalResult>;
} | null = null;
let msalInitPromise: Promise<void> | null = null;

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function realText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.toLowerCase() === "undefined" || text.toLowerCase() === "null") {
    return undefined;
  }
  return text;
}

function accountValues(account: MsalAccount): Set<string> {
  const claims = account.idTokenClaims ?? {};
  const values = [
    account.homeAccountId,
    account.homeAccountId?.split(".")[0],
    account.localAccountId,
    account.username,
    claims.oid,
    claims.sub,
    claims.email,
    claims.preferred_username,
    claims.upn,
    claims.unique_name,
  ]
    .map(normalized)
    .filter(Boolean);
  return new Set(values);
}

export function accountMatchesIdentity(
  account: MsalAccount,
  identity: Pick<SyncIdentity, "id" | "email">,
): boolean {
  const expected = [identity.id, identity.email]
    .map(normalized)
    .filter(Boolean);
  if (expected.length === 0) return false;
  const values = accountValues(account);
  return expected.some((value) => values.has(value));
}

export function selectMsalAccount(
  accounts: MsalAccount[],
  identity: Pick<SyncIdentity, "id" | "email">,
  expectedTenantId?: string,
): MsalAccount | undefined {
  const tenantId = normalized(expectedTenantId);
  return accounts.find(
    (account) =>
      (!tenantId || normalized(account.tenantId) === tenantId) &&
      accountMatchesIdentity(account, identity),
  );
}

function tokenForIdentity(result: MsalResult, identity: SyncIdentity): string {
  if (
    !result.account ||
    !selectMsalAccount([result.account], identity, ATLAS_CONFIG.tenantId)
  ) {
    throw new Error(
      "The Power BI sign-in did not match the current Fabric user. The previous snapshot was preserved.",
    );
  }
  return result.accessToken;
}

async function acquireToken(identity: SyncIdentity): Promise<string> {
  if (!identity.id && !identity.email) {
    throw new Error(
      "The current Fabric user could not be identified. The previous snapshot was preserved.",
    );
  }
  const { PublicClientApplication } = await import("@azure/msal-browser");
  if (!msalApp) {
    msalApp = new PublicClientApplication({
      auth: {
        clientId: ATLAS_CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${ATLAS_CONFIG.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: "sessionStorage",
        temporaryCacheLocation: "sessionStorage",
      },
    }) as unknown as typeof msalApp;
    msalInitPromise = msalApp!.initialize();
  }
  try {
    await msalInitPromise;
  } catch (error) {
    msalApp = null;
    msalInitPromise = null;
    throw error;
  }
  const scopes = [ATLAS_CONFIG.scope];
  const account = selectMsalAccount(
    msalApp!.getAllAccounts(),
    identity,
    ATLAS_CONFIG.tenantId,
  );
  try {
    const res = account
      ? await msalApp!.acquireTokenSilent({ scopes, account })
      : await msalApp!.ssoSilent({ scopes, loginHint: identity.email });
    return tokenForIdentity(res, identity);
  } catch {
    // Silent SSO can be blocked inside the Fabric iframe (3rd-party cookies);
    // force an explicit account choice rather than reusing another user's cache.
    const res = await msalApp!.acquireTokenPopup({
      scopes,
      loginHint: identity.email,
      prompt: "select_account",
    });
    return tokenForIdentity(res, identity);
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
  schema?: Record<
    string,
    Array<{
      name?: string;
      rows?: number;
      objectType?: string;
      source?: string;
      description?: string;
      isHidden?: boolean;
      columns?: Array<{
        name?: string;
        dataType?: string;
        description?: string;
        isHidden?: boolean;
      }>;
      measures?: Array<{
        name?: string;
        expression?: string;
        expr?: string;
        description?: string;
        isHidden?: boolean;
      }>;
    }>
  >;
  errors?: string[];
}

const REQUIRED_ARRAYS = [
  "items",
  "roleAssignments",
  "jobs",
  "lineage",
  "access",
  "config",
] as const;

export function validateRawSync(
  raw: RawSync,
  expectedWorkspaceId: string,
): void {
  if (!Array.isArray(raw.errors)) {
    throw new Error(
      "The sync result did not include completion status. The previous snapshot was preserved.",
    );
  }
  if (raw.errors.length > 0) {
    const sources = [
      ...new Set(
        raw.errors.map((error) => String(error).split(":", 1)[0].trim()),
      ),
    ].filter(Boolean);
    console.warn("[atlas] Fabric sync returned incomplete sections", sources);
    throw new Error(
      `Fabric returned an incomplete sync${sources.length ? ` (${sources.join(", ")})` : ""}. The previous snapshot was preserved.`,
    );
  }
  if (!raw.workspace || typeof raw.workspace !== "object") {
    throw new Error(
      "The sync result did not include workspace metadata. The previous snapshot was preserved.",
    );
  }
  const returnedWorkspaceId = normalized(raw.workspace.id);
  if (
    !returnedWorkspaceId ||
    returnedWorkspaceId !== normalized(expectedWorkspaceId)
  ) {
    throw new Error(
      "The sync result was for a different workspace. The previous snapshot was preserved.",
    );
  }
  for (const field of REQUIRED_ARRAYS) {
    if (!Array.isArray(raw[field])) {
      throw new Error(
        `The sync result was missing ${field}. The previous snapshot was preserved.`,
      );
    }
  }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.roleAssignments)) {
    throw new Error(
      "The sync result was missing mandatory catalog data. The previous snapshot was preserved.",
    );
  }
  if (raw.items.length === 0) {
    throw new Error(
      "Fabric returned no workspace items. The previous snapshot was preserved.",
    );
  }
  if (raw.roleAssignments.length === 0) {
    throw new Error(
      "Fabric returned no workspace role assignments. The previous snapshot was preserved.",
    );
  }
  if (!raw.schema || typeof raw.schema !== "object" || Array.isArray(raw.schema)) {
    throw new Error(
      "The sync result was missing object schema. The previous snapshot was preserved.",
    );
  }
  const itemIds = raw.items.map((item) => realText(item?.id));
  const invalidItem = raw.items.some((item) => {
    const itemType = realText(item?.type);
    return (
      !item ||
      typeof item !== "object" ||
      !realText(item.id) ||
      !itemType ||
      itemType.toLowerCase() === "item"
    );
  });
  if (invalidItem) {
    throw new Error(
      "Fabric returned invalid workspace item metadata. The previous snapshot was preserved.",
    );
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error(
      "Fabric returned duplicate workspace item IDs. The previous snapshot was preserved.",
    );
  }
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

export async function invokeSyncAll(
  workspaceId: string,
  identity: SyncIdentity,
): Promise<RawSync> {
  const raw = getUdfUrl();
  if (!raw) {
    throw new Error(
      "Sync endpoint not configured yet — publish the atlas_sync_functions UDF and paste its invoke URL.",
    );
  }
  const url = retargetToSyncAll(raw);
  const token = await acquireToken(identity);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fabricToken: token, workspaceId }),
  });
  if (!resp.ok) {
    console.warn("[atlas] UDF invocation failed", resp.status);
    throw new Error(
      `Fabric sync failed (HTTP ${resp.status}). The previous snapshot was preserved.`,
    );
  }
  const json = (await resp.json()) as Record<string, unknown>;
  // Fabric UDF wraps the return under `output`; accept a raw body too.
  const result = (json.output ?? json.body ?? json) as RawSync;
  validateRawSync(result, workspaceId);
  return result;
}

/* ------------------------------ mapping -------------------------------- */

const ROLE_TO_ACCESS: Record<string, "owner" | "edit" | "view"> = {
  Admin: "owner",
  Member: "edit",
  Contributor: "edit",
  Viewer: "view",
};

export function toItemType(t: unknown): ItemType | null {
  // Keep every real workspace item; unknown types render with a neutral glyph.
  const value = realText(t);
  return value && value.toLowerCase() !== "item"
    ? (value as ItemType)
    : null;
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
      const fabricId = realText(it.id);
      const type = toItemType(it.type);
      if (!fabricId || !type) {
        throw new Error("Cannot map malformed Fabric item metadata.");
      }
      return {
        fabricId,
        displayName: realText(it.displayName) ?? fabricId,
        itemType: type,
        description: realText(it.description),
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

  const schema: Record<string, ModelTableSchema[]> = {};
  for (const [id, tables] of Object.entries(raw.schema ?? {})) {
    if (!itemIds.has(id) || !Array.isArray(tables)) continue;
    schema[id] = tables.map((t) => ({
      name: String(t.name ?? ""),
      rows: t.rows,
      objectType: t.objectType,
      source: t.source,
      description: t.description,
      isHidden: t.isHidden,
      columns: (t.columns ?? []).map((c) => ({
        name: String(c.name ?? ""),
        dataType: String(c.dataType ?? "column"),
        description: c.description,
        isHidden: c.isHidden,
      })),
      measures: (t.measures ?? []).map((m) => ({
        name: String(m.name ?? ""),
        expr: m.expression ?? m.expr,
        description: m.description,
        isHidden: m.isHidden,
      })),
    }));
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
    edges: normalizeLineageEdges(items, edges),
    principals,
    grants,
    jobs,
    config,
    schema,
    comments: [],
    syncRuns: [],
  };
}
