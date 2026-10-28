import type { RawSync } from "./live-sync";

/** Last complete collection of a workspace, kept in the browser to enable incremental sync. */
export interface CachedCollection {
  workspaceId: string;
  generation: number;
  raw: RawSync;
}

export interface CollectionCache {
  load(workspaceId: string): Promise<CachedCollection | undefined>;
  save(entry: CachedCollection): Promise<void>;
}

const DB = "fabric-atlas-sync";
const STORE = "collections";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** IndexedDB-backed cache; returns null where IndexedDB is unavailable so every run stays full. */
export function browserCollectionCache(): CollectionCache | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async load(workspaceId) {
      const entry = await run("readonly", (store) => store.get(workspaceId)) as CachedCollection | undefined;
      return entry && entry.workspaceId === workspaceId && entry.raw ? entry : undefined;
    },
    async save(entry) {
      await run("readwrite", (store) => store.put(entry, entry.workspaceId));
    },
  };
}
