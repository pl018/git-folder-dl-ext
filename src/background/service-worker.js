/**
 * Service Worker (Background Script)
 * Handles GitHub API calls and file downloads.
 * Two download modes:
 *   1. Directory handle stored (via popup Browse) → File System Access API, writes directly
 *   2. No handle → chrome.downloads fallback (browser's Downloads folder)
 */

import { getAll, get, set } from '../lib/storage.js';
import { getAuthStatus, validateToken, startDeviceFlow, pollForToken } from '../lib/auth.js';
import { getTree, filterTree, buildRawUrl, getDefaultBranch } from '../lib/github-api.js';
import { downloadFiles } from '../lib/download-manager.js';

const LOG = '[GFDL-SW]';

// ---- IndexedDB for directory handle (same origin as popup) ----

const DB_NAME = 'gfdl-storage';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'downloadDir';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

async function getDirHandle() {
  try {
    const handle = await loadHandle();
    if (!handle) return null;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;
    // Can't requestPermission from service worker (no user gesture), return null
    return null;
  } catch {
    return null;
  }
}

// ---- File writing via File System Access API ----

async function writeFileToDir(dirHandle, relativePath, blob) {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid path: ${relativePath}`);

  let current = dirHandle;
  for (const dirName of parts) {
    current = await current.getDirectoryHandle(dirName, { create: true });
  }

  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function downloadViaFileSystem(dirHandle, files, token, concurrency, onProgress) {
  const state = { completed: 0, total: files.length, currentFile: '', errors: [] };
  let fileIndex = 0;
  let running = 0;

  await new Promise((resolve) => {
    function processNext() {
      while (running < concurrency && fileIndex < files.length) {
        const file = files[fileIndex++];
        running++;
        state.currentFile = file.relativePath;
        onProgress({ ...state });

        (async () => {
          try {
            const headers = {};
            if (token) headers['Authorization'] = `token ${token}`;
            const res = await fetch(file.downloadUrl, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            await writeFileToDir(dirHandle, file.relativePath, blob);
            state.completed++;
          } catch (err) {
            state.errors.push(`${file.relativePath}: ${err.message}`);
            state.completed++;
          }
          running--;
          onProgress({ ...state });
          processNext();
        })();
      }
      if (running === 0 && fileIndex >= files.length) resolve();
    }
    processNext();
  });

  return { completed: state.completed, errors: state.errors };
}

// ---- Message handler ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  console.log(LOG, 'Message:', type);

  switch (type) {
    case 'GET_AUTH_STATUS':
      handleGetAuthStatus().then(sendResponse).catch(e => sendResponse({ authenticated: false, error: e.message }));
      return true;

    case 'SAVE_TOKEN':
      handleSaveToken(payload).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'AUTH_DEVICE_FLOW':
      handleDeviceFlow(payload).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'POLL_DEVICE_TOKEN':
      handlePollDeviceToken(payload).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'RESOLVE_DOWNLOADS':
      handleResolveDownloads(payload).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'START_DOWNLOAD':
      handleStartDownload(payload, sender.tab?.id).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'CANCEL_DOWNLOAD':
      sendResponse({ ok: true });
      return false;

    case 'OPEN_DOWNLOADS_FOLDER':
      chrome.downloads.showDefaultFolder();
      sendResponse({ ok: true });
      return false;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
  }
});

// ---- Handlers ----

async function handleGetAuthStatus() {
  return await getAuthStatus();
}

async function handleSaveToken({ token, tokenType = 'pat' }) {
  const v = await validateToken(token);
  if (!v.valid) return { ok: false, error: 'Invalid token' };
  await set({ githubToken: token, tokenType });
  return { ok: true, username: v.username };
}

async function handleDeviceFlow({ clientId, scope }) {
  const r = await startDeviceFlow(clientId, scope);
  return { ok: true, ...r };
}

async function handlePollDeviceToken({ clientId, deviceCode, interval }) {
  const token = await pollForToken(clientId, deviceCode, interval);
  const v = await validateToken(token);
  if (!v.valid) return { ok: false, error: 'Token validation failed' };
  await set({ githubToken: token, tokenType: 'oauth' });
  return { ok: true, token, username: v.username };
}

async function handleResolveDownloads({ owner, repo, branch, selections }) {
  const settings = await getAll();
  const token = settings.githubToken;
  if (!branch) branch = await getDefaultBranch(owner, repo, token);

  const tree = await getTree(owner, repo, branch, token);
  const files = resolveFiles(tree, selections, owner, repo, branch);

  if (files.length === 0) {
    return { ok: false, error: `No files found for: ${selections.map(s => s.path || s).join(', ')}` };
  }
  return { ok: true, files, token };
}

async function handleStartDownload({ owner, repo, branch, selections }, tabId) {
  console.log(LOG, 'START_DOWNLOAD:', { owner, repo, branch, selections });

  const settings = await getAll();
  const token = settings.githubToken;

  if (!branch) {
    branch = await getDefaultBranch(owner, repo, token);
    console.log(LOG, 'Branch:', branch);
  }

  const tree = await getTree(owner, repo, branch, token);
  console.log(LOG, 'Tree:', tree.length, 'items');

  const files = resolveFiles(tree, selections, owner, repo, branch);

  if (files.length === 0) {
    const paths = selections.map(s => s.path || s).join(', ');
    return { ok: false, error: `No files found for: ${paths}` };
  }

  console.log(LOG, `${files.length} files to download`);

  // Notify content script
  sendToTab(tabId, 'DOWNLOAD_PROGRESS', { completed: 0, total: files.length, currentFile: '', errors: [] });

  // Try File System Access API first (directory handle from popup)
  const dirHandle = await getDirHandle();

  if (dirHandle) {
    console.log(LOG, 'Using File System Access →', dirHandle.name);

    // Apply prefix
    const prefix = settings.downloadPrefix;
    const prefixedFiles = files.map(f => ({
      relativePath: prefix ? `${prefix}/${f.relativePath}` : f.relativePath,
      downloadUrl: f.downloadUrl
    }));

    const result = await downloadViaFileSystem(dirHandle, prefixedFiles, token, settings.concurrentDownloads, (progress) => {
      sendToTab(tabId, 'DOWNLOAD_PROGRESS', progress);
    });

    console.log(LOG, 'Done:', result.completed, 'files,', result.errors.length, 'errors');
    sendToTab(tabId, 'DOWNLOAD_COMPLETE', { total: result.completed, errors: result.errors });

    if (settings.openAfterDownload) chrome.downloads.showDefaultFolder();
    return { ok: true, ...result };

  } else {
    console.log(LOG, 'Using chrome.downloads fallback');

    const prefix = settings.downloadPrefix ? `${settings.downloadPrefix}/${repo}` : repo;

    const result = await downloadFiles(files, {
      prefix,
      token,
      concurrency: settings.concurrentDownloads,
      onProgress: (progress) => sendToTab(tabId, 'DOWNLOAD_PROGRESS', progress)
    });

    console.log(LOG, 'Done:', result.completed, 'files,', result.errors.length, 'errors');
    sendToTab(tabId, 'DOWNLOAD_COMPLETE', { total: result.completed, errors: result.errors });

    if (settings.openAfterDownload) chrome.downloads.showDefaultFolder();
    return { ok: true, ...result };
  }
}

// ---- Helpers ----

function resolveFiles(tree, selections, owner, repo, branch) {
  const files = [];
  for (const selection of selections) {
    const selType = selection.type || 'tree';
    const selPath = selection.path || selection;

    if (selType === 'blob') {
      const match = tree.find(item => item.type === 'blob' && item.path === selPath);
      if (match) {
        files.push({
          relativePath: selPath.split('/').pop(),
          downloadUrl: buildRawUrl(owner, repo, branch, selPath)
        });
      }
    } else {
      const filtered = filterTree(tree, selPath);
      const folderName = selPath.split('/').pop() || selPath;
      for (const item of filtered) {
        const fullPath = selPath ? `${selPath}/${item.path}` : item.path;
        files.push({
          relativePath: `${folderName}/${item.path}`,
          downloadUrl: buildRawUrl(owner, repo, branch, fullPath)
        });
      }
    }
  }
  return files;
}

function sendToTab(tabId, type, payload) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type, payload }).catch(() => {});
  }
}
