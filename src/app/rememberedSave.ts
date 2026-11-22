import type { ImportedGear } from "./saveImport.ts";

/**
 * The save file last opened with live updates, kept in IndexedDB (the only storage that can hold a
 * file handle) so it can be read again on a later visit without picking it
 */
export interface RememberedSave {
  handle: FileSystemFileHandle;
  /** The character slot picked */
  slot: number;
  /** The gear last imported, so reopening only changes what the save changed since */
  gear: ImportedGear | null;
  liveUpdates: boolean;
}

const dbName = "statCalculator";
const storeName = "saveFile";
const key = "last";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** @returns the remembered save, or undefined if there's none or storage is unavailable */
export async function loadRememberedSave(): Promise<RememberedSave | undefined> {
  try {
    return await run<RememberedSave | undefined>("readonly", (store) => store.get(key));
  } catch {
    return undefined;
  }
}

/** Remembers the save, or forgets it given null (failing quietly: it's only a convenience) */
export async function storeRememberedSave(save: RememberedSave | null) {
  try {
    if (save) await run("readwrite", (store) => store.put(save, key));
    else await run("readwrite", (store) => store.delete(key));
  } catch {
    // Storage may be unavailable (e.g. private browsing); the file just isn't remembered
  }
}
