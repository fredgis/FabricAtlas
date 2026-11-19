import { useEffect, useState } from "react";
import { loadInsightSnapshotFromDb } from "./backend";
import type { InsightWorkspaceSnapshot } from "./insights";
import type { PersistedWorkspaceSyncStatus } from "./workspace-sync";

type Loader = (isPreview: boolean, workspaceId: string) => Promise<InsightWorkspaceSnapshot | null>;

/** Module cache so revisiting Insights does not re-read unchanged snapshots. */
const cache = new Map<string, Promise<InsightWorkspaceSnapshot | null>>();

export function clearInsightSnapshotCache(): void {
  cache.clear();
}

/**
 * Loads the latest validated snapshot of each requested workspace (other than
 * the active one, which the store already holds) for the cross-workspace
 * Insights charts. Entries are cached per workspace and snapshot id, so a new
 * synchronization is picked up automatically.
 */
export function useInsightSnapshots(input: {
  isPreview: boolean;
  workspaceIds: readonly string[];
  statuses: Readonly<Record<string, PersistedWorkspaceSyncStatus>>;
  load?: Loader;
}): { snapshots: Record<string, InsightWorkspaceSnapshot | null>; loading: boolean } {
  const { isPreview, statuses } = input;
  const load = input.load ?? loadInsightSnapshotFromDb;
  const requests = isPreview
    ? []
    : input.workspaceIds.flatMap((id) => {
      const status = Object.entries(statuses).find(([key]) => key.toLowerCase() === id.toLowerCase())?.[1];
      return status?.snapshotId ? [{ id: id.toLowerCase(), key: `${id.toLowerCase()}:${status.snapshotId}` }] : [];
    });
  const signature = requests.map((request) => request.key).sort().join("|");
  const [state, setState] = useState<{ signature: string; snapshots: Record<string, InsightWorkspaceSnapshot | null> }>({ signature: "", snapshots: {} });

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    const entries = signature.split("|").map((key) => {
      const id = key.slice(0, key.indexOf(":"));
      let pending = cache.get(key);
      if (!pending) {
        pending = load(isPreview, id).catch((error: unknown) => {
          cache.delete(key);
          console.warn("[atlas] insights snapshot failed", id, error);
          return null;
        });
        cache.set(key, pending);
      }
      return pending.then((snapshot) => [id, snapshot] as const);
    });
    void Promise.all(entries).then((loaded) => {
      if (!cancelled) setState({ signature, snapshots: Object.fromEntries(loaded) });
    });
    return () => {
      cancelled = true;
    };
  }, [isPreview, load, signature]);

  if (!signature) return { snapshots: {}, loading: false };
  return { snapshots: state.snapshots, loading: state.signature !== signature };
}
