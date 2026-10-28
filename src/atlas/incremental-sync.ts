import type { RawSync } from "./live-sync";

export type SyncPlanMode = "full" | "incremental";

export interface SyncPlanItem {
  id: string;
  /** Fabric modification timestamp; items without one are always re-enriched. */
  modifiedAt?: string;
}

export interface SyncPlan {
  mode: SyncPlanMode;
  refresh: string[];
  reuse: string[];
  reason?: "no-previous-snapshot" | "generation-changed" | "no-modified-date";
}

/**
 * Decides which items need fresh enrichment. Incremental reuse only applies to
 * items whose modification date is known on both sides and unchanged; any
 * schema/generation change forces a full run.
 */
export function planIncrementalSync(input: {
  generation: number;
  current: readonly SyncPlanItem[];
  previous?: { generation: number; items: readonly SyncPlanItem[] };
}): SyncPlan {
  const all = input.current.map((item) => item.id);
  if (!input.previous) return { mode: "full", refresh: all, reuse: [], reason: "no-previous-snapshot" };
  if (input.previous.generation !== input.generation) {
    return { mode: "full", refresh: all, reuse: [], reason: "generation-changed" };
  }
  const before = new Map(input.previous.items.map((item) => [item.id, item.modifiedAt]));
  const reuse: string[] = [];
  const refresh: string[] = [];
  for (const item of input.current) {
    const previous = before.get(item.id);
    if (item.modifiedAt && previous && previous === item.modifiedAt) reuse.push(item.id);
    else refresh.push(item.id);
  }
  if (reuse.length === 0) {
    const dated = input.current.some((item) => item.modifiedAt);
    return { mode: "full", refresh, reuse, ...(dated ? {} : { reason: "no-modified-date" as const }) };
  }
  return { mode: "incremental", refresh, reuse };
}

/** Copies the previous per-item enrichment for reused items into a fresh core snapshot. */
export function applyReusedEnrichment(fresh: RawSync, previous: RawSync, reuse: readonly string[]): RawSync {
  const ids = new Set(reuse);
  const pick = <T>(source: Record<string, T> | undefined) =>
    Object.fromEntries(Object.entries(source ?? {}).filter(([id]) => ids.has(id)));
  return {
    ...fresh,
    schema: { ...fresh.schema, ...pick(previous.schema) },
    artifactMetadata: { ...fresh.artifactMetadata, ...pick(previous.artifactMetadata) },
    config: [
      ...(fresh.config ?? []).filter((entry) => !ids.has(String(entry.itemId))),
      ...(previous.config ?? []).filter((entry) => ids.has(String(entry.itemId))),
    ],
  };
}

const SUMMARY = /sync=(full|incremental); refreshed=(\d+); reused=(\d+)/;

export function syncPlanSummary(plan: SyncPlan): string {
  return `sync=${plan.mode}; refreshed=${plan.refresh.length}; reused=${plan.reuse.length}`;
}

export function parseSyncPlanSummary(
  summary: string | undefined,
): { mode: SyncPlanMode; refreshed: number; reused: number } | undefined {
  const match = summary ? SUMMARY.exec(summary) : null;
  if (!match) return undefined;
  return { mode: match[1] as SyncPlanMode, refreshed: Number(match[2]), reused: Number(match[3]) };
}
