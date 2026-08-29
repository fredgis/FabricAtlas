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

export interface CurrentUser {
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
  hasData: boolean;
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
    displayName: "Fabric workspace",
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
  currentUser = { name: "You (preview)" },
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
  const [syncError, setSyncError] = useState<string | undefined>();
  const progressResetTimer = useRef<number | undefined>(undefined);

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
    loadFromDb(false)
      .then((db) => {
        if (alive && db) {
          setData(db);
          setLastSyncedAt(db.syncRuns[0]?.finishedAt);
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
          reportedProgress = Math.max(reportedProgress, progress);
          setSyncProgress(reportedProgress);
          setSyncStage(stage);
        },
      );
      const next = fresh ?? clone(data);
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
      succeeded = true;
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
      setSyncProgress(0);
      setSyncStage("Sync failed");
    } finally {
      window.clearInterval(heartbeat);
      setSyncing(false);
      if (succeeded) {
        progressResetTimer.current = window.setTimeout(() => {
          setSyncProgress(0);
          setSyncStage("Ready to sync");
        }, 1200);
      }
    }
  }, [data, isPreview, currentUser]);

  const addComment = useCallback(
    async (body: string, itemFabricId?: string) => {
      const text = body.trim();
      if (!text) return;
      const comment: Comment = {
        id: `c-${Date.now()}`,
        itemFabricId,
        authorId: currentUser.email ?? currentUser.name,
        authorName: currentUser.name,
        authorEmail: currentUser.email,
        body: text,
        createdAt: new Date().toISOString(),
      };
      setData((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
      await persistComment(isPreview, comment);
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
      hasData,
      syncError,
      currentUser,
      sync,
      addComment,
    }),
    [data, hydrating, syncing, syncProgress, syncStage, lastSyncedAt, isPreview, configured, hasData, syncError, currentUser, sync, addComment],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within an AtlasProvider");
  return ctx;
}
