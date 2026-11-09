import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionInventoryUnavailableError,
  defaultConnectionStoreApi,
  readConnectionInventory,
  readLatestConnectionInventory,
  type ConnectionInventorySummary,
  type ConnectionStoreApi,
} from "./connection-inventory-store";
import type { ConnectionInventoryView } from "./connections";
import { previewConnectionInventory, previewPreviousConnectionInventory } from "./connections-demo";

export interface ConnectionCollectionIssue {
  reason: "invalid-response" | "unsupported" | "failed";
  code?: string;
  at: string;
}

export interface ConnectionInventoryState {
  inventory?: ConnectionInventoryView;
  /** Why the last synchronization in this session could not refresh the inventory. */
  issue?: ConnectionCollectionIssue;
  loading: boolean;
  error?: string;
  /** True when the connection entities are not deployed. */
  unavailable: boolean;
  previous?: ConnectionInventoryView;
  previousLoading: boolean;
  /** Reading the earlier inventory failed; it is not retried until the next reload. */
  previousError?: string;
  /** An earlier inventory exists to compare with. */
  previousAvailable: boolean;
  reload: () => Promise<void>;
  loadPrevious: () => Promise<void>;
  /** Replaces the latest inventory after a synchronization stored a new one. */
  setLatest: (inventory: ConnectionInventoryView) => void;
  /** Records why a synchronization kept the previous inventory. */
  reportIssue: (issue: ConnectionCollectionIssue) => void;
}

/** Latest tenant connection inventory for the live view; preview uses sample data. */
export function useConnectionInventoryState(
  isPreview: boolean,
  storeFactory: () => Promise<ConnectionStoreApi> = defaultConnectionStoreApi,
): ConnectionInventoryState {
  const [inventory, setInventory] = useState<ConnectionInventoryView | undefined>(() =>
    isPreview ? previewConnectionInventory() : undefined,
  );
  const [loading, setLoading] = useState(!isPreview);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [previousSummary, setPreviousSummary] = useState<ConnectionInventorySummary>();
  const [previous, setPrevious] = useState<ConnectionInventoryView>();
  const [previousLoading, setPreviousLoading] = useState(false);
  const [previousError, setPreviousError] = useState<string>();
  const [issue, setIssue] = useState<ConnectionCollectionIssue>();
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (isPreview) {
      setInventory(previewConnectionInventory());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const api = await storeFactory();
      const result = await readLatestConnectionInventory(api);
      if (generation.current !== current) return;
      setUnavailable(false);
      setInventory(result.latest);
      setPreviousSummary(result.previous);
      setPrevious(undefined);
      setPreviousError(undefined);
    } catch (reason) {
      if (generation.current !== current) return;
      if (reason instanceof ConnectionInventoryUnavailableError) {
        setUnavailable(true);
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [isPreview, storeFactory]);

  useEffect(() => {
    let alive = true;
    window.queueMicrotask(() => {
      if (alive) void reload();
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  const loadPrevious = useCallback(async () => {
    if (previous || previousLoading || previousError) return;
    if (isPreview) {
      setPrevious(previewPreviousConnectionInventory());
      return;
    }
    if (!previousSummary) return;
    const current = generation.current;
    setPreviousLoading(true);
    try {
      const api = await storeFactory();
      const loaded = await readConnectionInventory(api, previousSummary);
      if (generation.current === current) setPrevious(loaded);
    } catch (reason) {
      if (generation.current === current) setPreviousError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreviousLoading(false);
    }
  }, [isPreview, previous, previousError, previousLoading, previousSummary, storeFactory]);

  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const setLatest = useCallback((next: ConnectionInventoryView) => {
    generation.current += 1;
    const current = inventoryRef.current;
    // The inventory that was current becomes the comparison baseline.
    if (current?.id && current.id !== next.id) {
      setPrevious(current);
      setPreviousSummary(undefined);
      setPreviousError(undefined);
    }
    inventoryRef.current = next;
    setInventory(next);
    setUnavailable(false);
    setError(undefined);
    setIssue(undefined);
    setLoading(false);
  }, []);

  const reportIssue = useCallback((next: ConnectionCollectionIssue) => setIssue(next), []);

  return {
    inventory,
    issue,
    loading,
    error,
    unavailable,
    previous,
    previousLoading,
    previousError,
    previousAvailable: isPreview || !!previous || !!previousSummary,
    reload,
    loadPrevious,
    setLatest,
    reportIssue,
  };
}
