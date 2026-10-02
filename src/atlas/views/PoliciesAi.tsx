import { useEffect, useMemo, useRef, useState } from "react";
import type { AtlasData } from "../model";
import type { HistoricalSnapshot } from "../history";
import type { AtlasNavigation } from "../navigation";
import {
  buildAiGovernanceInventory, compareAgentSourceSelections, POLICIES_AI_LIMITATION,
  WATCHLIST_BLOCKER, SYNC_BRIEF_BLOCKER,
} from "../policies-ai";
import { isFeatureEnabled } from "../feature-flags";
import {
  useStoredPolicyEvidence, type PolicyEvidenceLoader,
} from "../access-policy-evidence-source";
import {
  POLICY_LABELS, POLICY_DOCS, POLICY_LIMITATION,
} from "../../../rayfin/functions/src/policy-evidence-contract";
import { Card, TypeGlyph, cn } from "../ui";
import { AccessEvidenceInspector } from "../components/AccessEvidenceInspector";
import { useDesktopEvidence } from "../use-desktop-evidence";

export function PoliciesAiSection({
  data, previous, current, historyLoading, historyError, isPreview,
  onNavigate, onCompare, policyEvidenceLoader,
}: {
  data: AtlasData;
  previous?: HistoricalSnapshot;
  current?: HistoricalSnapshot;
  historyLoading: boolean;
  historyError?: string;
  isPreview: boolean;
  onNavigate: (navigation: AtlasNavigation) => void;
  onCompare: (previousId: string, currentId: string) => void;
  policyEvidenceLoader?: PolicyEvidenceLoader;
}) {
  const rows = useMemo(() => buildAiGovernanceInventory(data), [data]);
  const comparison = useMemo(() => compareAgentSourceSelections(previous, current), [previous, current]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = rows.filter((row) => [
    row.item.displayName, row.owner, ...row.sources.map((source) => source.displayName),
  ].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const selected = filtered.find((row) => row.item.fabricId === selectedId);
  const desktop = useDesktopEvidence();
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const returnFocus = () => selectionTrigger.current?.isConnected && selectionTrigger.current.focus();
  const closeDetails = () => {
    setSelectedId(null);
    returnFocus();
  };
  useEffect(() => {
    if (desktop && selectedId) document.getElementById("close-ai-evidence")?.focus();
  }, [desktop, selectedId]);
  const enabled = isFeatureEnabled("fabric-policies");
  const policy = useStoredPolicyEvidence(
    data.workspace.fabricId, data.workspace.snapshotId,
    enabled && (!isPreview || !!policyEvidenceLoader), policyEvidenceLoader,
  );
  const navigate = (tab: AtlasNavigation["tab"], itemId: string) => onNavigate({
    tab, focus: { requestId: crypto.randomUUID(), itemId },
  });
  return (
    <div className="grid gap-l">
      <Card className="border-status-warning/30 bg-status-warning/5 p-l">
        <h2 className="text-400 font-semibold">Policies &amp; AI evidence</h2>
        <p className="mt-s text-300 leading-300">{POLICIES_AI_LIMITATION}</p>
        <p className="mt-s text-200 leading-300 text-muted-foreground">
          Catalog snapshot: {data.workspace.snapshotId ?? "Not recorded"} ·
          Collected snapshot time: {data.workspace.syncedAt ?? "Not recorded"}.
          Individual definition observation times are not collected.
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-m lg:grid-cols-4">
        {[
          ["Inventoried artifacts", rows.length, "Selected artifact families and recorded agent source targets"],
          ["Data agents", rows.filter((row) => row.item.itemType === "DataAgent").length, "Actual catalog DataAgent items"],
          ["Source definitions unavailable", rows.filter((row) => row.selections === "unavailable").length, "Missing normalized source-selection evidence"],
          ["Exposure unknown", rows.length, "No verified exposure evidence collected"],
        ].map(([label, value, detail]) => (
          <Card key={String(label)} className="min-w-0 p-l">
            <div className="font-numeric text-500 font-bold">{value}</div>
            <div className="mt-xs text-300 font-semibold">{label}</div>
            <p className="mt-xs text-200 leading-300 text-muted-foreground">{detail}</p>
          </Card>
        ))}
      </div>
      <div className={cn("grid items-start gap-l", selected && "xl:grid-cols-3")}>
        <Card className={cn("min-w-0 overflow-hidden", selected && "xl:col-span-2")}>
          <div className="atlas-toolbar flex flex-wrap items-center justify-between gap-m border-b border-border p-l">
            <h3 className="text-400 font-semibold">AI governance inventory</h3>
            <label className="min-w-0">
              <span className="sr-only">Search policy and AI inventory</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Asset, documented owner or source"
                className="atlas-control max-w-full rounded-lg border border-input bg-card px-m text-300" />
            </label>
          </div>
          <div className="atlas-row hidden grid-cols-5 gap-m bg-secondary px-l text-200 font-semibold xl:grid" aria-hidden="true">
            <span>Artifact</span><span>Documented owner</span><span>Source selections</span><span>Protection metadata</span><span>AI exposure</span>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((row) => (
              <li key={row.item.fabricId}>
                <button type="button" aria-pressed={selectedId === row.item.fabricId}
                  aria-label={`Inspect ${row.item.displayName}. AI exposure unknown. Source selection evidence ${row.selections}.`}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    selectionTrigger.current = event.currentTarget;
                    setSelectedId(row.item.fabricId);
                  }}
                  className={cn("atlas-row grid w-full gap-m px-l text-left hover:bg-accent xl:grid-cols-5",
                    selectedId === row.item.fabricId && "bg-primary/10")}>
                  <span className="flex min-w-0 items-start gap-s">
                    <TypeGlyph type={row.item.itemType} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate text-300 font-semibold">{row.item.displayName}</span>
                      <span className="text-200 text-muted-foreground">{row.item.itemType}</span>
                    </span>
                  </span>
                  <span className="break-words text-200">{row.owner}</span>
                  <span className="text-200">
                    {row.selections === "observed" ? `${row.sources.length} configured source references` :
                      row.selections === "observed-empty" ? "No sources in collected definition; exposure unknown" :
                      row.selections === "unavailable" ? "Not collected" : "No Data Agent source-selection contract for this artifact"}
                  </span>
                  <span className="text-200">{row.sensitivity} · Endorsement: {row.endorsement}</span>
                  <span className="text-200">Unknown (not evaluated)</span>
                </button>
              </li>
            ))}
          </ul>
          {!filtered.length && <p className="p-l text-300 leading-300">
            No inventoried artifacts match. Missing inventory is not evidence of absent AI exposure.
          </p>}
        </Card>
        {selected && (
          <AccessEvidenceInspector desktop={desktop} onClose={closeDetails} onReturnFocus={() => { returnFocus(); }}
            title="Policies and AI evidence" desktopLabel="Selected policy and AI evidence"
            description="Catalog and definition metadata, source selections and unknown exposure."
            closeButtonId="close-ai-evidence">
          <section aria-labelledby="ai-evidence-detail-heading" className="min-w-0"
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeDetails(); } }}>
            <Card className="p-l">
              <div className="flex items-start justify-between gap-m">
                <h3 id="ai-evidence-detail-heading" className="break-words text-400 font-semibold">Evidence details: {selected.item.displayName}</h3>
                <button id="close-ai-evidence" type="button" onClick={closeDetails}
                  className="atlas-control rounded-lg border border-border px-s text-200"
                  aria-label="Close AI evidence details">Close</button>
              </div>
              <dl className="mt-m grid gap-m text-200 leading-300">
                {[
                  ["Documented owner", selected.owner], ["Sensitivity metadata", selected.sensitivity],
                  ["Endorsement metadata", selected.endorsement], ["Observed lineage", selected.lineage],
                  ["AI/Copilot exposure", "Unknown; no exposure contract collected"],
                  ["Provenance", selected.provenance], ["Snapshot ID", selected.snapshotId ?? "Not recorded"],
                  ["Catalog collection time", selected.catalogCollectedAt ?? "Not recorded"],
                  ["Per-definition observation time", "Not collected"],
                ].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words text-muted-foreground">{value}</dd></div>)}
              </dl>
              <h4 className="mt-l text-300 font-semibold">Recorded source selections</h4>
              {!selected.sources.length && <p className="mt-s text-200 leading-300">
                {selected.selections === "observed-empty" ? "No source references in the collected definition." : "Source-selection evidence unavailable or not applicable."}
                {" "}Neither statement establishes that this artifact is not exposed.
              </p>}
              <ul className="mt-m grid gap-s">
                {selected.sources.map((source) => (
                  <li key={`${source.workspaceId ?? "unknown"}:${source.artifactId}`} className="rounded-lg border border-border p-m text-200 leading-300">
                    <p className="font-semibold">{source.displayName} · {source.sourceType}</p>
                    <p className="break-all">Artifact ID: {source.artifactId} · Workspace: {source.workspaceId ?? "Not recorded"}</p>
                    <ul className="mt-s grid gap-xs">
                      {source.selectedElements.map((element) => (
                        <li key={JSON.stringify([element.parentId, element.parentPath, element.id, element.elementType])}>
                          {element.elementType}: {element.displayName} · Recorded ID: {element.id}
                        </li>
                      ))}
                    </ul>
                    {!source.selectedElements.length && <p>No supported selected elements in this collected projection; other selections remain unknown.</p>}
                  </li>
                ))}
              </ul>
              <div className="mt-l flex flex-wrap gap-s">
                <button type="button" onClick={() => navigate("catalog", selected.item.fabricId)}
                  className="atlas-control rounded-lg border border-border px-m text-200">Open catalog evidence</button>
                <button type="button" onClick={() => navigate("map", selected.item.fabricId)}
                  className="atlas-control rounded-lg border border-border px-m text-200">Open lineage evidence</button>
              </div>
            </Card>
          </section>
          </AccessEvidenceInspector>
        )}
      </div>
      <Card className="p-l">
        <h3 className="text-400 font-semibold">Supported stored policy context</h3>
        <p className="mt-s text-200 leading-300">{POLICY_LIMITATION}</p>
        <p role="status" className="mt-s text-200 text-muted-foreground">
          {!enabled ? "Policy evidence feature is off. No policy records or APIs were queried." :
            policy.status === "loading" ? "Loading stored context…" :
            policy.status === "unavailable" ? "Stored policy context unavailable; no policy outcome is inferred." :
            !policy.records.length ? "No stored policy context for this snapshot; applicability remains unknown." : "Stored workspace context only."}
        </p>
        <ul className="mt-m grid gap-s">
          {policy.records.map((record) => <li key={record.id} className="rounded-lg border border-border p-m text-200 leading-300">
            <p className="font-semibold">{POLICY_LABELS[record.kind]} · {record.coverage}</p>
            {record.inboundPublicAction && <p>Inbound public-network default: {record.inboundPublicAction}</p>}
            {record.outboundPublicAction && <p>Outbound public-network default: {record.outboundPublicAction}</p>}
            {record.externalSharesBypassAction && <p>External-share network bypass default: {record.externalSharesBypassAction}</p>}
            <p>Observation: {record.observedAt ?? "Not observed"} · Attempt: {record.attemptedAt} · {record.reason}</p>
            <p>Connection identity: {record.collectorIdentity}</p>
            <a href={POLICY_DOCS[record.kind]} className="atlas-control inline-flex items-center text-brand-foreground underline"
              target="_blank" rel="noopener noreferrer">Source contract</a>
          </li>)}
        </ul>
        <p className="mt-m text-200 leading-300 text-muted-foreground">
          Central policy evaluation, OneLake roles, Purview DLP and AI exposure APIs remain unavailable or unsupported. Unknown is not a compliant result.
        </p>
      </Card>
      <Card className="p-l">
        <h3 className="text-400 font-semibold">Recorded source-selection differences</h3>
        {historyError ? <p role="alert" className="mt-s text-300">Snapshot history unavailable; no selection changes are inferred.</p> :
          historyLoading ? <p role="status" className="mt-s text-300">Loading validated snapshot history…</p> :
          comparison.state === "unavailable" ? <p className="mt-s text-300 leading-300">{comparison.reason}</p> :
          <>
            <p className="mt-s text-200 leading-300">
              {comparison.previousSnapshotId} ({comparison.previousCollectedAt}) → {comparison.currentSnapshotId} ({comparison.currentCollectedAt}).
              Comparison is of complete, supported definition projections, not effective exposure or revoked access.
            </p>
            <ul className="mt-m grid gap-s">
              {comparison.differences.map((difference) => <li key={difference.id} className="rounded-lg border border-border p-m text-200 leading-300">
                <p className="font-semibold">{difference.agentName}: {difference.type} · {difference.label}</p>
                <p className="break-all">Agent ID: {difference.agentId} · Source ID: {difference.sourceId} · Element ID: {difference.elementId ?? "Not applicable"}</p>
              </li>)}
            </ul>
            {!comparison.differences.length && <p className="mt-s text-200">No recorded selection differences for comparable agents. Unavailable agents are not treated as unchanged.</p>}
            {!!comparison.unavailableAgents.length && <p className="mt-s text-200">{comparison.unavailableAgents.length} agents lack comparable source/identity evidence.</p>}
            <button type="button" onClick={() => onCompare(comparison.previousSnapshotId, comparison.currentSnapshotId)}
              className="atlas-control mt-m rounded-lg border border-border px-m text-300">Open exact historical comparison</button>
          </>}
      </Card>
      <Card className="p-l">
        <h3 className="text-400 font-semibold">Personal monitoring and brief integrations</h3>
        <p id="ai-watchlist-blocker" className="mt-s text-200 leading-300">{WATCHLIST_BLOCKER}</p>
        <button type="button" disabled aria-describedby="ai-watchlist-blocker"
          className="atlas-control mt-s rounded-lg border border-border px-m text-200">Watchlists unavailable</button>
        <p id="ai-brief-blocker" className="mt-m text-200 leading-300">{SYNC_BRIEF_BLOCKER}</p>
        <button type="button" disabled aria-describedby="ai-brief-blocker"
          className="atlas-control mt-s rounded-lg border border-border px-m text-200">Sync Brief unavailable</button>
      </Card>
    </div>
  );
}
