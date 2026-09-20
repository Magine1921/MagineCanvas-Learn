/**
 * 画布「素材」节点大图（data URL）侧车存储，避免 localStorage 截断或配额导致退出后丢失。
 * http(s) / blob / asset 等仍直接存在 JSON 中。
 */

const DB_NAME = 'magine-canvas';
const DB_VERSION = 1;
const STORE = 'materialBlobs';

export type MaterialBlobPayload = {
  fileUrl: string;
  thumbnailUrl: string;
};

const REF_PREFIX = 'idb://magine/material/v1/';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('indexedDB open failed'));
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  return dbPromise;
}

export function isMaterialIdbRef(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(REF_PREFIX);
}

export function materialRefToNodeId(ref: string): string {
  return decodeURIComponent(ref.slice(REF_PREFIX.length));
}

export function materialNodeIdToRef(nodeId: string): string {
  return `${REF_PREFIX}${encodeURIComponent(nodeId)}`;
}

export async function putMaterialBlob(nodeId: string, payload: MaterialBlobPayload): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb tx'));
    tx.onabort = () => reject(tx.error ?? new Error('idb tx abort'));
    tx.objectStore(STORE).put(payload, nodeId);
  });
}

export async function getMaterialBlob(nodeId: string): Promise<MaterialBlobPayload | null> {
  try {
    const db = await openDb();
    return await new Promise<MaterialBlobPayload | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error ?? new Error('idb tx'));
      const req = tx.objectStore(STORE).get(nodeId);
      req.onerror = () => reject(req.error ?? new Error('idb get'));
      req.onsuccess = () => {
        const v = req.result;
        if (!v || typeof v !== 'object') {
          resolve(null);
          return;
        }
        const o = v as Record<string, unknown>;
        const fileUrl = typeof o.fileUrl === 'string' ? o.fileUrl : '';
        const thumbnailUrl = typeof o.thumbnailUrl === 'string' ? o.thumbnailUrl : '';
        if (!fileUrl && !thumbnailUrl) resolve(null);
        else resolve({ fileUrl: fileUrl || thumbnailUrl, thumbnailUrl: thumbnailUrl || fileUrl });
      };
    });
  } catch {
    return null;
  }
}

export async function deleteMaterialBlob(nodeId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb tx'));
      tx.objectStore(STORE).delete(nodeId);
    });
  } catch {
    /* ignore */
  }
}

/** 删除所有不在 keepIds 中的素材 blob（换工作流 / 导入时 GC） */
export async function deleteMaterialBlobsExcept(keepIds: ReadonlySet<string>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb tx'));
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (!keepIds.has(key)) {
          cursor.delete();
        }
        cursor.continue();
      };
    });
  } catch {
    /* ignore */
  }
}

export async function deleteAllMaterialBlobs(): Promise<void> {
  await deleteMaterialBlobsExcept(new Set());
}
