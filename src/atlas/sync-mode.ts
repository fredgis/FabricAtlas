/** User choice between incremental (default) and full synchronization, kept per browser. */
export type SyncModePreference = "incremental" | "full";

const KEY = "fabric-atlas.sync-mode";

export function preferredSyncMode(): SyncModePreference {
  try {
    return globalThis.localStorage?.getItem(KEY) === "full" ? "full" : "incremental";
  } catch {
    return "incremental";
  }
}

export function setPreferredSyncMode(mode: SyncModePreference): void {
  try {
    globalThis.localStorage?.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the choice applies to this page only through component state */
  }
}
