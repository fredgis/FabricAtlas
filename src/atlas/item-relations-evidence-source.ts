import { useEffect, useState } from "react";
import {
  ItemRelationsContractError,
  parseItemRelationsEvidence,
  type ItemRelationsEvidence,
} from "./item-relations-evidence";

/** Resolves the latest persisted evidence envelope, or `null` when none exists. */
export type ItemRelationsEvidenceLoader = (
  workspaceId: string,
  signal: AbortSignal,
) => Promise<unknown>;

// No reviewed Rayfin entity stores Item Relations evidence yet; the collector
// shadow persists aggregate counts only. Reporting "none" keeps the UI honest
// until a dedicated evidence store is added.
export const loadPersistedItemRelationsEvidence: ItemRelationsEvidenceLoader =
  async () => null;

export type ItemRelationsEvidenceState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; evidence: ItemRelationsEvidence };

interface LoadedEvidence {
  requestKey: string;
  loader: ItemRelationsEvidenceLoader;
  state: Exclude<ItemRelationsEvidenceState, { status: "off" | "loading" }>;
}

/**
 * Loads persisted Preview evidence only while `active`. The envelope is
 * validated against the active workspace before it reaches the UI.
 */
export function useItemRelationsEvidence(
  workspaceId: string,
  active: boolean,
  loader: ItemRelationsEvidenceLoader,
  attempt = 0,
): ItemRelationsEvidenceState {
  const requestKey = active && workspaceId ? `${workspaceId}|${attempt}` : "";
  const [loaded, setLoaded] = useState<LoadedEvidence | null>(null);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const finish = (state: LoadedEvidence["state"]) => {
      if (!controller.signal.aborted) {
        setLoaded({ requestKey, loader, state });
      }
    };
    loader(workspaceId, controller.signal)
      .then((value) =>
        finish(
          value == null
            ? { status: "empty" }
            : {
                status: "ready",
                evidence: parseItemRelationsEvidence(value, workspaceId),
              },
        ),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        finish({
          status: "error",
          message:
            error instanceof ItemRelationsContractError
              ? "Persisted Item Relations evidence failed validation and is not shown."
              : "Persisted Item Relations evidence could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [loader, requestKey, workspaceId]);

  if (!requestKey) return { status: "off" };
  if (
    !loaded ||
    loaded.requestKey !== requestKey ||
    loaded.loader !== loader
  ) {
    return { status: "loading" };
  }
  return loaded.state;
}
