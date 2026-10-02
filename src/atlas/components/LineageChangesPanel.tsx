import { AlertTriangle, FlaskConical, History } from "lucide-react";
import { useEffect, useMemo } from "react";
import { lineageChangesBetween, type LineageChangeRow } from "../lineage-evidence";
import { relativeTime } from "../model";
import { useAtlas } from "../store";
import { cn } from "../ui";

const GROUPS: Array<{
  type: LineageChangeRow["change"]["type"];
  title: string;
  tone: string;
}> = [
  {
    type: "lineage-added",
    title: "Added relationships",
    tone: "text-status-healthy",
  },
  {
    type: "lineage-removed",
    title: "Removed relationships",
    tone: "text-destructive",
  },
  {
    type: "lineage-broken-state-changed",
    title: "Broken state changed",
    tone: "text-status-warning",
  },
];

function brokenStateLabel(row: LineageChangeRow): string {
  return row.change.after === true ? "Now broken" : "No longer broken";
}

/** Changes tab: Atlas snapshot lineage changes between the last two syncs. */
export function LineageChangesPanel({
  previewIncluded,
}: {
  previewIncluded: boolean;
}) {
  const {
    history,
    historyLoading,
    historyError,
    historyFailedSnapshotIds,
    loadHistorySnapshot,
  } = useAtlas();
  const [currentSummary, previousSummary] = history.summaries;
  const current = history.snapshots.find(
    (snapshot) => snapshot.snapshotId === currentSummary?.snapshotId,
  );
  const previous = history.snapshots.find(
    (snapshot) => snapshot.snapshotId === previousSummary?.snapshotId,
  );
  const failed = [currentSummary, previousSummary].some(
    (summary) => summary && historyFailedSnapshotIds.has(summary.snapshotId),
  );

  useEffect(() => {
    for (const [summary, snapshot] of [
      [currentSummary, current],
      [previousSummary, previous],
    ] as const) {
      if (
        summary &&
        !snapshot &&
        !historyFailedSnapshotIds.has(summary.snapshotId)
      ) {
        void loadHistorySnapshot(summary.snapshotId);
      }
    }
  }, [
    current,
    currentSummary,
    historyFailedSnapshotIds,
    loadHistorySnapshot,
    previous,
    previousSummary,
  ]);

  const rows = useMemo(
    () => (current && previous ? lineageChangesBetween(previous, current) : []),
    [current, previous],
  );
  const loading =
    !historyError &&
    !failed &&
    (historyLoading ||
      Boolean(previousSummary && (!current || !previous)));

  let body;
  if (historyError || failed) {
    body = (
      <div
        role="alert"
        className="flex items-start gap-s rounded-lg border border-destructive/35 bg-destructive/10 p-m text-200 leading-200 text-foreground"
      >
        <AlertTriangle
          className="icon-size-200 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">
          {historyError ??
            "A snapshot needed for this comparison could not be loaded."}
        </span>
      </div>
    );
  } else if (loading) {
    body = (
      <div role="status" className="flex flex-col gap-s">
        <span className="text-200 text-muted-foreground">
          Loading snapshot history…
        </span>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="block h-xxxl rounded-md bg-muted"
          />
        ))}
      </div>
    );
  } else if (!previousSummary) {
    body = (
      <p className="rounded-lg border border-dashed border-border p-xl text-center text-300 text-muted-foreground">
        Lineage changes appear after a second synchronized snapshot.
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="rounded-lg border border-dashed border-border p-xl text-center text-300 text-muted-foreground">
        No lineage relationships changed between these snapshots.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-l">
        {GROUPS.map((group) => {
          const groupRows = rows.filter((row) => row.change.type === group.type);
          if (groupRows.length === 0) return null;
          return (
            <section key={group.type} aria-label={group.title}>
              <h3 className={cn("text-300 font-semibold", group.tone)}>
                {group.title} · {groupRows.length}
              </h3>
              <ul className="mt-s flex flex-col gap-xs">
                {groupRows.map((row) => (
                  <li
                    key={row.change.id}
                    className="flex flex-wrap items-center gap-x-m gap-y-xxs rounded-lg border border-border bg-card px-m py-s text-300 shadow-fabric-2"
                  >
                    <span className="min-w-0 flex-1 break-words font-semibold">
                      {row.sourceName} <span aria-hidden="true">→</span>
                      <span className="sr-only"> to </span> {row.targetName}
                    </span>
                    <span className="text-200 text-muted-foreground">
                      {row.change.type === "lineage-broken-state-changed"
                        ? brokenStateLabel(row)
                        : row.relation}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-l overflow-auto p-l">
      <header className="flex flex-wrap items-baseline justify-between gap-s">
        <div className="flex items-center gap-s">
          <History
            className="icon-size-200 text-brand-foreground"
            aria-hidden="true"
          />
          <h2 className="text-400 font-semibold">Atlas snapshot lineage changes</h2>
        </div>
        {currentSummary && previousSummary && (
          <span className="text-200 text-muted-foreground">
            {previousSummary.label || relativeTime(previousSummary.syncedAt)} →{" "}
            {currentSummary.label || relativeTime(currentSummary.syncedAt)}
          </span>
        )}
      </header>
      {body}
      {previewIncluded && (
        <section
          aria-label="Item Relations evidence changes"
          className="flex items-start gap-s rounded-lg border border-lineage-upstream/30 bg-lineage-upstream/5 p-m text-200 leading-200 text-foreground"
        >
          <FlaskConical
            className="icon-size-200 shrink-0 text-lineage-upstream"
            aria-hidden="true"
          />
          <p>
            <span className="font-semibold">
              Item Relations changes are not tracked.
            </span>{" "}
            Atlas keeps no history of Beta collections, so Preview evidence
            is never compared across time or mixed into these snapshot
            changes.
          </p>
        </section>
      )}
    </div>
  );
}
