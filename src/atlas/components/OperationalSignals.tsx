import { useMemo } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  History,
  Waypoints,
} from "lucide-react";
import { ATLAS_CONFIG } from "../config";
import { relativeTime } from "../model";
import {
  fabricAppItemUrl,
  fabricPortalContext,
  incidentImpact,
  MONITORING_SOURCES,
  monitorHubUrl,
  type IncidentImpact,
  type MonitoringSource,
  type ObservedIncident,
  type OperationalEvidence,
} from "../observability";
import { useAtlas } from "../store";
import { Card, TypeGlyph, cn } from "../ui";
import { NativeLink } from "./NativeLink";

const IMPACT_PREVIEW_COUNT = 4;

const BUTTON =
  "inline-flex min-h-[var(--atlas-touch-target)] items-center justify-center gap-s rounded-md border border-input bg-card px-m text-200 font-semibold text-foreground transition-colors hover:bg-accent sm:min-h-[var(--atlas-control-height)]";

const EXACT_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function exactTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : EXACT_TIME.format(date);
}

export function EvidenceChip({ evidence }: { evidence: OperationalEvidence }) {
  return evidence === "observed" ? (
    <span className="inline-flex shrink-0 items-center gap-xs rounded-md border border-status-failing/35 bg-status-failing/10 px-s py-xxs text-200 font-semibold text-foreground">
      <CircleAlert className="icon-size-100 text-status-failing" aria-hidden="true" />
      Observed failure
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-xs rounded-md border border-dashed border-lineage-upstream/50 bg-lineage-upstream/5 px-s py-xxs text-200 font-semibold text-foreground">
      <Waypoints className="icon-size-100 text-lineage-upstream" aria-hidden="true" />
      Inferred impact
    </span>
  );
}

function SourceStatus({ source }: { source: MonitoringSource }) {
  const chip =
    "inline-flex shrink-0 items-center gap-xs rounded-md border px-s py-xxs text-200 font-semibold";
  switch (source.status) {
    case "collected":
      return (
        <span className={cn(chip, "border-status-healthy/30 bg-status-healthy/10 text-foreground")}>
          <CircleCheck className="icon-size-100 text-status-healthy" aria-hidden="true" />
          Collected
        </span>
      );
    case "not-collected":
      return (
        <span className={cn(chip, "border-border bg-muted text-muted-foreground")}>
          <CircleDashed className="icon-size-100" aria-hidden="true" />
          Not collected
        </span>
      );
    default:
      return (
        <span className={cn(chip, "border-border bg-secondary text-foreground")}>
          <ExternalLink className="icon-size-100 text-muted-foreground" aria-hidden="true" />
          Fabric portal only
        </span>
      );
  }
}

function SourceLinks({
  source,
  lastSyncedAt,
}: {
  source: MonitoringSource;
  lastSyncedAt?: string;
}) {
  const context = fabricPortalContext();
  switch (source.id) {
    case "fabric-job-history":
      return (
        <>
          <p className="text-200 text-muted-foreground">
            {lastSyncedAt
              ? `Captured ${relativeTime(lastSyncedAt)} (${exactTime(lastSyncedAt)}).`
              : "No synchronization has been recorded for this workspace."}
          </p>
          <NativeLink href={monitorHubUrl("jobs", context)}>
            Job runs in Monitor hub
          </NativeLink>
        </>
      );
    case "workspace-monitoring":
      return (
        <NativeLink href={source.documentationUrl}>
          Workspace monitoring guide
        </NativeLink>
      );
    case "monitor-hub-alerts":
      return (
        <NativeLink href={monitorHubUrl("alerts", context)}>
          Alerts in Monitor hub
        </NativeLink>
      );
    default: {
      const appUrl = fabricAppItemUrl({
        ...context,
        workspaceId: ATLAS_CONFIG.workspaceId,
        itemId: import.meta.env.VITE_FABRIC_ITEM_ID as string | undefined,
      });
      return (
        <>
          <NativeLink href={monitorHubUrl("applications", context)}>
            Applications in Monitor hub
          </NativeLink>
          {appUrl ? (
            <p className="text-200 text-muted-foreground">
              <NativeLink href={appUrl}>Open the Atlas app item</NativeLink>{" "}
              then select Manage app &gt; Metrics.
            </p>
          ) : (
            <p className="text-200 text-muted-foreground">
              No deployed app item ID is configured in this build, so only the
              Monitor hub link is available.
            </p>
          )}
        </>
      );
    }
  }
}

function MonitoringSourcesCard({ lastSyncedAt }: { lastSyncedAt?: string }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <header className="border-b border-border p-l">
        <h2 id="monitoring-sources-title" className="text-400 font-semibold leading-400">
          Monitoring sources
        </h2>
        <p className="mt-xxs text-200 leading-200 text-muted-foreground">
          What Atlas collects and what stays in Fabric. An unavailable source
          never hides the validated catalog.
        </p>
      </header>
      <ul aria-labelledby="monitoring-sources-title" className="divide-y divide-border">
        {MONITORING_SOURCES.map((source) => (
          <li key={source.id} className="flex flex-col gap-s p-l">
            <div className="flex flex-wrap items-center justify-between gap-s">
              <h3 className="text-300 font-semibold">{source.label}</h3>
              <SourceStatus source={source} />
            </div>
            <p className="text-200 leading-200 text-muted-foreground">
              {source.summary}
              {source.maturity === "preview" && " Preview in Fabric."}
            </p>
            <SourceLinks source={source} lastSyncedAt={lastSyncedAt} />
            <details className="text-200 leading-200">
              <summary className="inline-flex min-h-[var(--atlas-touch-target)] cursor-pointer items-center font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">
                Prerequisites
              </summary>
              <ul className="mt-xs list-disc space-y-xxs pl-l text-muted-foreground">
                {source.prerequisites.map((prerequisite) => (
                  <li key={prerequisite}>{prerequisite}</li>
                ))}
              </ul>
              <div className="mt-xs">
                <NativeLink href={source.documentationUrl}>
                  Microsoft documentation
                </NativeLink>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function IncidentRow({
  entry,
  onShowRuns,
  onOpenImpact,
}: {
  entry: IncidentImpact;
  onShowRuns: (incident: ObservedIncident) => void;
  onOpenImpact?: (itemId: string) => void;
}) {
  const { incident, impact } = entry;
  const preview = impact.slice(0, IMPACT_PREVIEW_COUNT);
  const hidden = impact.length - preview.length;
  const titleId = `incident-${incident.id}`;
  return (
    <li className="flex flex-col gap-m p-l">
      <div className="flex flex-wrap items-start gap-m">
        {incident.itemType && <TypeGlyph type={incident.itemType} size={28} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-s">
            <EvidenceChip evidence="observed" />
            <h3 id={titleId} className="min-w-0 break-words text-300 font-semibold">
              {incident.itemName}
            </h3>
          </div>
          <p className="mt-xxs text-200 text-muted-foreground">
            {incident.jobType} run started{" "}
            <time dateTime={incident.occurredAt} title={exactTime(incident.occurredAt)}>
              {relativeTime(incident.occurredAt)}
            </time>
            {incident.observedAt &&
              ` · captured ${relativeTime(incident.observedAt)}`}
          </p>
          {incident.message ? (
            <p className="mt-xs line-clamp-2 break-words text-200 leading-200 text-foreground" title={incident.message}>
              {incident.message}
            </p>
          ) : (
            <p className="mt-xs text-200 leading-200 text-muted-foreground">
              Error detail not collected by Atlas.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-lineage-upstream/40 p-m">
        <div className="flex flex-wrap items-center gap-s">
          <EvidenceChip evidence="inferred" />
          <span className="text-200 text-muted-foreground">
            {impact.length === 0
              ? "No downstream consumers in snapshot lineage."
              : `${impact.length} downstream item${impact.length === 1 ? "" : "s"} in snapshot lineage. Not confirmed by monitoring.`}
          </span>
        </div>
        {preview.length > 0 && (
          <ul
            aria-label={`Inferred downstream impact of ${incident.itemName}`}
            className="mt-s flex flex-col gap-xs"
          >
            {preview.map((item) => (
              <li key={item.itemId} className="flex min-w-0 items-center gap-s text-200">
                {item.itemType && <TypeGlyph type={item.itemType} size={20} />}
                <span className="min-w-0 truncate font-semibold">
                  {item.itemName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {item.distance === 1 ? "direct consumer" : `${item.distance} hops`}
                </span>
              </li>
            ))}
            {hidden > 0 && (
              <li className="text-200 text-muted-foreground">
                and {hidden} more
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-s">
        <button type="button" onClick={() => onShowRuns(incident)} className={BUTTON}>
          <History className="icon-size-200" aria-hidden="true" />
          Show this run
        </button>
        {onOpenImpact && impact.length > 0 && (
          <button
            type="button"
            onClick={() => onOpenImpact(incident.itemId)}
            className={BUTTON}
          >
            <Waypoints className="icon-size-200" aria-hidden="true" />
            Open impact in Map &amp; lineage
          </button>
        )}
      </div>
    </li>
  );
}

export function OperationalSignals({
  onShowRuns,
  onOpenImpact,
}: {
  onShowRuns: (incident: ObservedIncident) => void;
  onOpenImpact?: (itemId: string) => void;
}) {
  const { data, lastSyncedAt } = useAtlas();
  const entries = useMemo(
    () => incidentImpact(data, lastSyncedAt),
    [data, lastSyncedAt],
  );

  return (
    <section
      aria-label="Operational signals"
      className="grid gap-l lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]"
    >
      <Card className="flex min-w-0 flex-col">
        <header className="border-b border-border p-l">
          <h2 className="text-400 font-semibold leading-400">
            Failures and downstream impact
          </h2>
          <p className="mt-xxs text-200 leading-200 text-muted-foreground">
            Observed failures are the latest recorded run of an item and job
            type in the synchronized job history. Downstream impact is inferred
            from snapshot lineage and has not been confirmed by any monitoring
            source.
          </p>
          <div className="mt-s flex flex-wrap gap-s" aria-hidden="true">
            <EvidenceChip evidence="observed" />
            <EvidenceChip evidence="inferred" />
          </div>
        </header>
        {entries.length === 0 ? (
          <p className="p-l text-200 leading-200 text-muted-foreground">
            {data.jobs.length === 0
              ? "No job history is in this snapshot. Run a refresh, pipeline or notebook, then synchronize Atlas."
              : "No current failures. The latest recorded run of every item and job type did not fail; earlier failures stay in Run history."}
          </p>
        ) : (
          <ol aria-label="Observed failures" className="divide-y divide-border">
            {entries.map((entry) => (
              <IncidentRow
                key={entry.incident.id}
                entry={entry}
                onShowRuns={onShowRuns}
                onOpenImpact={onOpenImpact}
              />
            ))}
          </ol>
        )}
      </Card>
      <MonitoringSourcesCard lastSyncedAt={lastSyncedAt} />
    </section>
  );
}
