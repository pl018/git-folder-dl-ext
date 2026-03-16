/**
 * File Writer
 * Uses the File System Access API to write files directly to a user-chosen directory.
 * Stores the directory handle in IndexedDB for persistence across sessions.
 */

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

/**
 * Check if we have a stored directory handle with write permission.
 * @returns {Promise<{ hasHandle: boolean, name: string|null }>}
 */
export async function checkStoredDirectory() {
  try {
    const handle = await loadHandle();
    if (!handle) return { hasHandle: false, name: null };

    // Verify permission is still granted
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    return { hasHandle: perm === 'granted', name: handle.name };
  } catch {
    return { hasHandle: false, name: null };
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

    // Check current permission
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;

    // Try to request permission (requires user gesture context)
    perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

/**
 * Prompt the user to pick a download directory.
 * Must be called from a user gesture (click handler).
 * Stores the handle for future use.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await storeHandle(handle);
  console.log('[GFDL] Directory selected:', handle.name);
  return handle;
}

/**
 * Clear the stored directory handle.
 */
export async function forgetDirectory() {
  await clearHandle();
}

/**
 * Write a single file to the directory, creating subdirectories as needed.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath - e.g. "src/components/Button.tsx"
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
 * @param {Array<{relativePath: string, downloadUrl: string}>} files
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
        state.currentFile = file.relativePath;
        onProgress({ ...state });

        fetchAndWrite(dirHandle, file, token)
          .then(() => {
            state.completed++;
            running--;
            onProgress({ ...state });
            processNext();
          })
          .catch((err) => {
            state.errors.push(`${file.relativePath}: ${err.message || err}`);
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
  await writeFile(dirHandle, file.relativePath, blob);
}
