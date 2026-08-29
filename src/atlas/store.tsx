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
import { loadFromDb, persistComment, runFabricSync } from "./backend";
import { ATLAS_CONFIG, isSyncConfigured } from "./config";
import { DEPLOYMENT_ID } from "./release";

export interface CurrentUser {
  id: string;
  name: string;
  email?: string;
}

export interface AtlasContextValue {
  data: AtlasData;
  hydrating: boolean;
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
}

const AtlasContext = createContext<AtlasContextValue | null>(null);

function clone(d: AtlasData): AtlasData {
  return JSON.parse(JSON.stringify(d));
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
  const [hydrating, setHydrating] = useState(!isPreview);
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

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(
    () => () => {
      if (progressResetTimer.current != null) {
        window.clearTimeout(progressResetTimer.current);
      }
    },
    [],
  );

  // On open (deployed): remember the workspace id and re-hydrate from the DB.
  useEffect(() => {
    if (isPreview) return;
    (window as unknown as { __atlasWorkspaceId?: string }).__atlasWorkspaceId =
      (import.meta.env.VITE_FABRIC_WORKSPACE_ID as string) ?? ATLAS_CONFIG.workspaceId;
    let alive = true;
    const generation = operationGeneration.current;
    loadFromDb(false)
      .then((db) => {
        if (alive && db && operationGeneration.current === generation) {
          setData(db);
          setLastSyncedAt(db.syncRuns[0]?.finishedAt);
          setRequiresDeploymentSync(
            db.workspace.deploymentId !== DEPLOYMENT_ID,
          );
        }
      })
      .catch(() => undefined)
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
    if (progressResetTimer.current != null) {
      window.clearTimeout(progressResetTimer.current);
    }
    setSyncing(true);
    setSyncProgress(3);
    setSyncStage("Starting workspace sync");
    setSyncError(undefined);
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
      const finishedAt = new Date().toISOString();
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
      setLastSyncedAt(finishedAt);
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

  const hasData = data.items.length > 0;

  const value = useMemo<AtlasContextValue>(
    () => ({
      data,
      hydrating,
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
    }),
    [data, hydrating, syncing, syncProgress, syncStage, lastSyncedAt, isPreview, configured, canSync, hasData, requiresDeploymentSync, syncError, currentUser, sync, addComment],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within an AtlasProvider");
  return ctx;
}
