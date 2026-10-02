import { CircleCheck, FlaskConical, Search } from "lucide-react";
import { useMemo, useState } from "react";
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="min-w-[112px] rounded-lg border border-border bg-card px-m py-s shadow-fabric-2">
      <div className={cn("font-numeric text-400 font-semibold", tone)}>
        {value}
      </div>
      <div className="text-200 text-muted-foreground">{label}</div>
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
}: {
  model: LineageEvidenceModel;
  previewState: ItemRelationsEvidenceState;
  snapshotSyncedAt?: string;
  itemNames: ReadonlyMap<string, string>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [agreement, setAgreement] = useState<RelationshipAgreement | "all">(
    "all",
  );
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
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-m overflow-auto p-l">
        <div className="flex flex-wrap gap-s">
          <Metric label="Relationships" value={model.relationships.length} />
          <Metric label="Atlas snapshot" value={withSnapshot} />
          {previewReady && (
            <>
              <Metric
                label="Item Relations (Beta)"
                value={withPreview}
                tone="text-lineage-upstream"
              />
              <Metric
                label="Sources agree"
                value={model.counts.agree}
                tone="text-status-healthy"
              />
              <Metric
                label="Conflicts to review"
                value={model.counts.conflict}
                tone={model.counts.conflict > 0 ? "text-status-warning" : undefined}
              />
            </>
          )}
        </div>

        <PreviewCoverage model={model} state={previewState} />

        <div className="atlas-toolbar flex flex-wrap items-center">
          <label className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
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
              placeholder="Search relationships…"
              className="w-full rounded-lg border border-input bg-card pl-xxxl pr-m outline-none"
            />
          </label>
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
              (value) => model.counts[value] > 0,
            ).map((value) => (
              <option key={value} value={value}>
                {RELATIONSHIP_AGREEMENT_LABEL[value]} ({model.counts[value]})
              </option>
            ))}
          </select>
          <span className="text-200 text-muted-foreground" aria-live="polite">
            {filtered.length} of {model.relationships.length}
          </span>
        </div>

        {model.relationships.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-xl text-center text-300 text-muted-foreground">
            This snapshot has no lineage relationships.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-xl text-center text-300 text-muted-foreground">
            No relationships match these filters.
          </p>
        ) : (
          <ul aria-label="Lineage relationships" className="flex flex-col gap-xs">
            {filtered.slice(0, limit).map((relationship) => {
              const active = relationship.id === selectedId;
              return (
                <li key={relationship.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(relationship.id)}
                    className={cn(
                      "grid min-h-[var(--atlas-touch-target)] w-full grid-cols-1 items-center gap-s rounded-lg border bg-card px-m py-s text-left shadow-fabric-2 hover:bg-accent md:grid-cols-[minmax(0,1fr)_auto_auto]",
                      active ? "border-primary" : "border-border",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-s">
                      <TypeGlyph
                        type={(relationship.source.itemType ?? "Unknown") as ItemType}
                        size={24}
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-300 font-semibold">
                          {relationship.source.displayName}{" "}
                          <span aria-hidden="true">→</span>
                          <span className="sr-only"> to </span>{" "}
                          {relationship.target.displayName}
                        </span>
                        <span className="block break-words text-200 text-muted-foreground">
                          {[
                            ...new Set([
                              ...relationship.authoritative.map(
                                (edge) => edge.relation,
                              ),
                              ...relationship.preview.map(
                                (entry) => entry.edge.relation.relationType,
                              ),
                            ]),
                          ].join(" · ")}
                          {relationship.crossWorkspace
                            ? ` · ${relationship.source.workspaceName ?? "Unknown workspace"} → ${relationship.target.workspaceName ?? "Unknown workspace"}`
                            : ""}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-xs text-200 text-muted-foreground">
                      {relationship.authoritative.length > 0 && (
                        <span className="inline-flex items-center gap-xxs">
                          <CircleCheck
                            className="icon-size-100 text-status-healthy"
                            aria-hidden="true"
                          />
                          Atlas
                        </span>
                      )}
                      {relationship.preview.length > 0 && (
                        <span className="inline-flex items-center gap-xxs text-lineage-upstream">
                          <FlaskConical
                            className="icon-size-100"
                            aria-hidden="true"
                          />
                          Beta
                        </span>
                      )}
                    </span>
                    <AgreementChip agreement={relationship.agreement} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
            className="self-start rounded-lg border border-border bg-card px-l py-s text-300 font-semibold hover:bg-accent"
          >
            Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
          </button>
        )}
      </div>

      <div className="flex min-h-[320px] flex-col border-t border-border bg-card xl:w-[380px] xl:shrink-0 xl:border-l xl:border-t-0">
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
