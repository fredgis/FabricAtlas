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

export function normalizeFabricTimestamp(
  value: unknown,
): string | undefined {
  const text = realText(value);
  if (!text) return undefined;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text}Z`;
  const date = new Date(zoned);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
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
  schemaVersion?: number;
  workspace?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  roleAssignments?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  lineage?: Array<{ source?: string; target?: string; relation?: string }>;
  access?: Array<{
    itemId?: string;
    principalId?: string;
    principalName?: string;
    principalEmail?: string;
    principalType?: string;
    userType?: string;
    tenantWide?: boolean;
    accessRight?: string;
  }>;
  config?: Array<{ itemId?: string; section?: string; label?: string; value?: string }>;
  sections?: Record<
    string,
    {
      status?: "complete" | "unsupported" | "failed";
      code?: string;
    }
  >;
  capabilities?: Record<
    "endorsement" | "sensitivity" | "tags" | "ownership",
    {
      status?: "complete" | "unsupported" | "failed";
      code?: string;
    }
  >;
  itemMetadata?: Record<
    string,
    {
      scannerMatched?: boolean;
      ownerAvailable?: boolean;
      configuredBy?: string;
      modifiedBy?: string;
      modifiedDateTime?: string;
      owner?: {
        principalId?: string;
        displayName?: string;
        email?: string;
        source?: string;
      };
      endorsement?: {
        value?: string;
        certifiedBy?: string;
      };
      sensitivity?: {
        labelId?: string;
        displayName?: string;
      };
      tags?: Array<{
        id?: string;
        displayName?: string;
      }>;
    }
  >;
  syncedAt?: string;
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

function itemEndorsement(value: unknown): Item["endorsement"] {
  const normalizedValue = normalized(value);
  if (normalizedValue === "certified") return "certified";
  if (normalizedValue === "promoted") return "promoted";
  return "none";
}

function finiteRowCount(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && !Array.isArray(value) && typeof value === "object";
}

function optionalText(value: unknown): boolean {
  return value == null || typeof value === "string";
}

function validateItemMetadata(
  value: RawSync["itemMetadata"],
  itemIds: Set<string>,
): void {
  if (value == null) return;
  if (!isRecord(value)) {
    throw new Error(
      "The sync result contained invalid item metadata. The previous snapshot was preserved.",
    );
  }
  for (const [itemId, metadata] of Object.entries(value)) {
    if (!itemIds.has(itemId) || !isRecord(metadata)) {
      throw new Error(
        "The sync result contained invalid item metadata. The previous snapshot was preserved.",
      );
    }
    if (
      metadata.scannerMatched != null &&
      typeof metadata.scannerMatched !== "boolean"
    ) {
      throw new Error(
        "The sync result contained invalid item metadata. The previous snapshot was preserved.",
      );
    }
    if (
      metadata.ownerAvailable != null &&
      typeof metadata.ownerAvailable !== "boolean"
    ) {
      throw new Error(
        "The sync result contained invalid item metadata. The previous snapshot was preserved.",
      );
    }
    for (const field of [
      "configuredBy",
      "modifiedBy",
      "modifiedDateTime",
    ] as const) {
      if (!optionalText(metadata[field])) {
        throw new Error(
          "The sync result contained invalid item metadata. The previous snapshot was preserved.",
        );
      }
    }
    for (const field of ["owner", "endorsement", "sensitivity"] as const) {
      if (metadata[field] != null && !isRecord(metadata[field])) {
        throw new Error(
          "The sync result contained invalid item metadata. The previous snapshot was preserved.",
        );
      }
    }
    if (
      (isRecord(metadata.owner) &&
        (!optionalText(metadata.owner.principalId) ||
          !optionalText(metadata.owner.displayName) ||
          !optionalText(metadata.owner.email) ||
          !optionalText(metadata.owner.source))) ||
      (isRecord(metadata.endorsement) &&
        (!optionalText(metadata.endorsement.value) ||
          !optionalText(metadata.endorsement.certifiedBy))) ||
      (isRecord(metadata.sensitivity) &&
        (!optionalText(metadata.sensitivity.labelId) ||
          !optionalText(metadata.sensitivity.displayName)))
    ) {
      throw new Error(
        "The sync result contained invalid item metadata. The previous snapshot was preserved.",
      );
    }
    if (
      metadata.tags != null &&
      (!Array.isArray(metadata.tags) ||
        metadata.tags.some(
          (tag) =>
            !isRecord(tag) ||
            !optionalText(tag.id) ||
            !optionalText(tag.displayName),
        ))
    ) {
      throw new Error(
        "The sync result contained invalid item metadata. The previous snapshot was preserved.",
      );
    }
  }
}

function validatedSyncSections(
  sections: RawSync["sections"],
): WorkspaceInfo["syncSections"] {
  if (!sections) return undefined;
  if (Array.isArray(sections) || typeof sections !== "object") {
    throw new Error(
      "The sync result contained invalid section status. The previous snapshot was preserved.",
    );
  }
  const result: NonNullable<WorkspaceInfo["syncSections"]> = {};
  for (const [name, section] of Object.entries(sections)) {
    if (
      !section ||
      typeof section !== "object" ||
      (section.status !== "complete" &&
        section.status !== "unsupported" &&
        section.status !== "failed")
    ) {
      throw new Error(
        "The sync result contained invalid section status. The previous snapshot was preserved.",
      );
    }
    result[name] = {
      status: section.status,
      code: realText(section.code),
    };
  }
  return result;
}

const REQUIRED_ARRAYS = [
  "items",
  "roleAssignments",
  "jobs",
  "lineage",
  "access",
  "config",
] as const;

const REQUIRED_V2_SECTIONS = [
  "workspace",
  "items",
  "roleAssignments",
  "scanner",
  "schema",
  "lineage",
  "access",
  "config",
] as const;
const MAX_SYNC_RESPONSE_BYTES = 26 * 1024 * 1024;

export function parseSyncResponseText(
  text: string,
  maxBytes = MAX_SYNC_RESPONSE_BYTES,
): RawSync {
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(
      "Fabric returned a sync payload that exceeded the Atlas safety limit. The previous snapshot was preserved.",
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "Fabric returned an invalid sync response. The previous snapshot was preserved.",
    );
  }
  if (!isRecord(json)) {
    throw new Error(
      "Fabric returned an invalid sync response. The previous snapshot was preserved.",
    );
  }
  return (json.output ?? json.body ?? json) as RawSync;
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes = MAX_SYNC_RESPONSE_BYTES,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(
        "Fabric returned a sync payload that exceeded the Atlas safety limit. The previous snapshot was preserved.",
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(
        "Fabric returned a sync payload that exceeded the Atlas safety limit. The previous snapshot was preserved.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function validateRawSync(
  raw: RawSync,
  expectedWorkspaceId: string,
): void {
  if (
    raw.schemaVersion != null &&
    raw.schemaVersion !== 1 &&
    raw.schemaVersion !== 2
  ) {
    throw new Error(
      "The sync result used an unsupported schema version. The previous snapshot was preserved.",
    );
  }
  const sections = validatedSyncSections(raw.sections);
  const capabilities = validatedSyncSections(raw.capabilities);
  if (!Array.isArray(raw.errors)) {
    throw new Error(
      "The sync result did not include completion status. The previous snapshot was preserved.",
    );
  }
  if (raw.errors.some((error) => typeof error !== "string")) {
    throw new Error(
      "The sync result contained invalid completion status. The previous snapshot was preserved.",
    );
  }
  if (raw.schemaVersion === 2) {
    if (!sections) {
      throw new Error(
        "The sync result did not include section status. The previous snapshot was preserved.",
      );
    }
    if (
      !capabilities ||
      [
        "endorsement",
        "sensitivity",
        "tags",
        "ownership",
      ].some((name) => capabilities[name] == null)
    ) {
      throw new Error(
        "The sync result did not include metadata capability status. The previous snapshot was preserved.",
      );
    }
    const failedRequired = REQUIRED_V2_SECTIONS.filter(
      (name) => sections[name]?.status !== "complete",
    );
    if (failedRequired.length > 0) {
      console.warn(
        "[atlas] Fabric sync returned incomplete required sections",
        failedRequired,
      );
      throw new Error(
        `Fabric returned an incomplete sync (${failedRequired.join(", ")}). The previous snapshot was preserved.`,
      );
    }
  } else if (raw.errors.length > 0) {
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
  if (
    raw.roleAssignments?.some(
      (assignment) =>
        !isRecord(assignment) ||
        !realText(assignment.role) ||
        !isRecord(assignment.principal),
    ) === true ||
    raw.lineage?.some(
      (edge) =>
        !isRecord(edge) ||
        !realText(edge.source) ||
        !realText(edge.target) ||
        !optionalText(edge.relation),
    ) === true ||
    raw.access?.some(
      (grant) =>
        !isRecord(grant) ||
        !optionalText(grant.itemId) ||
        !optionalText(grant.principalId) ||
        !optionalText(grant.principalName) ||
        !optionalText(grant.principalEmail) ||
        !optionalText(grant.principalType) ||
        !optionalText(grant.userType) ||
        (grant.tenantWide != null &&
          typeof grant.tenantWide !== "boolean") ||
        !optionalText(grant.accessRight) ||
        (!realText(grant.principalId) &&
          !realText(grant.principalName) &&
          !realText(grant.principalEmail) &&
          grant.tenantWide !== true),
    ) === true ||
    raw.config?.some(
      (entry) =>
        !isRecord(entry) ||
        !realText(entry.itemId) ||
        !realText(entry.section) ||
        !realText(entry.label) ||
        !optionalText(entry.value),
    ) === true ||
    raw.jobs?.some(
      (job) =>
        !isRecord(job) ||
        !realText(job.itemId) ||
        !realText(job.jobType) ||
        !realText(job.status) ||
        (job.startTimeUtc != null &&
          normalizeFabricTimestamp(job.startTimeUtc) == null) ||
        (job.endTimeUtc != null &&
          normalizeFabricTimestamp(job.endTimeUtc) == null),
    ) === true
  ) {
    throw new Error(
      "The sync result contained malformed section records. The previous snapshot was preserved.",
    );
  }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.roleAssignments)) {
    throw new Error(
      "The sync result was missing mandatory catalog data. The previous snapshot was preserved.",
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
  validateItemMetadata(
    raw.itemMetadata,
    new Set(itemIds.filter((id): id is string => !!id)),
  );
  if (
    raw.schemaVersion === 2 &&
    (!raw.itemMetadata ||
      itemIds.some((itemId) => {
        if (!itemId) return true;
        const metadata = raw.itemMetadata?.[itemId];
        return (
          !metadata ||
          typeof metadata.scannerMatched !== "boolean"
        );
      }))
  ) {
    throw new Error(
      "The sync result did not include complete item metadata status. The previous snapshot was preserved.",
    );
  }
  for (const [itemId, tables] of Object.entries(raw.schema)) {
    if (!itemIds.includes(itemId) || !Array.isArray(tables)) {
      throw new Error(
        "The sync result contained invalid object schema. The previous snapshot was preserved.",
      );
    }
    for (const table of tables) {
      if (!table || typeof table !== "object" || !realText(table.name)) {
        throw new Error(
          "The sync result contained invalid object schema. The previous snapshot was preserved.",
        );
      }
      if (
        table.rows != null &&
        finiteRowCount(table.rows) == null
      ) {
        throw new Error(
          "The sync result contained a non-numeric row count. The previous snapshot was preserved.",
        );
      }
      if (
        !Array.isArray(table.columns) ||
        !Array.isArray(table.measures)
      ) {
        throw new Error(
          "The sync result contained invalid object schema. The previous snapshot was preserved.",
        );
      }
      if (
        table.columns.some(
          (column) =>
            !isRecord(column) ||
            !realText(column.name) ||
            !optionalText(column.dataType) ||
            !optionalText(column.description) ||
            (column.isHidden != null &&
              typeof column.isHidden !== "boolean"),
        ) ||
        table.measures.some(
          (measure) =>
            !isRecord(measure) ||
            !realText(measure.name) ||
            !optionalText(measure.expression) ||
            !optionalText(measure.expr) ||
            !optionalText(measure.description) ||
            (measure.isHidden != null &&
              typeof measure.isHidden !== "boolean"),
        )
      ) {
        throw new Error(
          "The sync result contained invalid object schema. The previous snapshot was preserved.",
        );
      }
    }
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
  const contentLength = Number(resp.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_SYNC_RESPONSE_BYTES
  ) {
    throw new Error(
      "Fabric returned a sync payload that exceeded the Atlas safety limit. The previous snapshot was preserved.",
    );
  }
  // Fabric UDF wraps the return under `output`; accept a raw body too.
  const result = parseSyncResponseText(
    await readBoundedResponseText(resp),
  );
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

function canonicalPrincipalId(value: unknown): string | undefined {
  const text = realText(value);
  if (!text) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text,
  ) || text.includes("@")
    ? text.toLowerCase()
    : text;
}

export function mapSyncToAtlas(raw: RawSync, fallback: WorkspaceInfo): AtlasData {
  const syncSections = validatedSyncSections(raw.sections);
  const metadataCapabilities = validatedSyncSections(raw.capabilities);
  const items: Item[] = (raw.items ?? [])
    .map((it): Item | null => {
      const fabricId = realText(it.id);
      const type = toItemType(it.type);
      if (!fabricId || !type) {
        throw new Error("Cannot map malformed Fabric item metadata.");
      }
      const metadata = raw.itemMetadata?.[fabricId];
      const scannerMatched = metadata?.scannerMatched;
      const tagEntries = Array.isArray(metadata?.tags)
        ? metadata.tags
        : [];
      const endorsementRaw = realText(
        metadata?.endorsement?.value,
      );
      const sensitivityLabelId = realText(
        metadata?.sensitivity?.labelId,
      );
      const sensitivity = realText(
        metadata?.sensitivity?.displayName,
      );
      const ownerName = realText(metadata?.owner?.displayName);
      const ownerEmail = realText(metadata?.owner?.email);
      return {
        fabricId,
        displayName: realText(it.displayName) ?? fabricId,
        itemType: type,
        description: realText(it.description),
        ownerName,
        ownerEmail,
        configuredBy: realText(metadata?.configuredBy),
        modifiedBy: realText(metadata?.modifiedBy),
        health: "unknown" as Health,
        endorsement: itemEndorsement(endorsementRaw),
        endorsementRaw,
        endorsementBy: realText(metadata?.endorsement?.certifiedBy),
        sensitivity,
        sensitivityLabelId,
        tags: tagEntries
          .map((tag) => realText(tag.displayName))
          .filter((tag): tag is string => !!tag),
        tagIds: tagEntries
          .map((tag) => realText(tag.id))
          .filter((tag): tag is string => !!tag),
        ownerMetadataAvailable:
          metadata == null
            ? undefined
            : metadataCapabilities?.ownership?.status === "complete"
              ? metadata.ownerAvailable ??
                metadata.owner != null
              : false,
        sensitivityMetadataAvailable:
          metadata == null
            ? undefined
            : scannerMatched === true &&
              (metadataCapabilities?.sensitivity?.status ?? "complete") ===
                "complete",
        endorsementMetadataAvailable:
          metadata == null
            ? undefined
            : scannerMatched === true &&
              (metadataCapabilities?.endorsement?.status ?? "complete") ===
                "complete",
        tagMetadataAvailable:
          metadata == null
            ? undefined
            : scannerMatched === true &&
              (metadataCapabilities?.tags?.status ?? "complete") ===
                "complete",
        updatedAt: normalizeFabricTimestamp(metadata?.modifiedDateTime),
      };
    })
    .filter((x): x is Item => x !== null);

  const itemIds = new Set(items.map((i) => i.fabricId));

  const jobs: Job[] = (raw.jobs ?? []).map((j) => {
    const start = normalizeFabricTimestamp(j.startTimeUtc);
    const end = normalizeFabricTimestamp(j.endTimeUtc);
    return {
      itemFabricId: String(j.itemId ?? ""),
      itemName: String(j.itemDisplayName ?? j.itemId ?? ""),
      jobType: String(j.jobType ?? "Job"),
      status: jobStatus(j.status),
      startedAt: start ?? new Date(0).toISOString(),
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
  const principalsById = new Map<string, Principal>();
  const upsertPrincipal = (principal: Principal): Principal => {
    const canonicalId =
      canonicalPrincipalId(principal.principalId) ??
      principal.principalId;
    principal.principalId = canonicalId;
    const key = normalized(canonicalId);
    const existing = principalsById.get(key);
    if (existing) {
      if (!existing.email && principal.email) existing.email = principal.email;
      existing.external = existing.external || principal.external;
      return existing;
    }
    principalsById.set(key, principal);
    principals.push(principal);
    return principal;
  };
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
    const principalId =
      canonicalPrincipalId(p.id ?? email ?? name) ?? name;
    const role = String(ra.role ?? "Viewer") as WorkspaceRole;
    upsertPrincipal({
      principalId,
      displayName: name,
      kind,
      email,
      external: isGuest,
      workspaceRole: role,
    });
    grants.push({
      principalRef: principalId,
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
  for (const g of raw.access ?? []) {
    const tenantWide =
      g.tenantWide === true ||
      normalized(g.principalType) === "entiretenant" ||
      normalized(g.principalType) === "none";
    const name = tenantWide
      ? "Entire tenant"
      : String(g.principalName || g.principalEmail || "Unknown");
    const email = g.principalEmail;
    const isGuest = !!email && email.toUpperCase().includes("#EXT#");
    const kind: PrincipalKind =
      tenantWide || g.principalType === "Group"
        ? "group"
        : g.principalType === "App" || g.principalType === "ServicePrincipal"
          ? "servicePrincipal"
          : isGuest
            ? "guest"
            : "user";
    const explicitPrincipalId = canonicalPrincipalId(g.principalId);
    const existingById = explicitPrincipalId
      ? principalsById.get(normalized(explicitPrincipalId))
      : undefined;
    const emailMatches = email
      ? principals.filter(
          (principal) =>
            normalized(principal.email) === normalized(email),
        )
      : [];
    const nameMatches = principals.filter(
      (principal) =>
        normalized(principal.displayName) === normalized(name),
    );
    const principalId =
      existingById?.principalId ??
      explicitPrincipalId ??
      (emailMatches.length === 1
        ? emailMatches[0].principalId
        : undefined) ??
      (nameMatches.length === 1
        ? nameMatches[0].principalId
        : undefined) ??
      canonicalPrincipalId(email) ??
      (tenantWide ? "entire-tenant" : name);
    upsertPrincipal({
      principalId,
      displayName: name,
      kind,
      email: email || undefined,
      external: isGuest,
      workspaceRole: "Viewer",
    });
    if (g.itemId && itemIds.has(g.itemId)) {
      grants.push({
        itemFabricId: g.itemId,
        principalRef: principalId,
        accessLevel: accessLevelFrom(g.accessRight),
        source: "directShare",
        roleName: g.accessRight || undefined,
        flag: tenantWide
          ? "broad"
          : isGuest
            ? "external"
            : kind === "servicePrincipal"
              ? "servicePrincipal"
              : undefined,
      });
    }
  }

  // Real lineage is computed server-side from Fabric and Power BI identifiers.
  // An absent edge is safer than inferring a relationship from display names.
  const edges: Edge[] = [];
  if (Array.isArray(raw.lineage) && raw.lineage.length) {
    for (const e of raw.lineage) {
      if (e.source && e.target && itemIds.has(e.source) && itemIds.has(e.target)) {
        edges.push({ source: e.source, target: e.target, relation: e.relation || "depends on" });
      }
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
      rows: finiteRowCount(t.rows),
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
    capacity: realText(ws.capacityId) ?? fallback.capacity,
    region: realText(ws.capacityRegion) ?? fallback.region,
    syncedAt: normalizeFabricTimestamp(raw.syncedAt),
    syncSections: {
      ...(syncSections ?? {}),
      ...Object.fromEntries(
        Object.entries(metadataCapabilities ?? {}).map(([name, status]) => [
          `metadata${name[0].toUpperCase()}${name.slice(1)}`,
          status,
        ]),
      ),
    },
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
