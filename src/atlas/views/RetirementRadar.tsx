import { useMemo, useState } from "react";
import { Archive, Download, Info, Search } from "lucide-react";
import type { AtlasData } from "../model";
import type { AtlasNavigation } from "../navigation";
import type { FindingAcknowledgement, FindingAckStatus } from "../finding-acks";
import type { GovernanceFinding } from "../governance";
import {
  buildRetirementRadar,
  retirementCandidatesToCsv,
  retirementCandidatesToMarkdown,
  retirementReviewedNote,
  retirementReviewState,
  RETIREMENT_FOLLOW_UP_NOTE,
  RETIREMENT_MIN_SIGNALS,
  RETIREMENT_SIGNAL_LABELS,
  RETIREMENT_SIGNAL_ORDER,
  type RetirementCandidate,
  type RetirementReviewState,
  type RetirementSignalId,
} from "../retirement-radar";
import { downloadText, fileSlug } from "../download";
import { Card, TypeGlyph, cn } from "../ui";

type ReviewFilter = "active" | "all" | RetirementReviewState;

const REVIEW_LABELS: Record<RetirementReviewState, string> = {
  open: "Open",
  "follow-up": "Follow-up",
  reviewed: "Reviewed",
  muted: "Muted",
};

const SHORT_LABELS: Record<RetirementSignalId, string> = {
  dormant: "Dormant",
  "no-consumer": "Consumers",
  "failed-runs": "Runs",
  "no-owner": "Owner",
  "no-trust": "Trust",
  "duplicate-name": "Duplicate",
};

const SELECT_CLASS = "atlas-control rounded-md border border-input bg-card px-s text-200";

/** Radar polygon of how many candidates carry each signal. */
function SignalProfile({ profile, total }: { profile: Record<RetirementSignalId, number>; total: number }) {
  // Wider than tall so the side labels stay inside the drawing.
  const width = 196;
  const height = 140;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 46;
  const point = (index: number, scale: number) => {
    const angle = (Math.PI * 2 * index) / RETIREMENT_SIGNAL_ORDER.length - Math.PI / 2;
    return [centerX + radius * scale * Math.cos(angle), centerY + radius * scale * Math.sin(angle)] as const;
  };
  const ring = (scale: number) =>
    RETIREMENT_SIGNAL_ORDER.map((_, index) => point(index, scale).join(",")).join(" ");
  const shape = RETIREMENT_SIGNAL_ORDER
    .map((id, index) => point(index, total ? profile[id] / total : 0).join(","))
    .join(" ");
  return (
    <figure className="m-0 flex min-w-0 flex-wrap items-center gap-m" aria-label="Signal profile of the candidates">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={RETIREMENT_SIGNAL_ORDER.map((id) => `${RETIREMENT_SIGNAL_LABELS[id]}: ${profile[id]}`).join(", ")}>
        {[1 / 3, 2 / 3, 1].map((scale) => (
          <polygon key={scale} points={ring(scale)} fill="none" stroke="var(--color-border, #e0e0e0)" strokeWidth={1} />
        ))}
        {RETIREMENT_SIGNAL_ORDER.map((id, index) => {
          const [x, y] = point(index, 1);
          const [lx, ly] = point(index, 1.2);
          return (
            <g key={id}>
              <line x1={centerX} y1={centerY} x2={x} y2={y} stroke="var(--color-border, #e0e0e0)" strokeWidth={1} />
              <text x={lx} y={ly + 3} fontSize={9} fontWeight={600} textAnchor={Math.abs(lx - centerX) < 4 ? "middle" : lx > centerX ? "start" : "end"}
                className="fill-muted-foreground">{SHORT_LABELS[id]}</text>
            </g>
          );
        })}
        <polygon points={shape} fill="rgba(164,38,44,.16)" stroke="#a4262c" strokeWidth={1.6} />
      </svg>
      <ul className="grid min-w-[12rem] flex-1 gap-xxs text-200">
        {RETIREMENT_SIGNAL_ORDER.map((id) => (
          <li key={id} className="grid grid-cols-[9.5rem_1fr_1.5rem] items-center gap-s">
            <span className="truncate text-muted-foreground">{RETIREMENT_SIGNAL_LABELS[id]}</span>
            <span className="h-[6px] overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              <span className="block h-full rounded-full bg-[#a4262c]/75" style={{ width: `${total ? (profile[id] / total) * 100 : 0}%` }} />
            </span>
            <span className="text-right font-numeric font-semibold">{profile[id]}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function RetirementRadarSection({
  data,
  findings,
  acknowledgements,
  pendingIds,
  acknowledgementsLoading,
  onSaveReview,
  onClearReview,
  onNavigate,
}: {
  data: AtlasData;
  findings?: readonly GovernanceFinding[];
  acknowledgements: readonly FindingAcknowledgement[];
  pendingIds: ReadonlySet<string>;
  acknowledgementsLoading: boolean;
  onSaveReview: (input: { findingId: string; status: FindingAckStatus; note?: string; occurrenceSnapshotId?: string }) => Promise<void>;
  onClearReview: (id: string) => Promise<void>;
  onNavigate: (navigation: AtlasNavigation) => void;
}) {
  const radar = useMemo(() => buildRetirementRadar(data, findings), [data, findings]);
  const ackById = useMemo(
    () => new Map(acknowledgements.map((acknowledgement) => [acknowledgement.findingId, acknowledgement])),
    [acknowledgements],
  );
  const [search, setSearch] = useState("");
  const [signal, setSignal] = useState<RetirementSignalId | "all">("all");
  const [itemType, setItemType] = useState("all");
  const [owner, setOwner] = useState<"all" | "with" | "without">("all");
  const [review, setReview] = useState<ReviewFilter>("active");
  const [minSignals, setMinSignals] = useState(RETIREMENT_MIN_SIGNALS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const rows = radar.candidates.map((candidate) => ({
    candidate,
    state: retirementReviewState(candidate, ackById.get(candidate.id)),
  }));
  const types = [...new Set(radar.candidates.map((candidate) => candidate.item.itemType))].sort();
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(({ candidate, state }) =>
    (!query || [candidate.item.displayName, candidate.item.itemType, candidate.context.owner ?? ""].join(" ").toLowerCase().includes(query)) &&
    (signal === "all" || candidate.signals.some((entry) => entry.id === signal)) &&
    (itemType === "all" || candidate.item.itemType === itemType) &&
    (owner === "all" || (owner === "with") === !!candidate.context.owner) &&
    candidate.signals.length >= minSignals &&
    (review === "all" || (review === "active" ? state === "open" || state === "follow-up" : state === review)));
  const selected = filtered.find(({ candidate }) => candidate.id === selectedId) ?? filtered[0];
  const followUps = rows.filter((row) => row.state === "follow-up").length;

  const setReviewState = async (candidate: RetirementCandidate, next: RetirementReviewState) => {
    setError(undefined);
    const current = ackById.get(candidate.id);
    try {
      if (next === "open") {
        if (current) await onClearReview(current.id);
        return;
      }
      await onSaveReview({
        findingId: candidate.id,
        status: next === "muted" ? "muted" : "acked",
        note: next === "follow-up" ? RETIREMENT_FOLLOW_UP_NOTE : next === "reviewed" ? retirementReviewedNote(candidate) : undefined,
        occurrenceSnapshotId: data.workspace.snapshotId,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportName = `retirement-candidates-${fileSlug(data.workspace.displayName)}`;
  const navigate = (tab: AtlasNavigation["tab"], itemId: string) =>
    onNavigate({ tab, focus: { requestId: crypto.randomUUID(), itemId } });

  return (
    <div className="grid min-w-0 gap-m" data-testid="retirement-radar">
      <div role="note" className="flex items-start gap-s rounded-md border border-signal-warning-foreground/15 bg-signal-warning-background px-m py-s text-200 leading-300 text-signal-warning-foreground">
        <Info className="mt-xxs icon-size-200 shrink-0" aria-hidden="true" />
        Review only. Candidates combine existing snapshot evidence. Atlas never says an item is unused or safe to delete: read usage, ad-hoc queries, Excel connections and unsynchronized workspaces are not observed.
      </div>
      <div className="grid gap-m lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)]">
        {([
          ["Candidates to review", rows.filter((row) => row.state === "open" || row.state === "follow-up").length, `${radar.candidates.length} listed, at least ${RETIREMENT_MIN_SIGNALS} signals including one retirement signal`],
          ["Marked for follow-up", followUps, "Personal review state, kept across synchronizations"],
          ["Evidence unknown", radar.unknownItems, "Items not evaluated because lineage or jobs were incomplete"],
        ] as const).map(([label, value, detail]) => (
          <div key={label} className="min-w-0 rounded-lg border border-border bg-card p-m">
            <p className="text-300 font-semibold">{label}</p>
            <p className="mt-xs font-numeric text-500 font-semibold">{value}</p>
            <p className="mt-xs text-200 leading-300 text-muted-foreground">{detail}</p>
          </div>
        ))}
        <div className="min-w-0 rounded-lg border border-border bg-card p-m">
          <p className="text-300 font-semibold">Signal profile of the {radar.candidates.length} candidates</p>
          <SignalProfile profile={radar.profile} total={radar.candidates.length} />
        </div>
      </div>
      {error && <p role="alert" className="text-200 text-signal-danger-foreground">{error}</p>}
      <div className="atlas-ai-workbench">
        <Card className="min-w-0 overflow-hidden shadow-none">
          <div className="atlas-toolbar flex flex-wrap items-center gap-s border-b border-border p-m">
            <label className="relative min-w-0 flex-1 sm:max-w-[16rem]">
              <Search className="pointer-events-none absolute left-s top-1/2 icon-size-200 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search retirement candidates</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Search candidates" className="atlas-control w-full rounded-md border border-input bg-card pl-xxxl pr-m text-300" />
            </label>
            <label className="sr-only" htmlFor="retirement-signal">Signal</label>
            <select id="retirement-signal" className={SELECT_CLASS} value={signal} onChange={(event) => setSignal(event.target.value as RetirementSignalId | "all")}>
              <option value="all">All signals</option>
              {RETIREMENT_SIGNAL_ORDER.map((id) => <option key={id} value={id}>{RETIREMENT_SIGNAL_LABELS[id]}</option>)}
            </select>
            <label className="sr-only" htmlFor="retirement-type">Item type</label>
            <select id="retirement-type" className={SELECT_CLASS} value={itemType} onChange={(event) => setItemType(event.target.value)}>
              <option value="all">All item types</option>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <label className="sr-only" htmlFor="retirement-owner">Owner</label>
            <select id="retirement-owner" className={SELECT_CLASS} value={owner} onChange={(event) => setOwner(event.target.value as typeof owner)}>
              <option value="all">Any owner</option>
              <option value="with">Owner recorded</option>
              <option value="without">No owner</option>
            </select>
            <label className="sr-only" htmlFor="retirement-min">Minimum signals</label>
            <select id="retirement-min" className={SELECT_CLASS} value={minSignals} onChange={(event) => setMinSignals(Number(event.target.value))}>
              {[2, 3, 4].map((count) => <option key={count} value={count}>{count}+ signals</option>)}
            </select>
            <label className="sr-only" htmlFor="retirement-review">Review state</label>
            <select id="retirement-review" className={SELECT_CLASS} value={review} onChange={(event) => setReview(event.target.value as ReviewFilter)}>
              <option value="active">Open and follow-up</option>
              <option value="all">All review states</option>
              {(Object.keys(REVIEW_LABELS) as RetirementReviewState[]).map((state) => <option key={state} value={state}>{REVIEW_LABELS[state]}</option>)}
            </select>
            <span className="ml-auto flex gap-xs">
              <button type="button" disabled={!filtered.length}
                onClick={() => downloadText(retirementCandidatesToCsv(filtered), "text/csv;charset=utf-8", `${exportName}.csv`)}
                className="atlas-control inline-flex items-center gap-xs rounded-md border border-border px-s text-200 hover:bg-accent disabled:opacity-50">
                <Download className="icon-size-200" aria-hidden="true" />CSV
              </button>
              <button type="button" disabled={!filtered.length}
                onClick={() => downloadText(retirementCandidatesToMarkdown(filtered, data.workspace.displayName, data.workspace.syncedAt), "text/markdown;charset=utf-8", `${exportName}.md`)}
                className="atlas-control inline-flex items-center gap-xs rounded-md border border-border px-s text-200 hover:bg-accent disabled:opacity-50">
                <Download className="icon-size-200" aria-hidden="true" />Markdown
              </button>
            </span>
          </div>
          <table className="w-full table-fixed border-collapse text-left text-200">
            <caption className="sr-only">Retirement candidates. Select one to see why it appears.</caption>
            <thead className="border-b border-border bg-secondary text-muted-foreground">
              <tr>
                <th scope="col" className="w-2/5 px-m py-s font-medium md:w-1/3">Item</th>
                <th scope="col" className="px-s py-s font-medium">Signals</th>
                <th scope="col" className="hidden w-[6rem] px-s py-s font-medium md:table-cell">Evidence</th>
                <th scope="col" className="w-[7rem] px-s py-s font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(({ candidate, state }) => (
                <tr key={candidate.id} className={cn("hover:bg-accent", selected?.candidate.id === candidate.id && "bg-primary/5")}>
                  <td className="px-m py-xs">
                    <button type="button" aria-pressed={selected?.candidate.id === candidate.id}
                      onClick={() => setSelectedId(candidate.id)}
                      className="atlas-control flex w-full items-center gap-s rounded-md text-left text-300">
                      <TypeGlyph type={candidate.item.itemType} size={24} />
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{candidate.item.displayName}</span>
                        <span className="block text-100 text-muted-foreground">{candidate.item.itemType} · {candidate.context.owner ?? "No owner"}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-s py-s">
                    <span className="flex flex-wrap gap-xxs">
                      {candidate.signals.map((entry) => (
                        <span key={entry.id} className="rounded-full border border-border bg-secondary px-xs text-100 font-semibold">
                          {RETIREMENT_SIGNAL_LABELS[entry.id]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="hidden px-s py-s md:table-cell">
                    <span className="font-numeric font-semibold">{candidate.signals.length}/{RETIREMENT_SIGNAL_ORDER.length}</span>
                  </td>
                  <td className="px-s py-s text-200">{REVIEW_LABELS[state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="p-l text-300 leading-300">
              {radar.candidates.length
                ? "No candidate matches the current filters."
                : "No retirement candidate in this snapshot. Missing evidence is never counted as a signal."}
            </p>
          )}
        </Card>
        {selected && (
          <Card className="min-w-0 shadow-none">
            <section aria-labelledby="retirement-detail-heading" className="grid gap-m p-m text-200 leading-300">
              <div className="flex items-center gap-s border-b border-border pb-m">
                <TypeGlyph type={selected.candidate.item.itemType} size={32} />
                <div className="min-w-0">
                  <h3 id="retirement-detail-heading" className="break-words text-300 font-semibold">{selected.candidate.item.displayName}</h3>
                  <p className="text-muted-foreground">
                    {selected.candidate.signals.length} of {RETIREMENT_SIGNAL_ORDER.length} retirement signals · {REVIEW_LABELS[selected.state]}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Why this item appears</h4>
                <ul className="mt-xs grid gap-xs">
                  {RETIREMENT_SIGNAL_ORDER.map((id) => {
                    const present = selected.candidate.signals.find((entry) => entry.id === id);
                    const unknown = selected.candidate.unknown.includes(id);
                    if (!present && !unknown) return null;
                    return (
                      <li key={id} className="flex gap-s">
                        <span aria-hidden="true" className={cn("font-semibold", present ? "text-signal-danger-foreground" : "text-muted-foreground")}>{present ? "✕" : "?"}</span>
                        <span><b>{RETIREMENT_SIGNAL_LABELS[id]}</b> · {present ? present.detail : "Unknown: the evidence was incomplete in this snapshot."}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <dl className="grid gap-xs">
                {[
                  ["Owner", selected.candidate.context.owner ?? "None recorded"],
                  ["Sensitivity", selected.candidate.context.sensitivity ?? "No label"],
                  ["Endorsement", selected.candidate.context.endorsement === "none" ? "None" : selected.candidate.context.endorsement],
                  ["Lineage", `${selected.candidate.context.upstream} upstream · ${selected.candidate.context.downstream} downstream`],
                  ["Access", `${selected.candidate.context.principals} principals${selected.candidate.context.externalPrincipals ? ` · ${selected.candidate.context.externalPrincipals} external` : ""}`],
                  ["Recent runs", selected.candidate.context.recentJobs.length
                    ? selected.candidate.context.recentJobs.map((job) => `${job.status} ${job.startedAt.slice(0, 10)}`).join(" · ")
                    : "None collected"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[7rem_1fr] gap-s">
                    <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-s border-t border-border pt-m">
                <button type="button" onClick={() => navigate("catalog", selected.candidate.item.fabricId)}
                  className="atlas-control rounded-md border border-border px-s text-200 hover:bg-accent">Open catalog</button>
                <button type="button" onClick={() => navigate("map", selected.candidate.item.fabricId)}
                  className="atlas-control rounded-md border border-border px-s text-200 hover:bg-accent">Open lineage</button>
              </div>
              <fieldset className="flex flex-wrap gap-s" disabled={acknowledgementsLoading || pendingIds.has(selected.candidate.id)}>
                <legend className="sr-only">Personal review state</legend>
                {(["follow-up", "reviewed", "muted", "open"] as const).map((state) => (
                  <button key={state} type="button" aria-pressed={selected.state === state}
                    onClick={() => void setReviewState(selected.candidate, state)}
                    className={cn("atlas-control rounded-md border px-s text-200 hover:bg-accent disabled:opacity-50",
                      selected.state === state ? "border-primary bg-primary/10 font-semibold" : "border-border")}>
                    {state === "follow-up" ? "Mark follow-up" : state === "reviewed" ? "Mark reviewed" : state === "muted" ? "Mute" : "Reopen"}
                  </button>
                ))}
              </fieldset>
              <p className="flex items-start gap-xs text-100 text-muted-foreground">
                <Archive className="mt-xxs icon-size-100 shrink-0" aria-hidden="true" />
                Review state is personal. A reviewed candidate reopens when its signals change; follow-up and mute persist across synchronizations.
              </p>
            </section>
          </Card>
        )}
      </div>
    </div>
  );
}
