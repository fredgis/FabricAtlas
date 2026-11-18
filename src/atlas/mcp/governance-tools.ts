import { findingDomainKey, NO_DOMAIN_KEY, UNKNOWN_DOMAIN_KEY } from "../domain-governance";
import { domainReference } from "../governance-evidence";
import { findingFixUrl } from "../fabric-portal";
import { findingRule } from "../finding-groups";
import {
  buildGovernanceFindings,
  type GovernanceFinding,
  type GovernanceSeverity,
} from "../governance";
import type { ConnectionInventoryView } from "../connections";
import type { AtlasData, Item, Principal } from "../model";
import { buildOffboardingReport, connectionAction } from "../offboarding";
import { MICROSOFT_PILLAR_LABEL, microsoftPillarForFinding } from "../ms-pillars";
import { buildSnapshotManifest, snapshotPayload } from "../snapshot-export";
import type { AtlasMcpToolArguments } from "./arguments";
import {
  ATLAS_MCP_LIMITS,
  truncateText,
  type AtlasMcpCoverage,
  type AtlasMcpSource,
} from "./contract";

// Governance findings and snapshot export for MCP clients. Both reuse the UI
// helpers over the validated snapshot; neither writes to or calls Fabric.

// The MCP host runs outside Vite, so the portal base is passed explicitly.
const FABRIC_PORTAL = "https://app.fabric.microsoft.com";
const MAX_EVIDENCE_IDS = 10;

export interface GovernanceToolOutcome {
  result: object;
  sources: AtlasMcpSource[];
  coverage: AtlasMcpCoverage;
  limitations: string[];
}

const SEVERITY_RANK: Record<GovernanceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function source(data: AtlasData, entities: string[]): AtlasMcpSource {
  return {
    id: "atlas-snapshot",
    label: "Validated Atlas snapshot",
    authority: "authoritative",
    entities,
    observedAt: data.workspace.syncedAt,
  };
}

function page(
  status: AtlasMcpCoverage["status"],
  returned: number,
  total: number,
  offset: number,
  notes: string[] = [],
): AtlasMcpCoverage {
  return { status, returned, total, truncated: offset + returned < total, notes };
}

function nextOffset(offset: number, returned: number, total: number): number | null {
  return offset + returned < total ? offset + returned : null;
}

type FindingOwnerStatus = "known" | "unknown" | "workspace";

function ownerStatus(
  finding: GovernanceFinding,
  owners: ReadonlyMap<string, boolean>,
): FindingOwnerStatus {
  if (!finding.itemId) return "workspace";
  return owners.get(finding.itemId) ? "known" : "unknown";
}

export function governanceFindings(
  data: AtlasData,
  args: AtlasMcpToolArguments["atlas_get_governance_findings"],
): GovernanceToolOutcome {
  const items = new Map(data.items.map((item) => [item.fabricId, item]));
  const owners = new Map(
    data.items.map((item) => [item.fabricId, !!item.ownerEmail?.trim()]),
  );
  const itemId = args.itemId?.toLowerCase();
  const all = buildGovernanceFindings(data);
  const matches = all
    .map((finding) => ({
      finding,
      rule: findingRule(finding),
      pillar: microsoftPillarForFinding(finding),
      domain: findingDomainKey(finding, data.workspace.fabricDomainId),
      owner: ownerStatus(finding, owners),
    }))
    .filter(
      (entry) =>
        (!args.severities.length || args.severities.includes(entry.finding.severity)) &&
        (!args.categories.length || args.categories.includes(entry.finding.category)) &&
        (!args.pillars.length || args.pillars.includes(entry.pillar)) &&
        (!args.domain || entry.domain === args.domain) &&
        (!args.rule || entry.rule === args.rule) &&
        (!itemId || entry.finding.itemId?.toLowerCase() === itemId) &&
        (args.owner === "any" || entry.owner === args.owner),
    )
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.finding.severity] - SEVERITY_RANK[right.finding.severity] ||
        (left.finding.id < right.finding.id ? -1 : left.finding.id > right.finding.id ? 1 : 0),
    );
  const rows = matches.slice(args.offset, args.offset + args.limit);
  const domainInfo = (key: string) =>
    domainReference(
      data.governanceEvidence,
      key === NO_DOMAIN_KEY ? "unassigned" : key === UNKNOWN_DOMAIN_KEY ? undefined : key,
    );
  const unknownOwners = matches.filter((entry) => entry.owner === "unknown").length;
  return {
    result: {
      findings: rows.map(({ finding, rule, pillar, domain, owner }) => {
        const item = finding.itemId ? items.get(finding.itemId) : undefined;
        return {
          findingId: finding.id,
          rule,
          severity: finding.severity,
          category: finding.category,
          pillar,
          pillarLabel: MICROSOFT_PILLAR_LABEL[pillar],
          domain,
          domainName: domainInfo(domain).name,
          domainPath: domainInfo(domain).path,
          parentDomainName: domainInfo(domain).parentName,
          title: truncateText(finding.title) ?? "",
          detail: truncateText(finding.detail, ATLAS_MCP_LIMITS.findingText) ?? null,
          recommendation:
            truncateText(finding.recommendation, ATLAS_MCP_LIMITS.findingText) ?? null,
          evidenceIds: finding.evidenceIds.slice(0, MAX_EVIDENCE_IDS),
          target: finding.target?.kind ?? (finding.itemId ? "item" : "workspace"),
          item: item
            ? { itemId: item.fabricId, name: item.displayName, itemType: item.itemType }
            : finding.itemId
              ? { itemId: finding.itemId, name: null, itemType: null }
              : null,
          ownerStatus: owner,
          fixUrl: findingFixUrl(finding, data, FABRIC_PORTAL),
        };
      }),
      countsBySeverity: Object.fromEntries(
        (Object.keys(SEVERITY_RANK) as GovernanceSeverity[]).map((severity) => [
          severity,
          matches.filter((entry) => entry.finding.severity === severity).length,
        ]),
      ),
      totalFindings: all.length,
      offset: args.offset,
      nextOffset: nextOffset(args.offset, rows.length, matches.length),
    },
    sources: [
      source(data, ["FabricItem", "Principal", "AccessGrant", "JobRun", "LineageEdge", "GovernanceEvidence"]),
    ],
    coverage: page("complete", rows.length, matches.length, args.offset, [
      ...(unknownOwners
        ? [`${unknownOwners} matching item finding(s) have an owner Fabric did not expose (ownerStatus unknown).`]
        : []),
    ]),
    limitations: [
      "Findings are recomputed from the validated snapshot with the same rules as the Governance view; a missing signal is reported as Unknown, never as healthy.",
      "Owner emails are withheld; ownerStatus only tells whether Fabric exposed an owner.",
      "Atlas is read-only: fixUrl opens the item or workspace in Fabric where the change is made.",
    ],
  };
}

const WITHHELD_KEYS = new Set([
  "ownerEmail",
  "email",
  "userPrincipalName",
  "configuredBy",
  "modifiedBy",
  "endorsementBy",
  "message",
]);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function redact(value: unknown): unknown {
  if (typeof value === "string") return EMAIL_LIKE.test(value) ? "[withheld]" : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        WITHHELD_KEYS.has(key) && entry !== undefined && entry !== null && entry !== ""
          ? "[withheld]"
          : redact(entry),
      ]),
    );
  }
  return value;
}

export function exportSnapshot(
  data: AtlasData,
  args: AtlasMcpToolArguments["atlas_export_snapshot"],
): GovernanceToolOutcome {
  const manifest = buildSnapshotManifest(data);
  const limitations = [
    "The manifest fingerprint covers the complete export downloaded from Governance › Export snapshot; MCP pages withhold email-like values and job messages, so they cannot be hashed back to it.",
    "Comments and synchronization audit rows are not part of the export.",
  ];
  if (!args.section) {
    return {
      result: { manifest, section: null, rows: [], offset: 0, nextOffset: null },
      sources: [source(data, ["Workspace", "SnapshotManifest"])],
      coverage: page("complete", 0, 0, 0, [
        "Pass section (items, edges, principals, grants, jobs or config) to page through the snapshot rows.",
      ]),
      limitations,
    };
  }
  const rows = snapshotPayload(data)[args.section] as readonly unknown[];
  const slice = rows.slice(args.offset, args.offset + args.limit);
  return {
    result: {
      manifest,
      section: args.section,
      rows: slice.map(redact),
      offset: args.offset,
      nextOffset: nextOffset(args.offset, slice.length, rows.length),
    },
    sources: [source(data, ["Workspace", "SnapshotManifest", args.section])],
    coverage: page("complete", slice.length, rows.length, args.offset),
    limitations,
  };
}

const PRINCIPAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DepartureConnectionState =
  | { status: "available"; inventory: ConnectionInventoryView }
  | { status: "not-collected" | "unavailable" };

type DepartureResolution = "resolved" | "ambiguous" | "unresolved";

function lower(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function principalRef(principal: Principal) {
  return {
    principalId: principal.principalId,
    displayName: principal.displayName,
    kind: principal.kind,
    ...(principal.external ? { external: true } : {}),
  };
}

function departureItem(item: Item) {
  return { itemId: item.fabricId, name: item.displayName, itemType: item.itemType };
}

/**
 * Strict identity match: Entra object ID, or user principal name against the
 * recorded email. A display name never resolves; matching ones are returned
 * as candidates so the caller can retry with an ID.
 */
function resolveDeparturePrincipal(data: AtlasData, input: string): {
  resolution: DepartureResolution;
  matchedOn: "object-id" | "upn" | "display-name" | "none";
  principal?: Principal;
  candidates: Principal[];
} {
  const value = lower(input);
  const byId = data.principals.filter((principal) => lower(principal.principalId) === value);
  if (PRINCIPAL_UUID.test(value) || byId.length) {
    return byId.length === 1
      ? { resolution: "resolved", matchedOn: "object-id", principal: byId[0], candidates: byId }
      : { resolution: byId.length ? "ambiguous" : "unresolved", matchedOn: byId.length ? "object-id" : "none", candidates: byId };
  }
  if (value.includes("@")) {
    const byUpn = data.principals.filter((principal) => lower(principal.email) === value);
    return byUpn.length === 1
      ? { resolution: "resolved", matchedOn: "upn", principal: byUpn[0], candidates: byUpn }
      : { resolution: byUpn.length ? "ambiguous" : "unresolved", matchedOn: byUpn.length ? "upn" : "none", candidates: byUpn };
  }
  const byName = data.principals.filter((principal) => lower(principal.displayName) === value);
  return {
    resolution: byName.length ? "ambiguous" : "unresolved",
    matchedOn: byName.length ? "display-name" : "none",
    candidates: byName,
  };
}

export function departurePack(
  data: AtlasData,
  args: AtlasMcpToolArguments["atlas_get_departure_pack"],
  connections: DepartureConnectionState,
): GovernanceToolOutcome {
  const identity = resolveDeparturePrincipal(data, args.principal);
  const candidates = [...identity.candidates]
    .sort((left, right) => (left.principalId < right.principalId ? -1 : 1))
    .slice(0, ATLAS_MCP_LIMITS.principalCandidates)
    .map(principalRef);
  const sources: AtlasMcpSource[] = [
    source(data, ["Principal", "AccessGrant", "FabricItem", "LineageEdge"]),
  ];
  const limitations = [
    "Ownership is limited to documented type-specific Fabric metadata; items without owner evidence are listed as unknown, never as safe.",
    "Group membership is not expanded: grants through a group the principal belongs to are not attributed to it.",
    "Reassignment candidates are deterministic suggestions from lineage and ownership, not approvals.",
    "Owner emails are withheld; principals are returned by object ID, display name and kind.",
    "Atlas is read-only: it never revokes access, reassigns owners or changes Fabric connections.",
  ];
  if (identity.resolution !== "resolved" || !identity.principal) {
    return {
      result: {
        resolution: identity.resolution,
        matchedOn: identity.matchedOn,
        candidates,
        blocked: true,
        message:
          identity.resolution === "ambiguous"
            ? "Several principals match. Retry with the Entra object ID of one candidate."
            : "No principal of the snapshot matches. Pass an Entra object ID or user principal name.",
      },
      sources,
      coverage: page("unavailable", 0, 0, 0, [
        "Ownership, orphan risk and reassignment are blocked until the principal resolves to exactly one identity.",
      ]),
      limitations,
    };
  }

  const inventory = connections.status === "available" ? connections.inventory : undefined;
  const report = buildOffboardingReport(
    { ...data, connections: inventory ?? data.connections },
    identity.principal.principalId,
  );
  if (inventory) {
    sources.push({
      id: "atlas-connection-inventory",
      label: "Tenant connection inventory (admin connections API, Preview)",
      authority: "non-authoritative",
      entities: ["ConnectionInventory", "ConnectionEntry", "ConnectionRoleAssignment"],
      observedAt: inventory.collectedAt,
      maturity: "preview",
    });
  }
  const orphan = new Map(report.orphanRisk.map((risk) => [risk.item.fabricId, risk.consumers]));
  const reassign = new Map(report.reassignment.map((entry) => [entry.item.fabricId, entry]));
  const ownership = [...report.ownership].sort(
    (left, right) =>
      ({ sole: 0, indeterminate: 1, shared: 2 })[left.status] -
        ({ sole: 0, indeterminate: 1, shared: 2 })[right.status] ||
      (orphan.get(right.item.fabricId)?.length ?? 0) - (orphan.get(left.item.fabricId)?.length ?? 0) ||
      (left.item.fabricId < right.item.fabricId ? -1 : 1),
  );
  const owned = ownership.slice(args.offset, args.offset + args.limit);
  const connectionRows = report.connections.slice(args.offset, args.offset + args.limit);
  const total = Math.max(ownership.length, report.connections.length);
  const returned = Math.max(owned.length, connectionRows.length);
  const notes = [
    ...(report.workspaceOwnershipCoverage.unknown
      ? [`${report.workspaceOwnershipCoverage.unknown} of ${report.workspaceOwnershipCoverage.total} items have no documented ownership evidence and need separate review.`]
      : []),
    ...(connections.status !== "available" && !data.connections
      ? ["The tenant connection inventory is not available: connection ownership is unknown, not zero."]
      : []),
    ...(report.connectionCoverage.unknown
      ? [`${report.connectionCoverage.unknown} connection role lookups were skipped or failed: the principal may still hold a role there.`]
      : []),
    ...(report.connectionCoverage.personal
      ? [`${report.connectionCoverage.personal} personal connections expose no roles and are not checked.`]
      : []),
  ];
  return {
    result: {
      resolution: "resolved",
      matchedOn: identity.matchedOn,
      subject: principalRef(identity.principal),
      kind: report.kind,
      blocked: false,
      summary: {
        soleOwned: report.soleOwned.length,
        sharedOwned: report.ownership.filter((entry) => entry.status === "shared").length,
        indeterminateOwnership: report.indeterminateOwnership.length,
        orphanRisks: report.orphanRisk.length,
        blastRadius: report.blastRadius.length,
        privilegedReview: report.privilegedReview.length,
        identityDependencies: report.identityDependencies.length,
        appDefaultIdentities: report.identityDependencies.filter((entry) =>
          entry.evidence.includes("app-default-identity")).length,
        connections: report.connections.length,
        connectionRisks: report.connectionRisk.length,
      },
      ownership: owned.map((entry) => {
        const suggestion = reassign.get(entry.item.fabricId);
        return {
          item: departureItem(entry.item),
          status: entry.status,
          otherOwners: entry.otherOwners.map(principalRef),
          uncertainOwnerRefs: entry.uncertainOwnerRefs.length,
          downstreamConsumers: orphan.get(entry.item.fabricId)?.length ?? 0,
          reassignment: suggestion
            ? {
                reasonCode: suggestion.reasonCode,
                reason: truncateText(suggestion.reason) ?? "",
                candidate: suggestion.suggested ? principalRef(suggestion.suggested) : null,
              }
            : null,
        };
      }),
      privilegedReview: report.privilegedReview.slice(0, args.limit).map((entry) => ({
        item: departureItem(entry.item),
        evidence: entry.evidence,
        accessLevel: entry.accessLevel ?? null,
      })),
      connections: connectionRows.map((entry) => ({
        connectionId: entry.connection.id,
        displayName: entry.connection.displayName,
        roles: entry.roles,
        match: entry.match,
        status: entry.status,
        urgent: entry.urgent,
        otherOwners: entry.otherOwners.length,
        usedBy: entry.usages.length,
        action: connectionAction(entry),
      })),
      connectionCoverage: {
        status: report.connectionCoverage.available ? "available" : connections.status,
        collectedAt: report.connectionCoverage.collectedAt ?? null,
        checked: report.connectionCoverage.checked,
        unknown: report.connectionCoverage.unknown,
        personal: report.connectionCoverage.personal,
      },
      warnings: report.warnings.map((warning) => truncateText(warning) ?? ""),
      offset: args.offset,
      nextOffset: nextOffset(args.offset, returned, total),
    },
    sources,
    coverage: page(
      report.connectionCoverage.available && !report.connectionCoverage.unknown ? "complete" : "partial",
      returned,
      total,
      args.offset,
      notes,
    ),
    limitations,
  };
}
