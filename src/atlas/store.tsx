import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SAMPLE_DATA, type AtlasData, type Comment } from "./model";
import { loadFromDb, persistComment, runFabricSync } from "./backend";
import { ATLAS_CONFIG, isSyncConfigured, setUdfUrl } from "./config";

export interface CurrentUser {
  name: string;
  email?: string;
}

export interface AtlasContextValue {
  data: AtlasData;
  syncing: boolean;
  lastSyncedAt?: string;
  isPreview: boolean;
  configured: boolean;
  hasData: boolean;
  syncError?: string;
  currentUser: CurrentUser;
  sync: () => Promise<void>;
  setSyncUrl: (url: string) => void;
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
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(
    isPreview ? SAMPLE_DATA.syncRuns[0]?.finishedAt : undefined,
  );
  const [configured, setConfigured] = useState<boolean>(isSyncConfigured());
  const [syncError, setSyncError] = useState<string | undefined>();

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
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isPreview]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(undefined);
    const startedAt = new Date().toISOString();
    try {
      const fresh = await runFabricSync(isPreview, currentUser);
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
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [data, isPreview, currentUser]);

  const setSyncUrl = useCallback((url: string) => {
    setUdfUrl(url);
    setConfigured(isSyncConfigured());
  }, []);

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

  const hasData = data.items.length > 0 || data.comments.length > 0;

  const value = useMemo<AtlasContextValue>(
    () => ({
      data,
      syncing,
      lastSyncedAt,
      isPreview,
      configured,
      hasData,
      syncError,
      currentUser,
      sync,
      setSyncUrl,
      addComment,
    }),
    [data, syncing, lastSyncedAt, isPreview, configured, hasData, syncError, currentUser, sync, setSyncUrl, addComment],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within an AtlasProvider");
  return ctx;
}
