import {
  buildGovernanceFindings,
  DORMANT_PRODUCER_TYPES,
  type GovernanceFinding,
} from "./governance";
import type { FindingAcknowledgement } from "./finding-acks";
import type { AtlasData, Item, Job } from "./model";
import { csvCell } from "./access-export";

/**
 * Retirement candidate radar: combines existing deterministic evidence into a
 * human review list. It never claims an item is unused or safe to delete,
 * because read usage, ad-hoc queries and external tools are not observed.
 */
export type RetirementSignalId =
  | "dormant"
  | "no-consumer"
  | "failed-runs"
  | "no-owner"
  | "no-trust"
  | "duplicate-name";

/** Signals that point at retirement on their own; the others only add context. */
const RETIREMENT_SIGNALS: ReadonlySet<RetirementSignalId> = new Set([
  "dormant",
  "no-consumer",
  "failed-runs",
  "duplicate-name",
]);

export const RETIREMENT_SIGNAL_ORDER: readonly RetirementSignalId[] = [
  "dormant",
  "no-consumer",
  "failed-runs",
  "no-owner",
  "no-trust",
  "duplicate-name",
];

export const RETIREMENT_SIGNAL_LABELS: Record<RetirementSignalId, string> = {
  dormant: "Dormant",
  "no-consumer": "No downstream consumer",
  "failed-runs": "Failing runs",
  "no-owner": "No owner",
  "no-trust": "No trust metadata",
  "duplicate-name": "Duplicate name",
};

/** Minimum combined signals before an item is listed. */
export const RETIREMENT_MIN_SIGNALS = 2;
/** Minimum collected runs before failing runs count as a signal. */
export const RETIREMENT_MIN_FAILED_RUNS = 2;

const DORMANT_RULES = ["dormant-producer", "item-inactive", "endorsed-inactive"] as const;

export interface RetirementSignal {
  id: RetirementSignalId;
  detail: string;
  /** Governance rule ids or evidence ids the signal is derived from. */
  evidence: string[];
}

export interface RetirementCandidate {
  /** Stable review key, also used for personal review state. */
  id: string;
  item: Item;
  signals: RetirementSignal[];
  /** Signals that could not be evaluated because their evidence is incomplete. */
  unknown: RetirementSignalId[];
  context: {
    owner?: string;
    sensitivity?: string;
    endorsement: Item["endorsement"];
    upstream: number;
    downstream: number;
    principals: number;
    externalPrincipals: number;
    recentJobs: Job[];
  };
}

export interface RetirementRadar {
  candidates: RetirementCandidate[];
  /** Candidate count per signal, for the signal profile chart. */
  profile: Record<RetirementSignalId, number>;
  /** Items that would need incomplete evidence to be evaluated. */
  unknownItems: number;
}

export function retirementCandidateId(itemId: string): string {
  return `retirement:${itemId.toLowerCase()}`;
}

function meaningful(value: string | undefined): boolean {
  return !!value && value.trim().length > 0;
}

/** Lowercase name without copy markers such as " (copy)", " - Copy" or " (2)". */
export function normalizedRetirementName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-_]?\s*\(?\bcopy\b(?:\s*\d+)?\)?\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findingsByItem(findings: readonly GovernanceFinding[]): Map<string, Map<string, GovernanceFinding>> {
  const byItem = new Map<string, Map<string, GovernanceFinding>>();
  for (const finding of findings) {
    if (!finding.itemId) continue;
    const rule = finding.id.split(":")[0];
    const rules = byItem.get(finding.itemId) ?? new Map<string, GovernanceFinding>();
    if (!rules.has(rule)) rules.set(rule, finding);
    byItem.set(finding.itemId, rules);
  }
  return byItem;
}

export function buildRetirementRadar(
  data: Pick<AtlasData, "workspace" | "items" | "principals" | "grants" | "jobs" | "edges"> &
    Partial<Pick<AtlasData, "schema" | "governanceEvidence" | "config" | "connections">>,
  findings: readonly GovernanceFinding[] = buildGovernanceFindings(data),
): RetirementRadar {
  const sections = data.workspace.syncSections;
  const lineageComplete = sections?.lineage?.status === "complete";
  const jobsKnown = sections?.jobs?.status !== "failed";
  const rulesByItem = findingsByItem(findings);
  const live = data.edges.filter((edge) => !edge.broken && edge.source !== edge.target);
  const downstream = new Map<string, number>();
  const upstream = new Map<string, number>();
  for (const edge of live) {
    downstream.set(edge.source, (downstream.get(edge.source) ?? 0) + 1);
    upstream.set(edge.target, (upstream.get(edge.target) ?? 0) + 1);
  }
  const jobsByItem = new Map<string, Job[]>();
  for (const job of data.jobs) {
    jobsByItem.set(job.itemFabricId, [...(jobsByItem.get(job.itemFabricId) ?? []), job]);
  }
  const names = new Map<string, number>();
  for (const item of data.items) {
    const key = `${item.itemType}\u0000${normalizedRetirementName(item.displayName)}`;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const workspacePrincipals = new Set(
    data.grants.filter((grant) => !grant.itemFabricId).map((grant) => grant.principalRef),
  );
  const external = new Set(data.principals.filter((principal) => principal.external).map((principal) => principal.principalId));

  const candidates: RetirementCandidate[] = [];
  let unknownItems = 0;
  for (const item of data.items) {
    const rules = rulesByItem.get(item.fabricId) ?? new Map<string, GovernanceFinding>();
    const signals: RetirementSignal[] = [];
    const unknown: RetirementSignalId[] = [];

    const dormantRule = DORMANT_RULES.find((rule) => rules.has(rule));
    if (dormantRule) {
      signals.push({ id: "dormant", detail: rules.get(dormantRule)!.detail, evidence: [dormantRule] });
    }

    if (DORMANT_PRODUCER_TYPES.has(item.itemType)) {
      if (!lineageComplete) unknown.push("no-consumer");
      else if (!downstream.get(item.fabricId)) {
        signals.push({
          id: "no-consumer",
          detail: `No downstream item is recorded for this ${item.itemType} in the synchronized scope.`,
          evidence: [`item:${item.fabricId}:lineage:downstream:0`],
        });
      }
    }

    const runs = [...(jobsByItem.get(item.fabricId) ?? [])].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    if (!jobsKnown) unknown.push("failed-runs");
    else if (runs.length >= RETIREMENT_MIN_FAILED_RUNS && runs.every((job) => job.status === "failed")) {
      signals.push({
        id: "failed-runs",
        detail: `All ${runs.length} collected recent runs failed.`,
        evidence: ["failed-job"],
      });
    }

    if (rules.has("missing-owner")) {
      signals.push({ id: "no-owner", detail: "No owner is recorded for this item.", evidence: ["missing-owner"] });
    }

    if (item.endorsement === "none" && !meaningful(item.sensitivity) && !meaningful(item.description)) {
      signals.push({
        id: "no-trust",
        detail: "Not endorsed, no sensitivity label and no description.",
        evidence: [`item:${item.fabricId}:endorsement`, `item:${item.fabricId}:sensitivity`, `item:${item.fabricId}:description`],
      });
    }

    const nameKey = `${item.itemType}\u0000${normalizedRetirementName(item.displayName)}`;
    if ((names.get(nameKey) ?? 0) > 1) {
      signals.push({
        id: "duplicate-name",
        detail: `${names.get(nameKey)! - 1} other ${item.itemType} with the same name in this workspace.`,
        evidence: [`item:${item.fabricId}:name`],
      });
    }

    const listed = signals.length >= RETIREMENT_MIN_SIGNALS && signals.some((signal) => RETIREMENT_SIGNALS.has(signal.id));
    if (!listed) {
      if (unknown.length && signals.length + unknown.length >= RETIREMENT_MIN_SIGNALS) unknownItems += 1;
      continue;
    }
    const itemPrincipals = new Set([
      ...workspacePrincipals,
      ...data.grants.filter((grant) => grant.itemFabricId === item.fabricId).map((grant) => grant.principalRef),
    ]);
    candidates.push({
      id: retirementCandidateId(item.fabricId),
      item,
      signals,
      unknown,
      context: {
        owner: meaningful(item.ownerName) ? item.ownerName : meaningful(item.ownerEmail) ? item.ownerEmail : undefined,
        sensitivity: meaningful(item.sensitivity) ? item.sensitivity : undefined,
        endorsement: item.endorsement,
        upstream: upstream.get(item.fabricId) ?? 0,
        downstream: downstream.get(item.fabricId) ?? 0,
        principals: itemPrincipals.size,
        externalPrincipals: [...itemPrincipals].filter((id) => external.has(id)).length,
        recentJobs: runs.slice(0, 3),
      },
    });
  }
  candidates.sort((left, right) =>
    right.signals.length - left.signals.length || left.item.displayName.localeCompare(right.item.displayName));
  const profile = Object.fromEntries(RETIREMENT_SIGNAL_ORDER.map((id) => [
    id,
    candidates.filter((candidate) => candidate.signals.some((signal) => signal.id === id)).length,
  ])) as Record<RetirementSignalId, number>;
  return { candidates, profile, unknownItems };
}

export type RetirementReviewState = "open" | "follow-up" | "reviewed" | "muted";

/** Note stored on an acknowledgement to mark a candidate for follow-up. */
export const RETIREMENT_FOLLOW_UP_NOTE = "follow-up";
const REVIEWED_PREFIX = "reviewed:";

export function retirementSignature(candidate: RetirementCandidate): string {
  return candidate.signals.map((signal) => signal.id).sort().join(",");
}

/** Review note recording the signals seen when the candidate was reviewed. */
export function retirementReviewedNote(candidate: RetirementCandidate): string {
  return `${REVIEWED_PREFIX}${retirementSignature(candidate)}`;
}

/**
 * Personal review state. A review only holds while the signals are unchanged,
 * so a new signal reopens the candidate; follow-up and mute persist.
 */
export function retirementReviewState(
  candidate: RetirementCandidate,
  acknowledgement: FindingAcknowledgement | undefined,
): RetirementReviewState {
  if (!acknowledgement) return "open";
  if (acknowledgement.status === "muted") return "muted";
  if (acknowledgement.note === RETIREMENT_FOLLOW_UP_NOTE) return "follow-up";
  return acknowledgement.note === retirementReviewedNote(candidate) ? "reviewed" : "open";
}

export interface RetirementExportRow {
  candidate: RetirementCandidate;
  state: RetirementReviewState;
}

function signalList(candidate: RetirementCandidate): string {
  return candidate.signals.map((signal) => RETIREMENT_SIGNAL_LABELS[signal.id]).join("; ");
}

export function retirementCandidatesToCsv(rows: readonly RetirementExportRow[]): string {
  const header = ["Item", "Type", "Item ID", "Signals", "Signal count", "Unknown evidence", "Owner", "Sensitivity", "Endorsement", "Downstream items", "Principals", "Review"];
  const lines = rows.map(({ candidate, state }) => [
    candidate.item.displayName,
    candidate.item.itemType,
    candidate.item.fabricId,
    signalList(candidate),
    candidate.signals.length,
    candidate.unknown.map((id) => RETIREMENT_SIGNAL_LABELS[id]).join("; "),
    candidate.context.owner ?? "",
    candidate.context.sensitivity ?? "",
    candidate.context.endorsement,
    candidate.context.downstream,
    candidate.context.principals,
    state,
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

function markdownCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function retirementCandidatesToMarkdown(
  rows: readonly RetirementExportRow[],
  workspaceName: string,
  syncedAt?: string,
): string {
  const lines = [
    `# Retirement candidates: ${workspaceName}`,
    "",
    `Snapshot: ${syncedAt ?? "unknown"}. ${rows.length} candidate${rows.length === 1 ? "" : "s"} for human review.`,
    "Atlas does not claim that any item is unused or safe to delete: read usage, ad-hoc queries and external tools are not observed.",
    "",
    "| Item | Type | Signals | Owner | Downstream | Review |",
    "|---|---|---|---|---|---|",
    ...rows.map(({ candidate, state }) => `| ${[
      candidate.item.displayName,
      candidate.item.itemType,
      signalList(candidate),
      candidate.context.owner ?? "None recorded",
      candidate.context.downstream,
      state,
    ].map(markdownCell).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}
