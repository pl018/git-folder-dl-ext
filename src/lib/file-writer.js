/**
 * File Writer
 * Uses the File System Access API to write files directly to a user-chosen directory.
 * Stores the directory handle in IndexedDB for persistence across sessions.
 */

import { DIRECTORY_ACCESS_STATES, resolveDirectoryAccessState } from './directory-state.js';
import { set as setStorage } from './storage.js';

const DB_NAME = 'gfdl-storage';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'downloadDir';
const CANCELLED_ERROR = 'DOWNLOAD_CANCELLED';

// ---- IndexedDB helpers ----

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Public API ----

async function syncDirectoryMetadata({ handle = null, accessState }) {
  await setStorage({
    downloadDirectoryName: handle?.name || '',
    hasDirectoryHandle: !!handle,
    directoryAccessState: accessState
  });
}

/**
 * Check if we have a stored directory handle with write permission.
 * @returns {Promise<{ hasHandle: boolean, name: string|null, accessState: string }>}
 */
export async function checkStoredDirectory() {
  try {
    const handle = await loadHandle();
    if (!handle) {
      const accessState = DIRECTORY_ACCESS_STATES.MISSING;
      await syncDirectoryMetadata({ handle: null, accessState });
      return { hasHandle: false, name: null, accessState };
    }

    const perm = await handle.queryPermission({ mode: 'readwrite' });
    const accessState = resolveDirectoryAccessState(true, perm);
    await syncDirectoryMetadata({ handle, accessState });
    return { hasHandle: true, name: handle.name, accessState };
  } catch {
    const accessState = DIRECTORY_ACCESS_STATES.MISSING;
    await syncDirectoryMetadata({ handle: null, accessState });
    return { hasHandle: false, name: null, accessState };
  }
}

/**
 * Get the stored directory handle, requesting permission if needed.
 * Returns null if no handle is stored or permission is denied.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function getDirectory() {
  try {
    const handle = await loadHandle();
    if (!handle) return null;

    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;

    perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

/**
 * Ensure we have a writable directory handle for direct saves.
 * Must be called from a user gesture when prompting is enabled.
 * @returns {Promise<{ ok: boolean, handle: FileSystemDirectoryHandle|null, name: string|null, reason: string }>}
 */
export async function ensureWritableDirectory(options = {}) {
  const {
    promptIfMissing = false,
    promptIfExpired = false
  } = options;

  let handle = null;
  let hadStoredHandle = false;

  try {
    handle = await loadHandle();
    hadStoredHandle = !!handle;

    if (!handle) {
      if (!promptIfMissing) {
        const reason = DIRECTORY_ACCESS_STATES.MISSING;
        await syncDirectoryMetadata({ handle: null, accessState: reason });
        return { ok: false, handle: null, name: null, reason };
      }

      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await storeHandle(handle);
    }

    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && promptIfExpired) {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }

    const reason = resolveDirectoryAccessState(true, permission);
    await syncDirectoryMetadata({ handle, accessState: reason });

    if (permission !== 'granted') {
      return { ok: false, handle: null, name: handle.name, reason };
    }

    return {
      ok: true,
      handle,
      name: handle.name,
      reason: DIRECTORY_ACCESS_STATES.READY
    };
  } catch (error) {
    const reason = hadStoredHandle
      ? DIRECTORY_ACCESS_STATES.EXPIRED
      : DIRECTORY_ACCESS_STATES.MISSING;

    await syncDirectoryMetadata({ handle, accessState: reason });

    if (error?.name === 'AbortError') {
      return { ok: false, handle: null, name: handle?.name || null, reason };
    }
    throw error;
  }
}

/**
 * Prompt the user to pick a new download directory and persist it.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await storeHandle(handle);
  await syncDirectoryMetadata({ handle, accessState: DIRECTORY_ACCESS_STATES.READY });
  await setStorage({ nativeFolderPath: '' });
  console.log('[GFDL] Directory selected:', handle.name);
  return handle;
}

/**
 * Clear the stored directory handle.
 */
export async function forgetDirectory() {
  await clearHandle();
  await syncDirectoryMetadata({ handle: null, accessState: DIRECTORY_ACCESS_STATES.MISSING });
  await setStorage({ nativeFolderPath: '' });
}

export function createCancelState() {
  return { cancelled: false };
}

export function cancelWriteJob(cancelState) {
  cancelState.cancelled = true;
}

/**
 * Write a single file to the directory, creating subdirectories as needed.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath - e.g. "repo/src/components/Button.tsx"
 * @param {Blob|ArrayBuffer|string} data
 * @returns {Promise<{ targetPath: string, existed: boolean, previousData: ArrayBuffer|null }>}
 */
export async function writeFile(dirHandle, relativePath, data) {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid path: ${relativePath}`);

  // Create nested directories
  let current = dirHandle;
  for (const dirName of parts) {
    current = await current.getDirectoryHandle(dirName, { create: true });
  }

  let existed = true;
  let previousData = null;
  try {
    const existingHandle = await current.getFileHandle(fileName);
    previousData = await (await existingHandle.getFile()).arrayBuffer();
  } catch {
    existed = false;
  }

  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();

  return { targetPath: relativePath, existed, previousData };
}

/**
 * Download and write multiple files with progress tracking.
 * Fetches each file from its URL and writes to the target directory.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {Array<{targetPath: string, downloadUrl: string}>} files
 * @param {Object} options
 * @param {number} [options.concurrency=3] - Max concurrent downloads
 * @param {{cancelled: boolean}} [options.cancelState]
 * @param {(file: {targetPath: string, downloadUrl: string}) => Promise<Blob|ArrayBuffer|string>} [options.fetchFile]
 * @param {(progress: {completed: number, total: number, currentFile: string, errors: string[]}) => void} [options.onProgress]
 * @returns {Promise<{completed: number, errors: string[], cancelled?: boolean, rolledBack?: number}>}
 */
export async function writeFiles(dirHandle, files, options = {}) {
  const {
    concurrency = 3,
    cancelState = createCancelState(),
    fetchFile = null,
    onProgress = () => {}
  } = options;

  const state = {
    completed: 0,
    total: files.length,
    currentFile: '',
    errors: []
  };

  // Process with concurrency limit
  let fileIndex = 0;
  let running = 0;
  const rollbackEntries = [];

  await new Promise((resolve) => {
    function processNext() {
      if (cancelState.cancelled) {
        if (running === 0) resolve();
        return;
      }

      while (running < concurrency && fileIndex < files.length) {
        const file = files[fileIndex++];
        running++;
        state.currentFile = file.targetPath;
        onProgress({ ...state });

        fetchAndWrite(dirHandle, file, fetchFile, cancelState)
          .then(() => {
            rollbackEntries.push(file.rollbackEntry);
            state.completed++;
            running--;
            onProgress({ ...state });
            processNext();
          })
          .catch((err) => {
            if (!isCancellationError(err)) {
              state.errors.push(`${file.targetPath}: ${err.message || err}`);
            }
            state.completed++;
            running--;
            onProgress({ ...state });
            processNext();
          });
      }

      if (running === 0 && fileIndex >= files.length) {
        resolve();
      }
    }

    processNext();
  });

  if (cancelState.cancelled) {
    const rolledBack = await rollbackWrittenFiles(dirHandle, rollbackEntries);
    return {
      completed: state.completed,
      errors: [],
      cancelled: true,
      rolledBack
    };
  }

  return { completed: state.completed, errors: state.errors };
}

/**
 * Fetch a file and write it to the directory.
 */
async function fetchAndWrite(dirHandle, file, fetchFile, cancelState) {
  throwIfCancelled(cancelState);
  let data;

  if (fetchFile) {
    data = await fetchFile(file);
  } else {
    const res = await fetch(file.downloadUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    data = await res.blob();
  }

  throwIfCancelled(cancelState);
  file.rollbackEntry = await writeFile(dirHandle, file.targetPath, data);
}

function throwIfCancelled(cancelState) {
  if (cancelState?.cancelled) {
    const error = new Error('Download canceled');
    error.code = CANCELLED_ERROR;
    throw error;
  }
}

function isCancellationError(error) {
  return error?.code === CANCELLED_ERROR;
}

async function rollbackWrittenFiles(dirHandle, rollbackEntries) {
  const uniqueEntries = dedupeRollbackEntries(rollbackEntries).sort((left, right) => right.targetPath.length - left.targetPath.length);
  let rolledBack = 0;

  for (const entry of uniqueEntries) {
    try {
      await rollbackWrittenPath(dirHandle, entry);
      rolledBack++;
    } catch {}
  }

  return rolledBack;
}

async function rollbackWrittenPath(dirHandle, entry) {
  if (entry.existed && entry.previousData) {
    await writeFile(dirHandle, entry.targetPath, entry.previousData);
    return;
  }

  const parts = entry.targetPath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;

  let current = dirHandle;
  const directories = [];

  for (const dirName of parts) {
    directories.push({ parent: current, name: dirName });
    current = await current.getDirectoryHandle(dirName);
  }

  await current.removeEntry(fileName);

  for (let idx = directories.length - 1; idx >= 0; idx--) {
    const { parent, name } = directories[idx];
    try {
      await parent.removeEntry(name);
    } catch {
      break;
    }
  }
}

function dedupeRollbackEntries(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    if (entry?.targetPath) {
      byPath.set(entry.targetPath, entry);
    }
  }
  return Array.from(byPath.values());
}
