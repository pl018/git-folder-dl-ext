/**
 * Service Worker (Background Script)
 * Handles GitHub API calls and resolves download manifests for direct writes.
 */

import { getAll, set } from '../lib/storage.js';
import { getAuthStatus, validateToken, startDeviceFlow, pollForToken } from '../lib/auth.js';
import { getTree, getDefaultBranch } from '../lib/github-api.js';
import { buildDownloadPlan } from '../lib/download-plan.js';

const LOG = '[GFDL-SW]';
const NATIVE_HOST_NAME = 'com.gfdl.folderops';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload = {} } = message || {};
  console.log(LOG, 'Message:', type);

  switch (type) {
    case 'GET_AUTH_STATUS':
      handleGetAuthStatus().then(sendResponse).catch((e) => sendResponse({ authenticated: false, error: e.message }));
      return true;

    case 'SAVE_TOKEN':
      handleSaveToken(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'AUTH_DEVICE_FLOW':
      handleDeviceFlow(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'POLL_DEVICE_TOKEN':
      handlePollDeviceToken(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'RESOLVE_DOWNLOAD_PLAN':
      handleResolveDownloadPlan(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'FETCH_FILE_BYTES':
      handleFetchFileBytes(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'START_BROWSER_DOWNLOAD':
      handleStartBrowserDownload(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'CANCEL_BROWSER_DOWNLOADS':
      handleCancelBrowserDownloads(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'GET_NATIVE_HELPER_STATUS':
      handleGetNativeHelperStatus().then(sendResponse).catch((e) => sendResponse({ ok: false, available: false, error: e.message }));
      return true;

    case 'PICK_NATIVE_FOLDER':
      sendNativeMessage({ action: 'pickFolder' }).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'OPEN_NATIVE_FOLDER':
      handleOpenNativeFolder(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
  }
});

async function handleGetAuthStatus() {
  return getAuthStatus();
}

async function handleSaveToken({ token, tokenType = 'pat' }) {
  const validation = await validateToken(token);
  if (!validation.valid) return { ok: false, error: 'Invalid token' };
  await set({ githubToken: token, tokenType });
  return { ok: true, username: validation.username };
}

async function handleDeviceFlow({ clientId, scope }) {
  const result = await startDeviceFlow(clientId, scope);
  return { ok: true, ...result };
}

async function handlePollDeviceToken({ clientId, deviceCode, interval }) {
  const token = await pollForToken(clientId, deviceCode, interval);
  const validation = await validateToken(token);
  if (!validation.valid) return { ok: false, error: 'Token validation failed' };
  await set({ githubToken: token, tokenType: 'oauth' });
  return { ok: true, token, username: validation.username };
}

async function handleResolveDownloadPlan({ owner, repo, branch, selections, browserDownloadMode = false }) {
  const normalizedSelections = Array.isArray(selections) ? selections : [];
  const settings = await getAll();
  const token = settings.githubToken;

  if (!branch) {
    branch = await getDefaultBranch(owner, repo, token);
  }

  const tree = await getTree(owner, repo, branch, token);
  const manifest = buildDownloadPlan({
    tree,
    selections: normalizedSelections,
    owner,
    repo,
    branch,
    prefix: browserDownloadMode ? '' : settings.downloadPrefix
  });

  if (manifest.entries.length === 0) {
    return {
      ok: false,
      error: `No files found for: ${normalizedSelections.map((selection) => selection.path || selection).join(', ')}`
    };
  }

  console.log(LOG, 'Resolved download plan:', manifest.entries.length, 'files →', manifest.rootPath);
  return { ok: true, manifest };
}

async function handleFetchFileBytes({ downloadUrl }) {
  const settings = await getAll();
  const headers = {};

  if (settings.githubToken) {
    headers.Authorization = `token ${settings.githubToken}`;
  }

  const response = await fetch(downloadUrl, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return { ok: true, bytes: Array.from(new Uint8Array(buffer)) };
}

async function handleStartBrowserDownload({ downloadUrl, targetPath }) {
  if (!downloadUrl) {
    return { ok: false, error: 'Download URL is required.' };
  }

  const settings = await getAll();
  const options = {
    url: downloadUrl,
    filename: targetPath,
    conflictAction: 'uniquify'
  };

  if (settings.githubToken) {
    options.headers = [{ name: 'Authorization', value: `token ${settings.githubToken}` }];
  }

  const downloadId = await downloadViaBrowser(options);
  return { ok: true, downloadId };
}

async function handleCancelBrowserDownloads({ downloadIds }) {
  const ids = Array.isArray(downloadIds) ? Array.from(new Set(downloadIds.filter((value) => Number.isInteger(value)))) : [];

  for (const id of ids) {
    await cancelBrowserDownload(id);
    await removeBrowserDownloadFile(id);
  }

  return { ok: true, cancelled: ids.length };
}

async function handleGetNativeHelperStatus() {
  try {
    const response = await sendNativeMessage({ action: 'ping' });
    return { ok: true, available: true, ...response };
  } catch (error) {
    return { ok: false, available: false, error: error.message };
  }
}

async function handleOpenNativeFolder({ path }) {
  if (!path) {
    return { ok: false, error: 'No linked folder path configured.' };
  }
  return sendNativeMessage({ action: 'openFolder', path });
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Native host request failed.'));
        return;
      }

      resolve(response);
    });
  });
}

function downloadViaBrowser(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function cancelBrowserDownload(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.cancel(downloadId, () => resolve());
  });
}

function removeBrowserDownloadFile(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.removeFile(downloadId, () => {
      chrome.downloads.erase({ id: downloadId }, () => resolve());
    });
  });
}
