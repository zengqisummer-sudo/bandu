// 极简 IndexedDB 封装。两个 object store：
//   kv    — 目录句柄等运行时杂项
//   files — 浏览器模式（降级）下的虚拟文件系统，key 为 "state:…" / "product:…"

const DB_NAME = "ai-reader";
const DB_VERSION = 1;
export type StoreName = "kv" | "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return tx<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>);
}

export function idbSet(store: StoreName, key: string, value: unknown): Promise<unknown> {
  return tx(store, "readwrite", (s) => s.put(value, key));
}

export function idbDel(store: StoreName, key: string): Promise<unknown> {
  return tx(store, "readwrite", (s) => s.delete(key));
}

export async function idbKeys(store: StoreName, prefix?: string): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys());
  const all = keys.map(String);
  return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
}
