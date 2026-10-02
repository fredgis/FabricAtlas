import {
  AlertTriangle,
  CircleCheck,
  FlaskConical,
  Info,
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="mt-xxs break-words text-300 font-semibold text-foreground">
        {children}
      </dd>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  status,
  statusClass,
  meta,
  children,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  statusClass: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-m shadow-fabric-2">
      <div className="flex items-start gap-s">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-300 font-semibold text-foreground">
            {title} — <span className={statusClass}>{status}</span>
          </div>
          {meta && (
            <div className="mt-xxs text-200 text-muted-foreground">{meta}</div>
          )}
        </div>
      </div>
      <div className="mt-s flex flex-col gap-s text-200 leading-200 text-foreground">
        {children}
      </div>
    </li>
  );
}

function Statement({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-secondary px-s py-xs text-200 leading-200 text-foreground">
      {children}
    </p>
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
  className,
}: {
  relationship: RelationshipEvidence;
  snapshotSyncedAt?: string;
  itemNames: ReadonlyMap<string, string>;
  onClose?: () => void;
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
  const authoritativeRelations = [
    ...new Set(relationship.authoritative.map((edge) => edge.relation)),
  ];
  const previewTypes = [
    ...new Set(
      relationship.preview.map((entry) => entry.edge.relation.relationType),
    ),
  ];
  const headingId = `relationship-evidence-${relationship.id.replace(/[^a-z0-9-]/gi, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <header className="flex items-center gap-s border-b border-border px-l py-m">
        <Waypoints
          className="icon-size-200 shrink-0 text-brand-foreground"
          aria-hidden="true"
        />
        <h2 id={headingId} className="min-w-0 flex-1 text-400 font-semibold">
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
          <p className="mt-xxs break-words text-200 text-muted-foreground">
            {workspaceLabel(source)} → {workspaceLabel(target)}
          </p>
          <div className="mt-s">
            <AgreementChip agreement={relationship.agreement} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-m">
          <Fact label="Type">
            {[...authoritativeRelations, ...previewTypes].join(" · ") || "—"}
          </Fact>
          <Fact label="Workspace boundary">
            {relationship.crossWorkspace ? "Cross-workspace" : "Same workspace"}
          </Fact>
        </dl>

        <div>
          <h3 className="text-300 font-semibold">Evidence sources</h3>
          <ul className="mt-s flex flex-col gap-s">
            {relationship.authoritative.length > 0 ? (
              relationship.authoritative.map((edge) => (
                <SourceCard
                  key={`${edge.source}|${edge.target}|${edge.relation}`}
                  icon={
                    <CircleCheck
                      className="icon-size-300 shrink-0 text-status-healthy"
                      aria-hidden="true"
                    />
                  }
                  title="Atlas snapshot"
                  status="Verified"
                  statusClass="text-status-healthy"
                  meta={
                    snapshotSyncedAt
                      ? `Synchronized ${relativeTime(snapshotSyncedAt)}`
                      : "Synchronized snapshot"
                  }
                >
                  <Statement>
                    {nameFor(edge.source)} → {nameFor(edge.target)} ·{" "}
                    {edge.relation}
                  </Statement>
                  <p className="text-muted-foreground">
                    Source: Fabric scanner, item definitions and item
                    properties, normalized from source to consumer.
                  </p>
                  {edge.broken && (
                    <p className="font-semibold text-destructive">
                      Marked as a broken reference.
                    </p>
                  )}
                </SourceCard>
              ))
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
              return (
                <SourceCard
                  key={edge.id}
                  icon={
                    <FlaskConical
                      className="icon-size-300 shrink-0 text-lineage-upstream"
                      aria-hidden="true"
                    />
                  }
                  title="Item Relations API"
                  status="Beta"
                  statusClass="text-lineage-upstream"
                  meta={
                    observedAt
                      ? `Observed ${relativeTime(observedAt)}`
                      : undefined
                  }
                >
                  <Statement>
                    {endpointName(edge.itemKey)} depends on{" "}
                    {endpointName(edge.dependentOnKey)} ·{" "}
                    {edge.relation.relationType}
                  </Statement>
                  <dl className="grid grid-cols-2 gap-s">
                    <Fact label="Drawn as">
                      {endpointName(edge.sourceKey)} →{" "}
                      {endpointName(edge.targetKey)}
                    </Fact>
                    <Fact label="Relation family">
                      {FLOW_LABEL[edge.semantics.flow]}
                    </Fact>
                    <Fact label="Direction">
                      {edge.semantics.directionVerified
                        ? "Documented"
                        : "Unverified"}
                    </Fact>
                    <Fact label="Reported by">
                      {edge.observations
                        .map(
                          (observation) =>
                            `${nameFor(observation.itemId)} (${observation.direction})`,
                        )
                        .join(", ")}
                    </Fact>
                  </dl>
                  <p className="text-muted-foreground">
                    {COMPARISON_LABEL[status]}
                  </p>
                  {edge.preserved && (
                    <p className="text-muted-foreground">
                      Preserved from an earlier collection because the latest
                      query failed.
                    </p>
                  )}
                  {edge.inCycle && (
                    <p className="text-muted-foreground">
                      Part of a dependency cycle in the Beta evidence.
                    </p>
                  )}
                </SourceCard>
              );
            })}
          </ul>
        </div>

        {conflict && relationship.authoritative[0] && (
          <div
            role="note"
            className="flex items-start gap-s rounded-lg border border-status-warning/40 bg-status-warning/10 p-m text-200 leading-200 text-foreground"
          >
            <AlertTriangle
              className="icon-size-200 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">Direction differs between sources</p>
              <p className="mt-xxs">
                Atlas snapshot reports{" "}
                {nameFor(relationship.authoritative[0].source)} →{" "}
                {nameFor(relationship.authoritative[0].target)}, while the Item
                Relations API reports {endpointName(conflict.edge.sourceKey)} →{" "}
                {endpointName(conflict.edge.targetKey)}.
              </p>
            </div>
          </div>
        )}

        <div
          role="note"
          className="flex items-start gap-s rounded-lg border border-border bg-secondary p-m text-200 leading-200 text-foreground"
        >
          <Info
            className="icon-size-200 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p>
            <span className="font-semibold">Evidence stays separate.</span>{" "}
            Item Relations API evidence is Beta and never changes Atlas
            snapshot lineage.
          </p>
        </div>
      </div>
    </section>
  );
}
