/**
 * File Writer
 * Uses the File System Access API to write files directly to a user-chosen directory.
 * Stores the directory handle in IndexedDB for persistence across sessions.
 */

import { DIRECTORY_ACCESS_STATES, resolveDirectoryAccessState } from './directory-state.js';

const DB_NAME = 'gfdl-storage';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'downloadDir';

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
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  await chrome.storage.local.set({
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
  console.log('[GFDL] Directory selected:', handle.name);
  return handle;
}

/**
 * Clear the stored directory handle.
 */
export async function forgetDirectory() {
  await clearHandle();
  await syncDirectoryMetadata({ handle: null, accessState: DIRECTORY_ACCESS_STATES.MISSING });
}

/**
 * Write a single file to the directory, creating subdirectories as needed.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath - e.g. "repo/src/components/Button.tsx"
 * @param {Blob|ArrayBuffer|string} data
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

  // Write the file
  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Download and write multiple files with progress tracking.
 * Fetches each file from its URL and writes to the target directory.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {Array<{targetPath: string, downloadUrl: string}>} files
 * @param {Object} options
 * @param {string|null} [options.token] - GitHub auth token
 * @param {number} [options.concurrency=3] - Max concurrent downloads
 * @param {(progress: {completed: number, total: number, currentFile: string, errors: string[]}) => void} [options.onProgress]
 * @returns {Promise<{completed: number, errors: string[]}>}
 */
export async function writeFiles(dirHandle, files, options = {}) {
  const {
    token = null,
    concurrency = 3,
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

  await new Promise((resolve) => {
    function processNext() {
      while (running < concurrency && fileIndex < files.length) {
        const file = files[fileIndex++];
        running++;
        state.currentFile = file.targetPath;
        onProgress({ ...state });

        fetchAndWrite(dirHandle, file, token)
          .then(() => {
            state.completed++;
            running--;
            onProgress({ ...state });
            processNext();
          })
          .catch((err) => {
            state.errors.push(`${file.targetPath}: ${err.message || err}`);
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

  return { completed: state.completed, errors: state.errors };
}

/**
 * Fetch a file and write it to the directory.
 */
async function fetchAndWrite(dirHandle, file, token) {
  const headers = {};
  if (token) headers['Authorization'] = `token ${token}`;

  const res = await fetch(file.downloadUrl, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const blob = await res.blob();
  await writeFile(dirHandle, file.targetPath, blob);
}
