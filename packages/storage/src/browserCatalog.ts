import { createDirectoryFiles, type BrowserDirectoryHandle } from "./browserFiles";

export interface BrowserSpaceRecord {
  id: string;
  name: string;
  tier: "folder" | "library";
  handle?: BrowserDirectoryHandle;
}

const databaseName = "slate-spaces";

async function catalogRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("spaces", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("spaces", mode);
      const request = action(transaction.objectStore("spaces"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally { db.close(); }
}

export const listBrowserSpaces = (): Promise<BrowserSpaceRecord[]> => catalogRequest("readonly", (store) => store.getAll());
export const rememberBrowserSpace = (record: BrowserSpaceRecord): Promise<IDBValidKey> => catalogRequest("readwrite", (store) => store.put(record));

export async function openBrowserLibrary(id: string) {
  if (typeof navigator.storage?.getDirectory !== "function") {
    throw new Error("This browser does not provide private file storage. Use a modern browser, or try a temporary Sample Space.");
  }
  const root = await navigator.storage.getDirectory();
  const spaces = await root.getDirectoryHandle("spaces", { create: true });
  const directory = await spaces.getDirectoryHandle(id, { create: true });
  return createDirectoryFiles(directory as unknown as BrowserDirectoryHandle);
}
