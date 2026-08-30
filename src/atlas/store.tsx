import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SAMPLE_DATA, type AtlasData, type Comment } from "./model";
import {
  loadFromDb,
  loadHistoryFromDb,
  loadHistoricalSnapshotFromDb,
  persistComment,
  runFabricSync,
} from "./backend";
import { ATLAS_CONFIG, isSyncConfigured } from "./config";
import {
  DEPLOYMENT_ID,
  sameDeploymentGeneration,
} from "./release";
import {
  buildAtlasHistory,
  snapshotFromData,
  type AtlasHistory,
} from "./history";
import {
  createSavedView,
  deleteSavedView,
  loadSavedViews,
  type SavedView,
  type SavedViewFilters,
  type SavedViewSection,
} from "./saved-views";
import {
  deleteFindingAck,
  loadFindingAcks,
  saveFindingAck,
  type FindingAcknowledgement,
  type FindingAckStatus,
} from "./finding-acks";

export interface CurrentUser {
  id: string;
  name: string;
  email?: string;
}

export interface AtlasContextValue {
  data: AtlasData;
  history: AtlasHistory;
  hydrating: boolean;
  historyLoading: boolean;
  historyError?: string;
  historyFailedSnapshotIds: Set<string>;
  savedViews: SavedView[];
  savedViewsLoading: boolean;
  savedViewsError?: string;
  findingAcks: FindingAcknowledgement[];
  findingAcksLoading: boolean;
  findingAcksError?: string;
  findingAckPendingIds: Set<string>;
  syncing: boolean;
  syncProgress: number;
  syncStage: string;
  lastSyncedAt?: string;
  isPreview: boolean;
  configured: boolean;
  canSync: boolean;
  hasData: boolean;
  requiresDeploymentSync: boolean;
  syncError?: string;
  currentUser: CurrentUser;
  sync: () => Promise<void>;
  addComment: (body: string, itemFabricId?: string) => Promise<void>;
  addSavedView: (input: {
    name: string;
    section: SavedViewSection;
    filters: SavedViewFilters;
  }) => Promise<void>;
  removeSavedView: (id: string) => Promise<void>;
  saveFindingAcknowledgement: (input: {
    findingId: string;
    occurrenceSnapshotId?: string;
    status: FindingAckStatus;
    note?: string;
  }) => Promise<void>;
  removeFindingAcknowledgement: (id: string) => Promise<void>;
  loadHistorySnapshot: (snapshotId: string) => Promise<void>;
}

const AtlasContext = createContext<AtlasContextValue | null>(null);

function clone(d: AtlasData): AtlasData {
  return JSON.parse(JSON.stringify(d));
}

function historyAfterSync(
  previous: AtlasHistory,
  currentData: AtlasData,
): AtlasHistory {
  const snapshotId = currentData.workspace.snapshotId;
  if (!snapshotId) return previous;
  const limit = ATLAS_CONFIG.snapshotRetentionCount;
  const current = snapshotFromData(currentData, snapshotId);
  return buildAtlasHistory(
    [
      current,
      ...previous.snapshots.filter(
        (snapshot) => snapshot.snapshotId !== snapshotId,
      ),
    ].slice(0, limit),
    previous.summaries
      .filter((summary) => summary.snapshotId !== snapshotId)
      .slice(0, Math.max(0, limit - 1)),
  );
}

const EMPTY_DATA: AtlasData = {
  workspace: {
    fabricId: ATLAS_CONFIG.workspaceId,
    displayName: ATLAS_CONFIG.workspaceName,
    capacity: "",
    region: "",
  },
  items: [],
  edges: [],
  principals: [],
  grants: [],
  jobs: [],
  config: [],
  comments: [],
  syncRuns: [],
  schema: {},
};

const EMPTY_HISTORY = buildAtlasHistory([]);
const PREVIEW_HISTORY = buildAtlasHistory([
  snapshotFromData(SAMPLE_DATA, "preview-current"),
]);

export function AtlasProvider({
  children,
  isPreview = true,
  currentUser = { id: "preview-user", name: "You (preview)" },
}: {
  children: ReactNode;
  isPreview?: boolean;
  currentUser?: CurrentUser;
}) {
  // Preview shows the sample estate; deployed starts empty and is filled by the
  // first Sync (or by re-reading a previous sync from the database on open).
  const [data, setData] = useState<AtlasData>(() =>
    isPreview ? clone(SAMPLE_DATA) : clone(EMPTY_DATA),
  );
  const [history, setHistory] = useState<AtlasHistory>(() =>
    isPreview ? PREVIEW_HISTORY : EMPTY_HISTORY,
  );
  const [hydrating, setHydrating] = useState(!isPreview);
  const [historyLoading, setHistoryLoading] = useState(!isPreview);
  const [historyError, setHistoryError] = useState<string | undefined>();
  const [historyFailedSnapshotIds, setHistoryFailedSnapshotIds] = useState(
    new Set<string>(),
  );
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(!isPreview);
  const [savedViewsError, setSavedViewsError] = useState<string | undefined>();
  const [findingAcks, setFindingAcks] = useState<FindingAcknowledgement[]>([]);
  const [findingAcksLoading, setFindingAcksLoading] = useState(!isPreview);
  const [findingAcksError, setFindingAcksError] = useState<string | undefined>();
  const [findingAckPendingIds, setFindingAckPendingIds] = useState(
    new Set<string>(),
  );
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState("Ready to sync");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(
    isPreview ? SAMPLE_DATA.syncRuns[0]?.finishedAt : undefined,
  );
  const [configured] = useState<boolean>(isSyncConfigured());
  const canSync =
    isPreview ||
    (!!currentUser.email &&
      currentUser.email.trim().toLowerCase() ===
        ATLAS_CONFIG.syncAdminEmail.trim().toLowerCase());
  const [requiresDeploymentSync, setRequiresDeploymentSync] = useState(
    !isPreview,
  );
  const [syncError, setSyncError] = useState<string | undefined>();
  const progressResetTimer = useRef<number | undefined>(undefined);
  const operationGeneration = useRef(0);
  const dataRef = useRef(data);
  const historyRef = useRef(history);
  const historyLoadCount = useRef(0);
  const historyLoads = useRef(new Set<string>());
  const findingAcksRef = useRef(findingAcks);
  const findingAckQueues = useRef(new Map<string, Promise<void>>());
  const findingAckGeneration = useRef(0);
  const findingAcksLoadingRef = useRef(findingAcksLoading);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    findingAcksRef.current = findingAcks;
  }, [findingAcks]);

  useEffect(() => {
    findingAcksLoadingRef.current = findingAcksLoading;
  }, [findingAcksLoading]);

  useEffect(
    () => () => {
      if (progressResetTimer.current != null) {
        window.clearTimeout(progressResetTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (isPreview) return;
    let alive = true;
    void loadSavedViews(
      false,
      data.workspace.fabricId,
      currentUser.id,
    )
      .then((views) => {
        if (alive) setSavedViews(views);
      })
      .catch((error) => {
        if (alive) {
          setSavedViewsError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (alive) setSavedViewsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [currentUser.id, data.workspace.fabricId, isPreview]);

  useEffect(() => {
    if (isPreview) return;
    const generation = findingAckGeneration.current + 1;
    findingAckGeneration.current = generation;
    findingAcksLoadingRef.current = true;
    let alive = true;
    window.queueMicrotask(() => {
      if (!alive || findingAckGeneration.current !== generation) return;
      findingAckQueues.current.clear();
      setFindingAcks([]);
      setFindingAcksError(undefined);
      setFindingAcksLoading(!isPreview);
      setFindingAckPendingIds(new Set());
    });
    void loadFindingAcks(
      false,
      data.workspace.fabricId,
      currentUser.id,
    )
      .then((acknowledgements) => {
        if (alive && findingAckGeneration.current === generation) {
          setFindingAcks(acknowledgements);
        }
      })
      .catch((error) => {
        if (alive && findingAckGeneration.current === generation) {
          setFindingAcksError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (alive && findingAckGeneration.current === generation) {
          findingAcksLoadingRef.current = false;
          setFindingAcksLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [currentUser.id, data.workspace.fabricId, isPreview]);

  // On open (deployed): remember the workspace id and re-hydrate from the DB.
  useEffect(() => {
    if (isPreview) return;
    (window as unknown as { __atlasWorkspaceId?: string }).__atlasWorkspaceId =
      (import.meta.env.VITE_FABRIC_WORKSPACE_ID as string) ?? ATLAS_CONFIG.workspaceId;
    let alive = true;
    const generation = operationGeneration.current;
    void loadFromDb(false)
      .then((db) => {
        if (!alive || operationGeneration.current !== generation) return;
        if (!db) {
          setHistoryLoading(false);
          return;
        }
        setData(db);
        setLastSyncedAt(
          db.workspace.syncedAt ?? db.syncRuns[0]?.finishedAt,
        );
        setRequiresDeploymentSync(
          !sameDeploymentGeneration(
            db.workspace.deploymentId,
            DEPLOYMENT_ID,
          ),
        );
        setHydrating(false);
        setHistoryLoading(true);
        setHistoryError(undefined);
        void loadHistoryFromDb(false, db)
          .then((loadedHistory) => {
            if (alive && operationGeneration.current === generation) {
              setHistory(loadedHistory);
            }
          })
          .catch((error) => {
            if (alive && operationGeneration.current === generation) {
              setHistoryError(
                error instanceof Error ? error.message : String(error),
              );
            }
          })
          .finally(() => {
            if (alive && operationGeneration.current === generation) {
              setHistoryLoading(false);
            }
          });
      })
      .catch(() => {
        if (alive && operationGeneration.current === generation) {
          setHistoryLoading(false);
        }
      })
      .finally(() => {
        if (alive) setHydrating(false);
      });
    return () => {
      alive = false;
    };
  }, [isPreview]);

  const sync = useCallback(async () => {
    if (!canSync) {
      setSyncError(
        "Only the configured Atlas sync administrator can synchronize this workspace.",
      );
      return;
    }
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    historyLoads.current.clear();
    historyLoadCount.current = 0;
    setHistoryFailedSnapshotIds(new Set());
    if (progressResetTimer.current != null) {
      window.clearTimeout(progressResetTimer.current);
    }
    setSyncing(true);
    setSyncProgress(3);
    setSyncStage("Starting workspace sync");
    setSyncError(undefined);
    setHistoryLoading(false);
    const startedAt = new Date().toISOString();
    let succeeded = false;
    let reportedProgress = 3;
    const heartbeat = window.setInterval(() => {
      if (operationGeneration.current !== generation) return;
      if (reportedProgress < 42) {
        reportedProgress += 1;
        setSyncProgress(reportedProgress);
        if (reportedProgress >= 12) setSyncStage("Scanning workspace metadata");
      }
    }, 900);
    try {
      const fresh = await runFabricSync(
        isPreview,
        currentUser,
        (progress, stage) => {
          if (operationGeneration.current !== generation) return;
          reportedProgress = Math.max(reportedProgress, progress);
          setSyncProgress(reportedProgress);
          setSyncStage(stage);
        },
      );
      if (operationGeneration.current !== generation) return;
      const previous = dataRef.current;
      const next = fresh ?? clone(previous);
      if (fresh) {
        const comments = new Map(
          [...fresh.comments, ...previous.comments].map((comment) => [
            [
              comment.itemFabricId ?? "",
              comment.authorId,
              comment.body,
              comment.createdAt,
            ].join("\u0000"),
            comment,
          ]),
        );
        next.comments = [...comments.values()];
      }
      const finishedAt =
        next.workspace.syncedAt ?? new Date().toISOString();
      next.syncRuns = [
        {
          id: `s-${Date.now()}`,
          startedAt,
          finishedAt,
          status: "completed" as const,
          itemsSynced: next.items.length,
          triggeredBy: currentUser.name,
          summary: `${next.items.length} items · ${next.edges.length} lineage edges · ${next.principals.length} principals · ${next.jobs.length} jobs`,
        },
        ...next.syncRuns,
      ].slice(0, 20);
      setData(next);
      setHistory((previousHistory) =>
        historyAfterSync(previousHistory, next),
      );
      setLastSyncedAt(finishedAt);
      setHistoryError(undefined);
      setHistoryLoading(true);
      void loadHistoryFromDb(isPreview, next)
        .then((loadedHistory) => {
          if (operationGeneration.current === generation) {
            setHistory(loadedHistory);
          }
        })
        .catch((error) => {
          if (operationGeneration.current === generation) {
            setHistoryError(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          if (operationGeneration.current === generation) {
            setHistoryLoading(false);
          }
        });
      setSyncProgress(100);
      setSyncStage("Workspace is ready");
      if (!isPreview) {
        setRequiresDeploymentSync(false);
      }
      succeeded = true;
    } catch (err) {
      if (operationGeneration.current !== generation) return;
      setSyncError(err instanceof Error ? err.message : String(err));
      setSyncProgress(0);
      setSyncStage("Sync failed");
    } finally {
      window.clearInterval(heartbeat);
      if (operationGeneration.current === generation) {
        setSyncing(false);
      }
      if (succeeded && operationGeneration.current === generation) {
        progressResetTimer.current = window.setTimeout(() => {
          setSyncProgress(0);
          setSyncStage("Ready to sync");
        }, 1200);
      }
    }
  }, [canSync, isPreview, currentUser]);

  const addComment = useCallback(
    async (body: string, itemFabricId?: string) => {
      const text = body.trim();
      if (!text) return;
      const comment: Comment = {
        id: `c-${Date.now()}`,
        itemFabricId,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorEmail: currentUser.email,
        body: text,
        createdAt: new Date().toISOString(),
      };
      await persistComment(isPreview, comment);
      setData((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
    },
    [currentUser, isPreview],
  );

  const addSavedView = useCallback(
    async (input: {
      name: string;
      section: SavedViewSection;
      filters: SavedViewFilters;
    }) => {
      setSavedViewsError(undefined);
      try {
        const view = await createSavedView(
          isPreview,
          data.workspace.fabricId,
          currentUser.id,
          input,
        );
        setSavedViews((previous) => [
          view,
          ...previous.filter((candidate) => candidate.id !== view.id),
        ]);
      } catch (error) {
        setSavedViewsError(
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    [currentUser.id, data.workspace.fabricId, isPreview],
  );

  const removeSavedView = useCallback(
    async (id: string) => {
      setSavedViewsError(undefined);
      try {
        await deleteSavedView(isPreview, id);
        setSavedViews((previous) =>
          previous.filter((candidate) => candidate.id !== id),
        );
      } catch (error) {
        setSavedViewsError(
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    [isPreview],
  );

  const saveFindingAcknowledgement = useCallback(
    async (input: {
      findingId: string;
      occurrenceSnapshotId?: string;
      status: FindingAckStatus;
      note?: string;
    }) => {
      if (findingAcksLoadingRef.current) {
        const error = new Error(
          "Personal acknowledgement state is still loading.",
        );
        setFindingAcksError(error.message);
        throw error;
      }
      const generation = findingAckGeneration.current;
      const previous =
        findingAckQueues.current.get(input.findingId) ??
        Promise.resolve();
      const operation = previous
        .catch(() => undefined)
        .then(async () => {
          setFindingAcksError(undefined);
          const current = findingAcksRef.current.find(
            (acknowledgement) =>
              acknowledgement.findingId === input.findingId,
          );
          const saved = await saveFindingAck(
            isPreview,
            data.workspace.fabricId,
            currentUser.id,
            { ...input, current },
          );
          if (findingAckGeneration.current !== generation) return;
          setFindingAcks((existing) => [
            saved,
            ...existing.filter(
              (acknowledgement) =>
                acknowledgement.findingId !== saved.findingId,
            ),
          ]);
        });
      findingAckQueues.current.set(input.findingId, operation);
      setFindingAckPendingIds((pending) => {
        const next = new Set(pending);
        next.add(input.findingId);
        return next;
      });
      try {
        await operation;
      } catch (error) {
        if (findingAckGeneration.current !== generation) return;
        setFindingAcksError(
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        if (findingAckQueues.current.get(input.findingId) === operation) {
          findingAckQueues.current.delete(input.findingId);
          setFindingAckPendingIds((pending) => {
            const next = new Set(pending);
            next.delete(input.findingId);
            return next;
          });
        }
      }
    },
    [currentUser.id, data.workspace.fabricId, isPreview],
  );

  const removeFindingAcknowledgement = useCallback(
    async (id: string) => {
      if (findingAcksLoadingRef.current) {
        const error = new Error(
          "Personal acknowledgement state is still loading.",
        );
        setFindingAcksError(error.message);
        throw error;
      }
      const generation = findingAckGeneration.current;
      setFindingAcksError(undefined);
      try {
        await deleteFindingAck(isPreview, id);
        if (findingAckGeneration.current !== generation) return;
        setFindingAcks((previous) =>
          previous.filter((acknowledgement) => acknowledgement.id !== id),
        );
      } catch (error) {
        if (findingAckGeneration.current !== generation) return;
        setFindingAcksError(
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    [isPreview],
  );

  const loadHistorySnapshot = useCallback(
    async (snapshotId: string) => {
      if (
        !snapshotId ||
        historyRef.current.snapshots.some(
          (snapshot) => snapshot.snapshotId === snapshotId,
        ) ||
        historyLoads.current.has(snapshotId)
      ) {
        return;
      }
      historyLoads.current.add(snapshotId);
      historyLoadCount.current += 1;
      const generation = operationGeneration.current;
      setHistoryLoading(true);
      setHistoryError(undefined);
      setHistoryFailedSnapshotIds((previous) => {
        if (!previous.has(snapshotId)) return previous;
        const next = new Set(previous);
        next.delete(snapshotId);
        return next;
      });
      try {
        const snapshot = await loadHistoricalSnapshotFromDb(
          isPreview,
          snapshotId,
        );
        if (generation !== operationGeneration.current) return;
        if (!snapshot) {
          throw new Error("The selected snapshot is no longer available.");
        }
        setHistory((previous) =>
          buildAtlasHistory(
            [...previous.snapshots, snapshot],
            previous.summaries,
          ),
        );
      } catch (error) {
        if (generation !== operationGeneration.current) return;
        setHistoryFailedSnapshotIds((previous) => {
          const next = new Set(previous);
          next.add(snapshotId);
          return next;
        });
        setHistoryError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (generation === operationGeneration.current) {
          historyLoads.current.delete(snapshotId);
          historyLoadCount.current -= 1;
          if (historyLoadCount.current === 0) setHistoryLoading(false);
        }
      }
    },
    [isPreview],
  );

  const hasData = data.items.length > 0 || !!data.workspace.snapshotId;

  const value = useMemo<AtlasContextValue>(
    () => ({
      data,
      history,
      hydrating,
      historyLoading,
      historyError,
      historyFailedSnapshotIds,
      savedViews,
      savedViewsLoading,
      savedViewsError,
      findingAcks,
      findingAcksLoading,
      findingAcksError,
      findingAckPendingIds,
      syncing,
      syncProgress,
      syncStage,
      lastSyncedAt,
      isPreview,
      configured,
      canSync,
      hasData,
      requiresDeploymentSync,
      syncError,
      currentUser,
      sync,
      addComment,
      addSavedView,
      removeSavedView,
      saveFindingAcknowledgement,
      removeFindingAcknowledgement,
      loadHistorySnapshot,
    }),
    [data, history, hydrating, historyLoading, historyError, historyFailedSnapshotIds, savedViews, savedViewsLoading, savedViewsError, findingAcks, findingAcksLoading, findingAcksError, findingAckPendingIds, syncing, syncProgress, syncStage, lastSyncedAt, isPreview, configured, canSync, hasData, requiresDeploymentSync, syncError, currentUser, sync, addComment, addSavedView, removeSavedView, saveFindingAcknowledgement, removeFindingAcknowledgement, loadHistorySnapshot],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within an AtlasProvider");
  return ctx;
}
