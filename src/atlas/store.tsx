import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SAMPLE_DATA, type AtlasData, type Comment } from "./model";
import { persistComment, runFabricSync } from "./backend";

export interface CurrentUser {
  name: string;
  email?: string;
}

export interface AtlasContextValue {
  data: AtlasData;
  syncing: boolean;
  lastSyncedAt?: string;
  isPreview: boolean;
  currentUser: CurrentUser;
  sync: () => Promise<void>;
  addComment: (body: string, itemFabricId?: string) => Promise<void>;
}

const AtlasContext = createContext<AtlasContextValue | null>(null);

function clone(d: AtlasData): AtlasData {
  return JSON.parse(JSON.stringify(d));
}

export function AtlasProvider({
  children,
  isPreview = true,
  currentUser = { name: "You (preview)" },
}: {
  children: ReactNode;
  isPreview?: boolean;
  currentUser?: CurrentUser;
}) {
  const [data, setData] = useState<AtlasData>(() => clone(SAMPLE_DATA));
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(
    SAMPLE_DATA.syncRuns[0]?.finishedAt,
  );

  const sync = useCallback(async () => {
    setSyncing(true);
    const startedAt = new Date().toISOString();
    try {
      // Deployed: read the Fabric REST APIs and persist into the Rayfin
      // entities, then reload. Preview: refresh timestamps on the sample set.
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
    } finally {
      setSyncing(false);
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

  const value = useMemo<AtlasContextValue>(
    () => ({ data, syncing, lastSyncedAt, isPreview, currentUser, sync, addComment }),
    [data, syncing, lastSyncedAt, isPreview, currentUser, sync, addComment],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within an AtlasProvider");
  return ctx;
}
