import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileClock,
  FilterX,
  GitCompareArrows,
  History,
  KeyRound,
  Layers3,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { SavedViewsMenu } from "../components/SavedViewsMenu";
import { TrendChart } from "../components/TrendChart";
import { ATLAS_CONFIG } from "../config";
import {
  buildGovernanceFindings,
  getCoverageDiagnostics,
  type GovernanceCategory,
  type GovernanceFinding,
  type GovernanceSeverity,
} from "../governance";
import {
  compareSnapshots,
  type AtlasChange,
  type AtlasChangeDomain,
  type SnapshotSummary,
} from "../history";
import type {
  AtlasFocusRequest,
  AtlasNavigation,
  GovernanceSection,
} from "../navigation";
import type { SavedView, SavedViewFilters } from "../saved-views";
import { useAtlas } from "../store";
import { Card, SectionLabel, cn } from "../ui";
import { SensitivityView } from "./Sensitivity";

const SEVERITY_META: Record<
  GovernanceSeverity,
  { label: string; className: string; dot: string }
> = {
  critical: {
    label: "Critical",
    className:
      "border-status-failing/35 bg-status-failing/10 text-status-failing",
    dot: "bg-status-failing",
  },
  high: {
    label: "High",
    className:
      "border-status-warning/35 bg-status-warning/10 text-status-warning",
    dot: "bg-status-warning",
  },
  medium: {
    label: "Medium",
    className: "border-primary/30 bg-primary/10 text-brand-foreground",
    dot: "bg-primary",
  },
  low: {
    label: "Low",
    className:
      "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
    dot: "bg-lineage-neutral",
  },
};

const CATEGORY_LABEL: Record<GovernanceCategory, string> = {
  access: "Access",
  metadata: "Metadata",
  operations: "Operations",
  lineage: "Lineage",
};

const CHANGE_DOMAIN_LABEL: Record<AtlasChangeDomain, string> = {
  item: "Items",
  schema: "Schema",
  access: "Access",
  sensitivity: "Sensitivity",
  lineage: "Lineage",
  job: "Jobs",
};

type HistoryMetric =
  | "items"
  | "labels"
  | "externalPrincipals"
  | "failedJobs"
  | "stale"
  | "failing"
  | "lineage"
  | "brokenEdges"
  | "tables"
  | "columns"
  | "measures";

const HISTORY_METRICS: Array<{
  id: HistoryMetric;
  label: string;
  description: string;
}> = [
  { id: "items", label: "Items", description: "Indexed Fabric items" },
  { id: "labels", label: "Labeled", description: "Items with sensitivity metadata" },
  {
    id: "externalPrincipals",
    label: "External principals",
    description: "Guests and explicit external identities",
  },
  { id: "failedJobs", label: "Failed jobs", description: "Failed recorded runs" },
  { id: "stale", label: "Stale items", description: "Items reported as stale" },
  { id: "failing", label: "Failing items", description: "Items reported as failing" },
  { id: "lineage", label: "Lineage edges", description: "Verified item relationships" },
  { id: "brokenEdges", label: "Broken edges", description: "Broken lineage relationships" },
  { id: "tables", label: "Tables", description: "Tables and views inventoried" },
  { id: "columns", label: "Columns", description: "Columns inventoried" },
  { id: "measures", label: "Measures", description: "Measures inventoried" },
];

function snapshotLabel(summary: SnapshotSummary): string {
  const date = new Date(summary.syncedAt);
  if (Number.isNaN(date.valueOf())) return summary.label;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function changeAction(change: AtlasChange): "Added" | "Removed" | "Changed" {
  if (change.type.endsWith("-added") || change.type === "job-new") return "Added";
  if (change.type.endsWith("-removed")) return "Removed";
  return "Changed";
}

function changeTone(change: AtlasChange): string {
  const action = changeAction(change);
  if (action === "Added") {
    return "border-status-healthy/30 bg-status-healthy/10 text-status-healthy";
  }
  if (action === "Removed") {
    return "border-status-failing/30 bg-status-failing/10 text-status-failing";
  }
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
}

function compactValue(value: unknown): string {
  if (value == null || value === "") return "None";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  return serialized.length > 140
    ? `${serialized.slice(0, 137)}...`
    : serialized;
}

function focusRequest(
  values: Omit<AtlasFocusRequest, "requestId">,
): AtlasFocusRequest {
  return { requestId: crypto.randomUUID(), ...values };
}

function navigationForFinding(finding: GovernanceFinding): AtlasNavigation {
  const target = finding.target;
  if (target?.kind === "principal") {
    return {
      tab: "access",
      focus: focusRequest({
        principalId: target.principalId,
        itemId: target.itemId,
      }),
    };
  }
  if (target?.kind === "job") {
    return {
      tab: "jobs",
      focus: focusRequest({
        itemId: target.itemId,
        jobId: target.jobId,
        query: finding.title,
      }),
    };
  }
  if (target?.kind === "edge") {
    return { tab: "map" };
  }
  if (target?.kind === "workspace") {
    return { tab: "access" };
  }
  return {
    tab: "catalog",
    focus: focusRequest({ itemId: finding.itemId }),
  };
}

export function GovernanceCenterView({
  focus,
  onNavigate,
  onStateChange,
}: {
  focus?: AtlasFocusRequest;
  onNavigate: (navigation: AtlasNavigation) => void;
  onStateChange?: (navigation: AtlasNavigation) => void;
}) {
  const {
    data,
    history,
    historyLoading,
    historyError,
    savedViews,
    savedViewsLoading,
    savedViewsError,
    addSavedView,
    removeSavedView,
    loadHistorySnapshot,
  } = useAtlas();
  const initialSection =
    focus?.governanceSection ??
    (typeof focus?.filters?.section === "string"
      ? (focus.filters.section as GovernanceSection)
      : "findings");
  const [section, setSection] = useState<GovernanceSection>(initialSection);
  const [findingSearch, setFindingSearch] = useState(
    typeof focus?.filters?.search === "string" ? focus.filters.search : "",
  );
  const [severity, setSeverity] = useState<GovernanceSeverity | "all">(
    typeof focus?.filters?.severity === "string"
      ? (focus.filters.severity as GovernanceSeverity)
      : "all",
  );
  const [category, setCategory] = useState<GovernanceCategory | "all">(
    typeof focus?.filters?.category === "string"
      ? (focus.filters.category as GovernanceCategory)
      : "all",
  );
  const [changeSearch, setChangeSearch] = useState(
    typeof focus?.filters?.changeSearch === "string"
      ? focus.filters.changeSearch
      : "",
  );
  const [changeDomain, setChangeDomain] = useState<AtlasChangeDomain | "all">(
    typeof focus?.filters?.domain === "string"
      ? (focus.filters.domain as AtlasChangeDomain)
      : "all",
  );
  const [historyMetric, setHistoryMetric] = useState<HistoryMetric>(
    typeof focus?.filters?.metric === "string"
      ? (focus.filters.metric as HistoryMetric)
      : "items",
  );
  const [currentSnapshotId, setCurrentSnapshotId] = useState<
    string | undefined
  >(
    typeof focus?.filters?.currentSnapshotId === "string"
      ? focus.filters.currentSnapshotId
      : undefined,
  );
  const [previousSnapshotId, setPreviousSnapshotId] = useState<
    string | undefined
  >(
    typeof focus?.filters?.previousSnapshotId === "string"
      ? focus.filters.previousSnapshotId
      : undefined,
  );

  const availableSnapshotIds = new Set(
    history.summaries.map((snapshot) => snapshot.snapshotId),
  );
  const effectiveCurrentSnapshotId =
    currentSnapshotId && availableSnapshotIds.has(currentSnapshotId)
      ? currentSnapshotId
      : history.summaries[0]?.snapshotId ?? "";
  const effectivePreviousSnapshotId =
    previousSnapshotId &&
    availableSnapshotIds.has(previousSnapshotId) &&
    previousSnapshotId !== effectiveCurrentSnapshotId
      ? previousSnapshotId
      : history.summaries.find(
          (snapshot) =>
            snapshot.snapshotId !== effectiveCurrentSnapshotId,
        )?.snapshotId ?? "";

  const findings = useMemo(() => buildGovernanceFindings(data), [data]);
  const coverage = useMemo(() => getCoverageDiagnostics(data), [data]);
  const filteredFindings = useMemo(() => {
    const query = findingSearch.trim().toLowerCase();
    return findings.filter(
      (finding) =>
        (severity === "all" || finding.severity === severity) &&
        (category === "all" || finding.category === category) &&
        (!query ||
          finding.title.toLowerCase().includes(query) ||
          finding.detail.toLowerCase().includes(query) ||
          finding.recommendation.toLowerCase().includes(query)),
    );
  }, [category, findingSearch, findings, severity]);

  const selectedCurrent = history.snapshots.find(
    (snapshot) => snapshot.snapshotId === effectiveCurrentSnapshotId,
  );
  const selectedPrevious = history.snapshots.find(
    (snapshot) => snapshot.snapshotId === effectivePreviousSnapshotId,
  );
  const comparisonLoading =
    section === "changes" &&
    !historyError &&
    Boolean(effectiveCurrentSnapshotId && effectivePreviousSnapshotId) &&
    (!selectedCurrent || !selectedPrevious);

  useEffect(() => {
    if (section !== "changes") return;
    const missing = [
      effectiveCurrentSnapshotId,
      effectivePreviousSnapshotId,
    ].filter(
      (snapshotId) =>
        snapshotId &&
        !history.snapshots.some(
          (snapshot) => snapshot.snapshotId === snapshotId,
        ),
    );
    for (const snapshotId of missing) {
      void loadHistorySnapshot(snapshotId);
    }
  }, [
    effectiveCurrentSnapshotId,
    effectivePreviousSnapshotId,
    history.snapshots,
    loadHistorySnapshot,
    section,
  ]);
  const snapshotChanges = useMemo(() => {
    if (!selectedCurrent || !selectedPrevious) return [];
    const newer =
      Date.parse(selectedCurrent.syncedAt) >= Date.parse(selectedPrevious.syncedAt)
        ? selectedCurrent
        : selectedPrevious;
    const older = newer === selectedCurrent ? selectedPrevious : selectedCurrent;
    return compareSnapshots(older, newer);
  }, [selectedCurrent, selectedPrevious]);
  const filteredChanges = useMemo(() => {
    const query = changeSearch.trim().toLowerCase();
    return snapshotChanges.filter(
      (change) =>
        (changeDomain === "all" || change.domain === changeDomain) &&
        (!query ||
          change.label.toLowerCase().includes(query) ||
          change.type.toLowerCase().includes(query) ||
          (change.changedFields ?? []).some((field) =>
            field.toLowerCase().includes(query),
          )),
    );
  }, [changeDomain, changeSearch, snapshotChanges]);

  const coverageScore = Math.round(
    coverage.metrics
      .filter((metric) => metric.percentage != null)
      .reduce(
        (total, metric, _index, values) =>
          total + (metric.percentage ?? 0) / values.length,
        0,
      ),
  );
  const priorityFindings = findings.filter(
    (finding) =>
      finding.severity === "critical" || finding.severity === "high",
  ).length;
  const currentChanges =
    history.current == null
      ? 0
      : history.changes.filter(
          (change) => change.snapshotId === history.current?.snapshotId,
        ).length;
  const tabs: Array<{
    id: GovernanceSection;
    label: string;
    detail: string;
    count: number;
    icon: typeof ShieldCheck;
  }> = [
    {
      id: "findings",
      label: "Findings",
      detail: "Actionable governance checks",
      count: findings.length,
      icon: ShieldAlert,
    },
    {
      id: "changes",
      label: "Changes",
      detail: "Compare validated snapshots",
      count: currentChanges,
      icon: GitCompareArrows,
    },
    {
      id: "history",
      label: "History",
      detail: "Governance trends over time",
      count: history.summaries.length,
      icon: History,
    },
    {
      id: "coverage",
      label: "Coverage",
      detail: "Metadata and protection gaps",
      count: coverage.metrics.filter((metric) => metric.state !== "complete").length,
      icon: Layers3,
    },
  ];

  const currentFilters = useMemo<SavedViewFilters>(
    () => {
      const filters: SavedViewFilters = { section };
      if (section === "findings") {
        filters.search = findingSearch;
        filters.severity = severity;
        filters.category = category;
      } else if (section === "changes") {
        filters.changeSearch = changeSearch;
        filters.domain = changeDomain;
        filters.currentSnapshotId = effectiveCurrentSnapshotId;
        filters.previousSnapshotId = effectivePreviousSnapshotId;
      } else if (section === "history") {
        filters.metric = historyMetric;
      }
      return filters;
    },
    [
      category,
      changeDomain,
      changeSearch,
      findingSearch,
      historyMetric,
      effectiveCurrentSnapshotId,
      effectivePreviousSnapshotId,
      section,
      severity,
    ],
  );

  useEffect(() => {
    onStateChange?.({
      tab: "governance",
      focus: {
        requestId: "governance-view-state",
        governanceSection: section,
        filters: currentFilters,
      },
    });
  }, [currentFilters, onStateChange, section]);

  const applySavedView = (view: SavedView) => {
    const filters = view.filters;
    if (typeof filters.section === "string") {
      setSection(filters.section as GovernanceSection);
    }
    setFindingSearch(
      typeof filters.search === "string" ? filters.search : "",
    );
    setSeverity(
      typeof filters.severity === "string"
        ? (filters.severity as GovernanceSeverity)
        : "all",
    );
    setCategory(
      typeof filters.category === "string"
        ? (filters.category as GovernanceCategory)
        : "all",
    );
    setChangeSearch(
      typeof filters.changeSearch === "string" ? filters.changeSearch : "",
    );
    setChangeDomain(
      typeof filters.domain === "string"
        ? (filters.domain as AtlasChangeDomain)
        : "all",
    );
    setCurrentSnapshotId(
      typeof filters.currentSnapshotId === "string"
        ? filters.currentSnapshotId
        : undefined,
    );
    setPreviousSnapshotId(
      typeof filters.previousSnapshotId === "string"
        ? filters.previousSnapshotId
        : undefined,
    );
    if (typeof filters.metric === "string") {
      setHistoryMetric(filters.metric as HistoryMetric);
    }
  };

  return (
    <Tabs.Root
      value={section}
      onValueChange={(value) => setSection(value as GovernanceSection)}
      asChild
    >
    <div className="atlas-content-frame flex flex-col gap-l p-l sm:p-xxl">
      <Card className="overflow-hidden border-border shadow-fabric-4">
        <div className="atlas-fabric-hero relative overflow-hidden p-l sm:p-xl">
          <div className="relative flex flex-col gap-l lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-m">
              <span className="atlas-brand-mark flex icon-size-700 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
                <ShieldCheck className="icon-size-400" aria-hidden="true" />
              </span>
              <div>
                <SectionLabel>Govern / workspace assurance</SectionLabel>
                <h1 className="mt-xs font-heading text-600 font-bold leading-600">
                  Governance Center
                </h1>
                <p className="mt-xs max-w-3xl text-300 leading-300 text-muted-foreground">
                  See what changed, what needs attention, and where Fabric
                  metadata coverage is incomplete without leaving the workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-s">
              <SavedViewsMenu
                views={savedViews.filter(
                  (view) => view.section === "governance",
                )}
                loading={savedViewsLoading}
                error={savedViewsError}
                activeSection="governance"
                currentFilters={currentFilters}
                onCreate={addSavedView}
                onApply={applySavedView}
                onDelete={removeSavedView}
              />
              <span
                className={cn(
                  "rounded-full border px-m py-s text-200 font-semibold",
                  priorityFindings
                    ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
                    : "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
                )}
              >
                {priorityFindings
                  ? `${priorityFindings} priority findings`
                  : "No priority finding"}
              </span>
            </div>
          </div>

          <div className="relative mt-l grid grid-cols-2 gap-s lg:grid-cols-4">
            {[
              {
                label: "Open findings",
                value: findings.length,
                detail: `${priorityFindings} high priority`,
              },
              {
                label: "Latest changes",
                value: currentChanges,
                detail: history.summaries.length > 1 ? "Since previous sync" : "Needs two snapshots",
              },
              {
                label: "Coverage",
                value: `${coverageScore}%`,
                detail: "Across available metadata",
              },
              {
                label: "History",
                value: history.summaries.length,
                detail: "Validated snapshots",
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-border bg-background/65 p-m backdrop-blur"
              >
                <div className="font-numeric text-500 font-bold">
                  {metric.value}
                </div>
                <div className="text-200 font-semibold">{metric.label}</div>
                <div className="mt-xxs text-100 text-muted-foreground">
                  {metric.detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Tabs.List
          aria-label="Governance Center sections"
          className="grid gap-s border-t border-border bg-secondary/55 p-s sm:grid-cols-2 xl:grid-cols-4"
        >
          {tabs.map(({ id, label, detail, count, icon: Icon }) => (
            <Tabs.Trigger key={id} value={id} asChild>
              <button
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex items-center gap-m rounded-xl border px-m py-s text-left transition-colors",
                  section === id
                    ? "border-primary/45 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex icon-size-600 shrink-0 items-center justify-center rounded-xl",
                    section === id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="icon-size-200" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-s">
                    <span className="text-300 font-semibold">{label}</span>
                    <span className="rounded-full bg-card px-s py-xxs font-numeric text-100">
                      {count}
                    </span>
                  </span>
                  <span className="mt-xxs block truncate text-200">{detail}</span>
                </span>
              </button>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Card>

      {historyError && (
        <div
          role="alert"
          className="rounded-xl border border-status-warning/30 bg-status-warning/10 px-l py-m text-300 text-status-warning"
        >
          Snapshot history could not be loaded: {historyError}
        </div>
      )}

      <Tabs.Content value="findings" asChild>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <FindingsSection
            findings={filteredFindings}
            total={findings.length}
            search={findingSearch}
            severity={severity}
            category={category}
            onSearch={setFindingSearch}
            onSeverity={setSeverity}
            onCategory={setCategory}
            onNavigate={(finding) =>
              onNavigate(navigationForFinding(finding))
            }
            onPreset={(preset) => {
              if (preset === "external") {
                setFindingSearch("external access");
                setCategory("access");
                setSeverity("all");
              } else if (preset === "metadata") {
                setFindingSearch("");
                setCategory("metadata");
                setSeverity("all");
              } else if (preset === "failures") {
                setFindingSearch("failed");
                setCategory("operations");
                setSeverity("all");
              } else {
                setFindingSearch("");
                setCategory("all");
                setSeverity("all");
              }
            }}
          />
        </motion.div>
      </Tabs.Content>
      <Tabs.Content value="changes" asChild>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <ChangesSection
            changes={filteredChanges}
            total={snapshotChanges.length}
            snapshots={history.summaries}
            currentSnapshotId={effectiveCurrentSnapshotId}
            previousSnapshotId={effectivePreviousSnapshotId}
            search={changeSearch}
            domain={changeDomain}
            loading={historyLoading || comparisonLoading}
            onCurrentSnapshot={setCurrentSnapshotId}
            onPreviousSnapshot={setPreviousSnapshotId}
            onSearch={setChangeSearch}
            onDomain={setChangeDomain}
            onNavigate={(change) => {
              if (change.itemFabricId) {
                onNavigate({
                  tab:
                    change.domain === "schema" ? "assets" : "catalog",
                  focus: focusRequest({
                    itemId: change.itemFabricId,
                    objectName: change.objectName,
                    tableName: change.tableName,
                    objectKind: change.objectType,
                  }),
                });
              }
            }}
          />
        </motion.div>
      </Tabs.Content>
      <Tabs.Content value="history" asChild>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <HistorySection
            summaries={history.trend}
            metric={historyMetric}
            loading={historyLoading}
            onMetric={setHistoryMetric}
          />
        </motion.div>
      </Tabs.Content>
      <Tabs.Content value="coverage" asChild>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <CoverageSection
            diagnostics={coverage}
            historyLoading={historyLoading}
            syncSections={data.workspace.syncSections}
          />
        </motion.div>
      </Tabs.Content>
    </div>
    </Tabs.Root>
  );
}

function FindingsSection({
  findings,
  total,
  search,
  severity,
  category,
  onSearch,
  onSeverity,
  onCategory,
  onNavigate,
  onPreset,
}: {
  findings: GovernanceFinding[];
  total: number;
  search: string;
  severity: GovernanceSeverity | "all";
  category: GovernanceCategory | "all";
  onSearch: (value: string) => void;
  onSeverity: (value: GovernanceSeverity | "all") => void;
  onCategory: (value: GovernanceCategory | "all") => void;
  onNavigate: (finding: GovernanceFinding) => void;
  onPreset: (value: "all" | "external" | "metadata" | "failures") => void;
}) {
  const activeFilters = search || severity !== "all" || category !== "all";
  return (
    <div className="flex flex-col gap-l">
      <div className="grid gap-s sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["all", "All findings", ShieldCheck],
          ["external", "External access", KeyRound],
          ["metadata", "Metadata gaps", Layers3],
          ["failures", "Failed operations", Activity],
        ].map(([id, label, Icon]) => (
          <button
            key={id as string}
            type="button"
            onClick={() =>
              onPreset(id as "all" | "external" | "metadata" | "failures")
            }
            className="flex items-center gap-m rounded-xl border border-border bg-card p-m text-left hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex icon-size-600 items-center justify-center rounded-xl bg-primary/10 text-brand-foreground">
              <Icon className="icon-size-200" aria-hidden="true" />
            </span>
            <span className="text-300 font-semibold">{label as string}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-s border-b border-border bg-secondary/55 p-m lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search governance findings</span>
            <Search className="icon-size-200 pointer-events-none absolute left-m top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search finding, evidence or recommendation"
              className="h-9 w-full rounded-lg border border-input bg-card pl-xxxl pr-m text-300"
            />
          </label>
          <select
            aria-label="Filter findings by severity"
            value={severity}
            onChange={(event) =>
              onSeverity(event.target.value as GovernanceSeverity | "all")
            }
            className="h-9 rounded-lg border border-input bg-card px-m text-300"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            aria-label="Filter findings by category"
            value={category}
            onChange={(event) =>
              onCategory(event.target.value as GovernanceCategory | "all")
            }
            className="h-9 rounded-lg border border-input bg-card px-m text-300"
          >
            <option value="all">All categories</option>
            <option value="access">Access</option>
            <option value="metadata">Metadata</option>
            <option value="operations">Operations</option>
            <option value="lineage">Lineage</option>
          </select>
          {activeFilters && (
            <button
              type="button"
              onClick={() => onPreset("all")}
              className="inline-flex h-9 items-center gap-s rounded-lg px-m text-200 font-semibold text-primary hover:bg-primary/10"
            >
              <FilterX className="icon-size-100" />
              Reset
            </button>
          )}
        </div>
        <div className="flex items-center justify-between border-b border-border px-l py-m">
          <div>
            <h2 className="text-400 font-semibold">Action queue</h2>
            <p className="text-200 text-muted-foreground">
              {findings.length} of {total} findings
            </p>
          </div>
        </div>
        {findings.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-xl py-xxxl text-center">
            <CheckCircle2
              className="icon-size-600 text-status-healthy"
              aria-hidden="true"
            />
            <h3 className="mt-m text-400 font-semibold">
              No matching finding
            </h3>
            <p className="mt-xs text-300 text-muted-foreground">
              The current filters do not contain an action to review.
            </p>
          </div>
        ) : (
          <div className="grid gap-s p-s xl:grid-cols-2">
            {findings.map((finding) => {
              const meta = SEVERITY_META[finding.severity];
              return (
                <article
                  key={finding.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-m"
                >
                  <div className="flex items-start gap-m">
                    <span className={`mt-xs h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-s">
                        <span
                          className={cn(
                            "rounded-md border px-s py-xxs text-100 font-semibold uppercase tracking-wide",
                            meta.className,
                          )}
                        >
                          {meta.label}
                        </span>
                        <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                          {CATEGORY_LABEL[finding.category]}
                        </span>
                      </div>
                      <h3 className="mt-s text-300 font-semibold">
                        {finding.title}
                      </h3>
                      <p className="mt-xs text-200 leading-300 text-muted-foreground">
                        {finding.detail}
                      </p>
                    </div>
                  </div>
                  <div className="mt-m rounded-lg bg-secondary px-m py-s text-200 text-muted-foreground">
                    {finding.recommendation}
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(finding)}
                    className="mt-m inline-flex items-center gap-s self-start text-200 font-semibold text-primary hover:underline"
                  >
                    Open evidence
                    <ArrowRight className="icon-size-100" />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function ChangesSection({
  changes,
  total,
  snapshots,
  currentSnapshotId,
  previousSnapshotId,
  search,
  domain,
  loading,
  onCurrentSnapshot,
  onPreviousSnapshot,
  onSearch,
  onDomain,
  onNavigate,
}: {
  changes: AtlasChange[];
  total: number;
  snapshots: SnapshotSummary[];
  currentSnapshotId: string;
  previousSnapshotId: string;
  search: string;
  domain: AtlasChangeDomain | "all";
  loading: boolean;
  onCurrentSnapshot: (value: string) => void;
  onPreviousSnapshot: (value: string) => void;
  onSearch: (value: string) => void;
  onDomain: (value: AtlasChangeDomain | "all") => void;
  onNavigate: (change: AtlasChange) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-m border-b border-border bg-secondary/55 p-m lg:grid-cols-[1fr_1fr_auto]">
        <label>
          <span className="mb-xs block text-200 font-semibold text-muted-foreground">
            Newer snapshot
          </span>
          <select
            value={currentSnapshotId}
            onChange={(event) => onCurrentSnapshot(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card px-m text-300"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                {snapshotLabel(snapshot)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-xs block text-200 font-semibold text-muted-foreground">
            Baseline snapshot
          </span>
          <select
            value={previousSnapshotId}
            onChange={(event) => onPreviousSnapshot(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card px-m text-300"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                {snapshotLabel(snapshot)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <div className="rounded-lg border border-primary/25 bg-primary/10 px-l py-s">
            <div className="font-numeric text-400 font-bold">{total}</div>
            <div className="text-100 uppercase tracking-wide text-muted-foreground">
              changes
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-s border-b border-border p-m sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search snapshot changes</span>
          <Search className="icon-size-200 pointer-events-none absolute left-m top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search item, schema object or changed field"
            className="h-9 w-full rounded-lg border border-input bg-card pl-xxxl pr-m text-300"
          />
        </label>
        <select
          aria-label="Filter changes by domain"
          value={domain}
          onChange={(event) =>
            onDomain(event.target.value as AtlasChangeDomain | "all")
          }
          className="h-9 rounded-lg border border-input bg-card px-m text-300"
        >
          <option value="all">All domains</option>
          {Object.entries(CHANGE_DOMAIN_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-s text-300 text-muted-foreground">
          <Clock3 className="icon-size-200 animate-pulse" />
          Loading validated snapshot history
        </div>
      ) : snapshots.length < 2 ? (
        <div className="flex min-h-64 flex-col items-center justify-center px-xl py-xxxl text-center">
          <FileClock className="icon-size-600 text-muted-foreground" />
          <h3 className="mt-m text-400 font-semibold">
            A second snapshot is required
          </h3>
          <p className="mt-xs text-300 text-muted-foreground">
            Run another synchronization to compare workspace changes.
          </p>
        </div>
      ) : changes.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center px-xl py-xxxl text-center">
          <CheckCircle2 className="icon-size-600 text-status-healthy" />
          <h3 className="mt-m text-400 font-semibold">
            No matching change
          </h3>
          <p className="mt-xs text-300 text-muted-foreground">
            These snapshots are identical for the selected filter.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {changes.map((change) => (
            <article
              key={change.id}
              className="grid gap-m px-l py-m hover:bg-accent/40 lg:grid-cols-[150px_minmax(0,1fr)_auto]"
            >
              <div className="flex flex-wrap items-start gap-s">
                <span
                  className={cn(
                    "rounded-md border px-s py-xxs text-100 font-semibold uppercase tracking-wide",
                    changeTone(change),
                  )}
                >
                  {changeAction(change)}
                </span>
                <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                  {CHANGE_DOMAIN_LABEL[change.domain]}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-300 font-semibold">
                  {change.label}
                </h3>
                <p className="mt-xs text-200 text-muted-foreground">
                  {change.changedFields?.length
                    ? `Changed: ${change.changedFields.join(", ")}`
                    : change.type.replaceAll("-", " ")}
                </p>
                {(change.before !== undefined || change.after !== undefined) && (
                  <div className="mt-s grid gap-s text-100 sm:grid-cols-2">
                    <div className="rounded-lg bg-secondary px-s py-xs">
                      <span className="font-semibold text-muted-foreground">
                        Before
                      </span>
                      <div className="mt-xxs break-all font-mono">
                        {compactValue(change.before)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-primary/5 px-s py-xs">
                      <span className="font-semibold text-muted-foreground">
                        After
                      </span>
                      <div className="mt-xxs break-all font-mono">
                        {compactValue(change.after)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {change.itemFabricId && (
                <button
                  type="button"
                  onClick={() => onNavigate(change)}
                  className="inline-flex items-center gap-s self-start text-200 font-semibold text-primary hover:underline"
                >
                  Inspect
                  <ArrowRight className="icon-size-100" />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function HistorySection({
  summaries,
  metric,
  loading,
  onMetric,
}: {
  summaries: SnapshotSummary[];
  metric: HistoryMetric;
  loading: boolean;
  onMetric: (value: HistoryMetric) => void;
}) {
  const selectedMetric =
    HISTORY_METRICS.find((candidate) => candidate.id === metric) ??
    HISTORY_METRICS[0];
  const chartData = summaries.map((summary) => ({
    label: snapshotLabel(summary),
    value: Number(summary[metric] ?? 0),
  }));

  return (
    <div className="grid gap-l xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-m border-b border-border bg-secondary/55 px-l py-m sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionLabel>Validated snapshot trend</SectionLabel>
            <h2 className="mt-xs text-400 font-semibold">
              {selectedMetric.label}
            </h2>
            <p className="mt-xs text-200 text-muted-foreground">
              {selectedMetric.description}
            </p>
          </div>
          <label>
            <span className="sr-only">History metric</span>
            <select
              value={metric}
              onChange={(event) =>
                onMetric(event.target.value as HistoryMetric)
              }
              className="h-9 rounded-lg border border-input bg-card px-m text-300"
            >
              {HISTORY_METRICS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <div className="flex min-h-72 items-center justify-center gap-s text-300 text-muted-foreground">
            <Clock3 className="icon-size-200 animate-pulse" />
            Loading history
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center text-300 text-muted-foreground">
            No validated snapshot history is available.
          </div>
        ) : (
          <div className="p-m">
            <TrendChart
              title={`${selectedMetric.label} across validated snapshots`}
              data={chartData}
              valueLabel={(value) => String(value)}
            />
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border bg-secondary/55 px-l py-m">
          <h2 className="text-400 font-semibold">Snapshot ledger</h2>
          <p className="text-200 text-muted-foreground">
            Newest first · up to {ATLAS_CONFIG.snapshotRetentionCount} retained
          </p>
        </div>
        <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
          {[...summaries].reverse().map((snapshot, index) => (
            <div key={snapshot.snapshotId} className="px-l py-m">
              <div className="flex items-center justify-between gap-m">
                <div>
                  <div className="text-300 font-semibold">
                    {snapshotLabel(snapshot)}
                  </div>
                  <div className="mt-xxs font-mono text-100 text-muted-foreground">
                    {snapshot.snapshotId.slice(0, 12)}
                  </div>
                </div>
                {index === 0 && (
                  <span className="rounded-full border border-status-healthy/30 bg-status-healthy/10 px-s py-xxs text-100 font-semibold text-status-healthy">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-s grid grid-cols-3 gap-s text-center">
                {[
                  ["Items", snapshot.items],
                  ["Labels", snapshot.labels],
                  ["Failures", snapshot.failedJobs + snapshot.failing],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-secondary px-s py-xs">
                    <div className="font-numeric text-300 font-bold">{value}</div>
                    <div className="text-100 text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function CoverageSection({
  diagnostics,
  historyLoading,
  syncSections,
}: {
  diagnostics: ReturnType<typeof getCoverageDiagnostics>;
  historyLoading: boolean;
  syncSections?: NonNullable<
    ReturnType<typeof useAtlas>["data"]["workspace"]["syncSections"]
  >;
}) {
  const sectionEntries = Object.entries(syncSections ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return (
    <div className="flex flex-col gap-l">
      {sectionEntries.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-secondary/55 px-l py-m">
            <h2 className="text-400 font-semibold">Collection status</h2>
            <p className="text-200 text-muted-foreground">
              Authoritative status returned by the latest UDF contract.
            </p>
          </div>
          <div className="grid gap-s p-s sm:grid-cols-2 xl:grid-cols-4">
            {sectionEntries.map(([name, section]) => (
              <div
                key={name}
                className="flex items-center justify-between gap-m rounded-lg border border-border bg-card px-m py-s"
              >
                <span className="truncate text-200 font-semibold capitalize">
                  {name.replaceAll(/([a-z])([A-Z])/g, "$1 $2")}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-s py-xxs text-100 font-semibold uppercase tracking-wide",
                    section.status === "complete"
                      ? "border-status-healthy/30 bg-status-healthy/10 text-status-healthy"
                      : section.status === "failed"
                        ? "border-status-failing/30 bg-status-failing/10 text-status-failing"
                        : "border-border bg-muted text-muted-foreground",
                  )}
                  title={section.code}
                >
                  {section.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-m sm:grid-cols-2 xl:grid-cols-3">
        {diagnostics.metrics.map((metric) => {
          const value =
            metric.percentage == null ? null : Math.round(metric.percentage);
          return (
            <Card key={metric.id} className="overflow-hidden p-l">
              <div className="flex items-start justify-between gap-m">
                <div>
                  <h2 className="text-300 font-semibold">{metric.label}</h2>
                  <p className="mt-xs text-200 text-muted-foreground">
                    {metric.denominator
                      ? `${metric.numerator} of ${metric.denominator}`
                      : "Not applicable to the current inventory"}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-s py-xxs font-numeric text-200 font-semibold",
                    metric.state === "complete"
                      ? "border-status-healthy/30 bg-status-healthy/10 text-status-healthy"
                      : metric.state === "not-applicable"
                        ? "border-border bg-muted text-muted-foreground"
                        : "border-status-warning/30 bg-status-warning/10 text-status-warning",
                  )}
                >
                  {value == null ? "N/A" : `${value}%`}
                </span>
              </div>
              <div className="mt-m h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    metric.state === "complete"
                      ? "bg-status-healthy"
                      : "bg-primary",
                  )}
                  style={{ width: `${value ?? 0}%` }}
                />
              </div>
              {metric.state === "no-values" && (
                <p className="mt-s text-200 text-muted-foreground">
                  No value was returned. This may indicate unavailable metadata,
                  not a confirmed governance failure.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {historyLoading && (
        <div className="flex items-center gap-s rounded-xl border border-border bg-card px-l py-m text-200 text-muted-foreground">
          <Clock3 className="icon-size-100 animate-pulse" />
          Historical coverage is still loading.
        </div>
      )}

      <SensitivityView embedded />
    </div>
  );
}
