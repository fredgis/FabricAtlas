import {
  AlertTriangle,
  ChevronRight,
  CircleCheck,
  FlaskConical,
  Search,
  Waypoints,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { ItemRelationsEvidenceState } from "../item-relations-evidence-source";
import {
  RELATIONSHIP_AGREEMENT_LABEL,
  RELATIONSHIP_AGREEMENT_ORDER,
  relationshipMatches,
  type LineageEvidenceModel,
  type RelationshipAgreement,
} from "../lineage-evidence";
import { relativeTime, type ItemType } from "../model";
import { cn, TypeGlyph } from "../ui";
import { AgreementChip, RelationshipEvidencePane } from "./RelationshipEvidencePane";

const PAGE_SIZE = 100;

function MetricTile({
  icon,
  tone,
  value,
  label,
  detail,
}: {
  icon: ReactNode;
  tone: string;
  value: number | string;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-m rounded-lg border border-border bg-card px-l py-m shadow-fabric-2">
      <span
        className={cn(
          "flex icon-size-700 shrink-0 items-center justify-center rounded-lg",
          tone,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-numeric text-500 font-bold leading-500">{value}</div>
        <div className="text-300 font-semibold">{label}</div>
        <div className="text-200 text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function PreviewCoverage({
  model,
  state,
}: {
  model: LineageEvidenceModel;
  state: ItemRelationsEvidenceState;
}) {
  if (state.status !== "ready" || !model.previewGraph) return null;
  const graph = model.previewGraph;
  const failureCodes = new Map<string, number>();
  for (const query of state.evidence.queries) {
    if (query.failureCode) {
      failureCodes.set(
        query.failureCode,
        (failureCodes.get(query.failureCode) ?? 0) + 1,
      );
    }
  }
  return (
    <section
      aria-label="Item Relations evidence coverage"
      className="rounded-lg border border-lineage-upstream/30 bg-lineage-upstream/5 p-m text-200 leading-200"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s">
        <h3 className="text-300 font-semibold">Item Relations coverage</h3>
        <span
          className="text-muted-foreground"
          title={state.evidence.collectedAt}
        >
          Collected {relativeTime(state.evidence.collectedAt)}
        </span>
      </div>
      <dl className="mt-s grid grid-cols-2 gap-s sm:grid-cols-5">
        {[
          ["Complete queries", graph.coverage.complete],
          ["Preserved queries", graph.coverage.preserved],
          ["Failed queries", graph.coverage.failed],
          ["Unresolved relations", graph.unresolved.length],
          ["Cycles", graph.cycles.length],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-numeric text-300 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {state.coverage?.sampledItemCount != null &&
        state.coverage.workspaceItemCount != null && (
          <p className="mt-s text-muted-foreground">
            Root items queried: {state.coverage.sampledItemCount} of{" "}
            {state.coverage.workspaceItemCount}.
            {state.coverage.sampledItemCount <
            state.coverage.workspaceItemCount
              ? " Relationships of the remaining items are not covered."
              : ""}
            {state.coverage.stopReasons.length > 0
              ? ` Collection stopped early: ${state.coverage.stopReasons.join(", ")}.`
              : ""}
          </p>
        )}
      {failureCodes.size > 0 && (
        <p className="mt-s text-muted-foreground">
          Failure codes:{" "}
          {[...failureCodes.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([code, count]) => `${code} (${count})`)
            .join(", ")}
          . Missing responses are not treated as missing dependencies.
        </p>
      )}
      {graph.unresolved.length > 0 && (
        <p className="mt-xs text-muted-foreground">
          Unresolved relations reference items whose workspace was not
          reported or is ambiguous; they stay in the raw evidence and are not
          drawn.
        </p>
      )}
    </section>
  );
}

/** Evidence tab: every relationship, its sources and their agreement. */
export function LineageEvidencePanel({
  model,
  previewState,
  snapshotSyncedAt,
  itemNames,
  selectedId,
  onSelect,
  agreement: controlledAgreement,
  onAgreementChange,
}: {
  model: LineageEvidenceModel;
  previewState: ItemRelationsEvidenceState;
  snapshotSyncedAt?: string;
  itemNames: ReadonlyMap<string, string>;
  selectedId: string;
  onSelect: (id: string) => void;
  agreement?: RelationshipAgreement | "all";
  onAgreementChange?: (agreement: RelationshipAgreement | "all") => void;
}) {
  const [query, setQuery] = useState("");
  const [localAgreement, setLocalAgreement] = useState<RelationshipAgreement | "all">(
    "all",
  );
  const agreement = controlledAgreement ?? localAgreement;
  const setAgreement = onAgreementChange ?? setLocalAgreement;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const previewReady = previewState.status === "ready";
  const filtered = useMemo(
    () =>
      model.relationships.filter(
        (relationship) =>
          (agreement === "all" || relationship.agreement === agreement) &&
          relationshipMatches(relationship, query),
      ),
    [agreement, model.relationships, query],
  );
  const selected = model.byId.get(selectedId);
  const withPreview = model.relationships.filter(
    (relationship) => relationship.preview.length > 0,
  ).length;
  const withSnapshot = model.relationships.filter(
    (relationship) => relationship.authoritative.length > 0,
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-m overflow-auto p-l xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-m">
        <div className="grid gap-s sm:grid-cols-2 2xl:grid-cols-4">
          <MetricTile
            icon={<Waypoints className="icon-size-300" aria-hidden="true" />}
            tone="bg-primary/10 text-brand-foreground"
            value={model.relationships.length}
            label="Relationships"
            detail={`${withSnapshot} in Atlas snapshot lineage`}
          />
          {previewReady ? (
            <>
              <MetricTile
                icon={<CircleCheck className="icon-size-300" aria-hidden="true" />}
                tone="bg-status-healthy/10 text-status-healthy"
                value={model.counts.agree}
                label="Sources agree"
                detail="Same direction in both sources"
              />
              <MetricTile
                icon={<AlertTriangle className="icon-size-300" aria-hidden="true" />}
                tone="bg-status-warning/10 text-status-warning"
                value={model.counts.conflict}
                label={model.counts.conflict === 1 ? "Conflict to review" : "Conflicts to review"}
                detail="Direction differs between sources"
              />
              <MetricTile
                icon={<FlaskConical className="icon-size-300" aria-hidden="true" />}
                tone="bg-lineage-upstream/10 text-lineage-upstream"
                value={withPreview}
                label="Item Relations (Beta)"
                detail="Relationships with Beta evidence"
              />
            </>
          ) : (
            <MetricTile
              icon={<FlaskConical className="icon-size-300" aria-hidden="true" />}
              tone="bg-muted text-muted-foreground"
              value="—"
              label="Item Relations (Beta)"
              detail="Not included in this view"
            />
          )}
        </div>

        <PreviewCoverage model={model} state={previewState} />

        <section
          aria-labelledby="lineage-relationships-title"
          className="overflow-hidden rounded-lg border border-border bg-card shadow-fabric-2"
        >
          <div className="atlas-toolbar flex flex-wrap items-center justify-between border-b border-border px-l py-m">
            <h3 id="lineage-relationships-title" className="text-400 font-semibold">
              Lineage relationships
            </h3>
            <div className="flex flex-wrap items-center gap-s">
              <select
                aria-label="Filter relationships by agreement"
                value={agreement}
                onChange={(event) => {
                  setAgreement(event.target.value as RelationshipAgreement | "all");
                  setLimit(PAGE_SIZE);
                }}
                className="rounded-lg border border-input bg-card px-m text-muted-foreground outline-none"
              >
                <option value="all">All relationships</option>
                {RELATIONSHIP_AGREEMENT_ORDER.filter(
                  (value) => model.counts[value] > 0 || value === agreement,
                ).map((value) => (
                  <option key={value} value={value}>
                    {RELATIONSHIP_AGREEMENT_LABEL[value]} ({model.counts[value]})
                  </option>
                ))}
              </select>
              <label className="relative min-w-[200px] sm:w-[280px]">
                <Search
                  className="pointer-events-none absolute left-s top-1/2 icon-size-200 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">Search relationships</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(PAGE_SIZE);
                  }}
                  placeholder="Search items, workspaces or types…"
                  className="w-full rounded-lg border border-input bg-card pl-xxxl pr-m outline-none"
                />
              </label>
              <span className="text-200 text-muted-foreground" aria-live="polite">
                {filtered.length} of {model.relationships.length}
              </span>
            </div>
          </div>

          {model.relationships.length === 0 ? (
            <p className="p-xl text-center text-300 text-muted-foreground">
              This snapshot has no lineage relationships.
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-xl text-center text-300 text-muted-foreground">
              No relationships match these filters.
            </p>
          ) : (
            <table aria-labelledby="lineage-relationships-title" className="w-full border-collapse text-300">
              <thead>
                <tr className="border-b border-border text-left text-200 text-muted-foreground">
                  <th scope="col" className="px-l py-s font-semibold">Relationship</th>
                  <th scope="col" className="hidden px-m py-s font-semibold md:table-cell">Type</th>
                  <th scope="col" className="hidden px-m py-s font-semibold lg:table-cell">Sources</th>
                  <th scope="col" className="px-m py-s font-semibold">Agreement</th>
                  <th scope="col" className="w-[40px] px-s py-s">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((relationship) => {
                  const active = relationship.id === selectedId;
                  const types = [
                    ...new Set([
                      ...relationship.authoritative.map((edge) => edge.relation),
                      ...relationship.preview.map((entry) => entry.edge.relation.relationType),
                    ]),
                  ];
                  return (
                    <tr
                      key={relationship.id}
                      onClick={() => onSelect(relationship.id)}
                      className={cn(
                        "cursor-pointer border-b border-border last:border-b-0 hover:bg-accent",
                        active && "bg-primary/5",
                      )}
                    >
                      <td className="atlas-row px-l">
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(relationship.id);
                          }}
                          className="flex min-h-[var(--atlas-touch-target)] w-full min-w-0 items-center gap-m text-left"
                        >
                          <TypeGlyph
                            type={(relationship.source.itemType ?? "Unknown") as ItemType}
                            size={28}
                          />
                          <span className="min-w-0">
                            <span className="block break-words font-semibold">
                              {relationship.source.displayName}{" "}
                              <span aria-hidden="true">→</span>
                              <span className="sr-only"> to </span>{" "}
                              {relationship.target.displayName}
                            </span>
                            <span className="block break-words text-200 text-muted-foreground">
                              {relationship.crossWorkspace
                                ? `${relationship.source.workspaceName ?? "Workspace name not reported"} → ${relationship.target.workspaceName ?? "Workspace name not reported"}`
                                : relationship.source.workspaceName ?? "Same workspace"}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="hidden px-m text-muted-foreground md:table-cell">
                        {types.join(" · ")}
                      </td>
                      <td className="hidden px-m lg:table-cell">
                        <span className="flex flex-wrap items-center gap-xs text-200">
                          {relationship.authoritative.length > 0 && (
                            <span className="inline-flex items-center gap-xxs rounded-md border border-status-healthy/30 bg-status-healthy/10 px-s py-xxs font-semibold text-status-healthy">
                              <CircleCheck className="icon-size-100" aria-hidden="true" />
                              Atlas snapshot
                            </span>
                          )}
                          {relationship.preview.length > 0 && (
                            <span className="inline-flex items-center gap-xxs rounded-md border border-lineage-upstream/35 bg-lineage-upstream/10 px-s py-xxs font-semibold text-lineage-upstream">
                              <FlaskConical className="icon-size-100" aria-hidden="true" />
                              Beta
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-m">
                        <AgreementChip agreement={relationship.agreement} />
                      </td>
                      <td className="px-s text-muted-foreground">
                        <ChevronRight className="icon-size-200" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filtered.length > limit && (
            <div className="border-t border-border px-l py-s">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
                className="rounded-lg border border-border bg-card px-l py-s text-300 font-semibold hover:bg-accent"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-fabric-2 xl:sticky xl:top-0 xl:max-h-full xl:w-[400px] xl:shrink-0">
        {selected ? (
          <RelationshipEvidencePane
            relationship={selected}
            snapshotSyncedAt={snapshotSyncedAt}
            itemNames={itemNames}
            onClose={() => onSelect("")}
          />
        ) : (
          <p className="m-auto max-w-[280px] p-l text-center text-300 text-muted-foreground">
            Select a relationship to compare its evidence sources.
          </p>
        )}
      </div>
    </div>
  );
}
