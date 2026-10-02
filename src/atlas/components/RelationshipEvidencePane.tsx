import {
  AlertTriangle,
  Check,
  Database,
  FlaskConical,
  Info,
  Network,
  Waypoints,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ItemRelationFlow,
  ItemRelationsComparisonStatus,
} from "../item-relations-evidence";
import {
  RELATIONSHIP_AGREEMENT_LABEL,
  type RelationshipAgreement,
  type RelationshipEndpoint,
  type RelationshipEvidence,
} from "../lineage-evidence";
import { snapshotRelationFamily } from "../lineage-relation-family";
import { relativeTime } from "../model";
import { cn } from "../ui";

const FLOW_LABEL: Record<ItemRelationFlow, string> = {
  data: "Data flow",
  control: "Orchestration",
  lifecycle: "Lifecycle",
  association: "Association",
  visibility: "Visibility",
  unknown: "Unknown relation type",
};

const COMPARISON_LABEL: Record<ItemRelationsComparisonStatus, string> = {
  matching: "Same direction as Atlas snapshot lineage.",
  "direction-conflict": "Opposite direction to Atlas snapshot lineage.",
  "preview-only": "Not present in Atlas snapshot lineage.",
  "unverified-direction":
    "Endpoints appear in Atlas snapshot lineage; the relation type has no documented direction.",
  "cross-workspace":
    "Not compared: Atlas snapshot lineage covers the scoped workspace only.",
  "not-lineage": "Not compared: visibility relations are not lineage.",
};

function agreementTone(agreement: RelationshipAgreement): string {
  switch (agreement) {
    case "conflict":
      return "border-status-warning/40 bg-status-warning/10 text-status-warning";
    case "agree":
      return "border-status-healthy/30 bg-status-healthy/10 text-status-healthy";
    case "unverified":
    case "preview-only":
    case "cross-workspace":
      return "border-lineage-upstream/35 bg-lineage-upstream/10 text-lineage-upstream";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function AgreementChip({
  agreement,
}: {
  agreement: RelationshipAgreement;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-xs whitespace-nowrap rounded-md border px-s py-xxs text-[length:var(--text-200)] font-semibold",
        agreementTone(agreement),
      )}
    >
      {agreement === "conflict" && (
        <AlertTriangle className="icon-size-100" aria-hidden="true" />
      )}
      {RELATIONSHIP_AGREEMENT_LABEL[agreement]}
    </span>
  );
}

function workspaceLabel(endpoint: RelationshipEndpoint): string {
  return endpoint.workspaceName ?? "Workspace name not reported";
}

function Fact({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="mt-xs flex items-center gap-s break-words text-300 text-foreground">
        {icon}
        <span className="min-w-0">{children}</span>
      </dd>
    </div>
  );
}

function SourceCard({
  badge,
  title,
  status,
  statusClass,
  meta,
  statement,
  source,
  confidence,
  children,
}: {
  badge: ReactNode;
  title: string;
  status: string;
  statusClass: string;
  meta?: string;
  statement: ReactNode;
  source: string;
  confidence: string;
  children?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-m shadow-fabric-2">
      <div className="flex items-start gap-m">
        {badge}
        <div className="min-w-0 flex-1">
          <div className="text-300 font-semibold text-foreground">
            {title} — <span className={statusClass}>{status}</span>
          </div>
          {meta && (
            <div className="text-200 text-muted-foreground">{meta}</div>
          )}
        </div>
      </div>
      <p className="mt-s rounded-md bg-secondary px-m py-s text-200 leading-200 text-foreground">
        {statement}
      </p>
      <dl className="mt-s grid grid-cols-2 gap-m text-200">
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="mt-xxs text-foreground">{source}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Confidence</dt>
          <dd className="mt-xxs text-foreground">{confidence}</dd>
        </div>
      </dl>
      {children}
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-xxs break-words text-foreground">{children}</dd>
    </div>
  );
}

function latest(values: readonly string[]): string | undefined {
  return [...values].sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

/**
 * Source-by-source provenance for one relationship. Each source keeps its own
 * statement and direction; nothing here reconciles or edits Atlas lineage.
 */
export function RelationshipEvidencePane({
  relationship,
  snapshotSyncedAt,
  itemNames,
  onClose,
  onReviewConflict,
  className,
}: {
  relationship: RelationshipEvidence;
  snapshotSyncedAt?: string;
  itemNames: ReadonlyMap<string, string>;
  onClose?: () => void;
  onReviewConflict?: (relationshipId: string) => void;
  className?: string;
}) {
  const { source, target } = relationship;
  const nameFor = (id: string) => itemNames.get(id.toLowerCase()) ?? id;
  const endpointName = (key: string) =>
    key === source.key
      ? source.displayName
      : key === target.key
        ? target.displayName
        : nameFor(key.slice(key.indexOf(":") + 1));
  const conflict = relationship.preview.find(
    (entry) => entry.status === "direction-conflict",
  );
  const types = [
    ...new Set([
      ...relationship.authoritative.map((edge) => edge.relation),
      ...relationship.preview.map((entry) => entry.edge.relation.relationType),
    ]),
  ];
  const headingId = `relationship-evidence-${relationship.id.replace(/[^a-z0-9-]/gi, "-")}`;
  const snapshotMeta = snapshotSyncedAt
    ? `Last collected ${relativeTime(snapshotSyncedAt)}`
    : "Collected with the synchronized snapshot";

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <header className="flex items-center gap-s border-b border-border px-l py-m">
        <Waypoints
          className="icon-size-300 shrink-0 text-brand-foreground"
          aria-hidden="true"
        />
        <h2 id={headingId} className="min-w-0 flex-1 text-500 font-semibold leading-500">
          Relationship evidence
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close relationship evidence"
            className="flex min-h-[var(--atlas-touch-target)] min-w-[var(--atlas-touch-target)] items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="icon-size-200" aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-l overflow-auto p-l">
        <div>
          <h3 className="break-words text-500 font-semibold leading-500">
            {source.displayName} <span aria-hidden="true">→</span>
            <span className="sr-only"> to </span> {target.displayName}
          </h3>
          <p className="mt-xxs break-words text-300 text-muted-foreground">
            {workspaceLabel(source)} <span aria-hidden="true">→</span>
            <span className="sr-only"> to </span> {workspaceLabel(target)}
          </p>
          {!conflict && (
            <div className="mt-s">
              <AgreementChip agreement={relationship.agreement} />
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-m border-b border-border pb-l">
          <Fact
            label="Type"
            icon={<Database className="icon-size-200 shrink-0 text-muted-foreground" aria-hidden="true" />}
          >
            {types.join(" · ") || "—"}
          </Fact>
          <Fact
            label="Workspace boundary"
            icon={<Network className="icon-size-200 shrink-0 text-muted-foreground" aria-hidden="true" />}
          >
            {relationship.crossWorkspace ? "Cross-workspace" : "Same workspace"}
          </Fact>
        </dl>

        <div>
          <h3 className="text-400 font-semibold">Evidence sources</h3>
          <ul className="mt-m flex flex-col gap-m">
            {relationship.authoritative.length > 0 ? (
              relationship.authoritative.map((edge) => {
                const sourceName = nameFor(edge.source);
                const targetName = nameFor(edge.target);
                return (
                  <SourceCard
                    key={`${edge.source}|${edge.target}|${edge.relation}`}
                    badge={
                      <span className="flex icon-size-500 shrink-0 items-center justify-center rounded-full bg-status-healthy text-background">
                        <Check className="icon-size-200" aria-hidden="true" />
                      </span>
                    }
                    title="Atlas snapshot"
                    status="Collected"
                    statusClass="text-status-healthy"
                    meta={snapshotMeta}
                    statement={
                      snapshotRelationFamily(edge.relation) === "data"
                        ? `Reports that ${targetName} uses data from ${sourceName} (${edge.relation}).`
                        : `Reports ${sourceName} → ${targetName} (${edge.relation}).`
                    }
                    source="Atlas snapshot sync"
                    confidence={edge.broken ? "Verified, marked broken" : "Verified"}
                  />
                );
              })
            ) : (
              <li className="rounded-lg border border-dashed border-border p-m text-200 leading-200 text-muted-foreground">
                Atlas snapshot lineage has no relationship between these
                items.
              </li>
            )}

            {relationship.preview.map(({ edge, status }) => {
              const observedAt = latest(
                edge.observations.map((observation) => observation.observedAt),
              );
              const statement =
                status === "direction-conflict"
                  ? `Reports an inverse relation (${endpointName(edge.sourceKey)} → ${endpointName(edge.targetKey)}).`
                  : `Reports that ${endpointName(edge.itemKey)} depends on ${endpointName(edge.dependentOnKey)} (${edge.relation.relationType}).`;
              return (
                <SourceCard
                  key={edge.id}
                  badge={
                    <span className="flex icon-size-500 shrink-0 items-center justify-center rounded-full bg-lineage-upstream text-background">
                      <FlaskConical className="icon-size-200" aria-hidden="true" />
                    </span>
                  }
                  title="Item Relations API"
                  status="Beta"
                  statusClass="text-lineage-upstream"
                  meta={observedAt ? `Observed ${relativeTime(observedAt)}` : undefined}
                  statement={statement}
                  source="Item Relations API (Beta)"
                  confidence={
                    edge.semantics.directionVerified
                      ? "Observed"
                      : "Observed, direction unverified"
                  }
                >
                  <details className="mt-s text-200">
                    <summary className="cursor-pointer font-semibold text-lineage-upstream">
                      Evidence details
                    </summary>
                    <dl className="mt-s grid grid-cols-2 gap-m">
                      <DetailRow label="Drawn as">
                        {endpointName(edge.sourceKey)} → {endpointName(edge.targetKey)}
                      </DetailRow>
                      <DetailRow label="Relation family">
                        {FLOW_LABEL[edge.semantics.flow]}
                      </DetailRow>
                      <DetailRow label="Reported by">
                        {edge.observations
                          .map(
                            (observation) =>
                              `${nameFor(observation.itemId)} (${observation.direction})`,
                          )
                          .join(", ")}
                      </DetailRow>
                      <DetailRow label="Comparison">{COMPARISON_LABEL[status]}</DetailRow>
                    </dl>
                    {edge.preserved && (
                      <p className="mt-s text-muted-foreground">
                        Preserved from an earlier collection because the
                        latest query failed.
                      </p>
                    )}
                    {edge.inCycle && (
                      <p className="mt-s text-muted-foreground">
                        Part of a dependency cycle in the Beta evidence.
                      </p>
                    )}
                  </details>
                </SourceCard>
              );
            })}
          </ul>
        </div>

        {conflict && relationship.authoritative[0] && (
          <div
            role="note"
            className="flex flex-wrap items-start gap-m rounded-lg border border-status-warning/40 bg-status-warning/10 p-m text-200 leading-200 text-foreground"
          >
            <AlertTriangle
              className="icon-size-300 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-status-warning">
                Direction differs between sources
              </p>
              <p className="mt-xxs">
                Atlas snapshot reports {nameFor(relationship.authoritative[0].source)} →{" "}
                {nameFor(relationship.authoritative[0].target)}, while the Item
                Relations API reports the opposite direction.
              </p>
            </div>
            {onReviewConflict && (
              <button
                type="button"
                onClick={() => onReviewConflict(relationship.id)}
                className="inline-flex min-h-[var(--atlas-touch-target)] items-center rounded-md border border-input bg-card px-l text-300 font-semibold text-foreground hover:bg-accent sm:min-h-[var(--atlas-control-height)]"
              >
                Review conflict
              </button>
            )}
          </div>
        )}

        <div
          role="note"
          className="flex items-start gap-m rounded-lg border border-fabric-blue/30 bg-fabric-blue/5 p-m text-200 leading-200 text-foreground"
        >
          <Info
            className="icon-size-300 shrink-0 text-fabric-blue"
            aria-hidden="true"
          />
          <p>
            <span className="font-semibold">Evidence remains separate.</span>{" "}
            Item Relations API evidence is Beta, for evaluation only, and never
            changes Atlas snapshot lineage.
          </p>
        </div>
      </div>
    </section>
  );
}
