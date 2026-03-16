/**
 * Service Worker (Background Script)
 * Handles GitHub API calls, resolves download manifests, and records download history.
 */

import { getAll, set } from '../lib/storage.js';
import { getAuthStatus, validateToken, startDeviceFlow, pollForToken } from '../lib/auth.js';
import { getTreeData, getRepoMetadata, getBranchMetadata } from '../lib/github-api.js';
import { buildDownloadPlan } from '../lib/download-plan.js';
import { isInvalidFilenameError, sanitizeDownloadTargetPath } from '../lib/target-path.js';
import {
  createHistoryRunRecord,
  finalizeHistoryRunRecord,
  DOWNLOAD_RUN_MODE,
  DOWNLOAD_RUN_STATUS
} from '../lib/history-model.js';
import { saveHistoryRun, getHistoryRun, listHistoryRuns } from '../lib/history-store.js';

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

    case 'CREATE_DOWNLOAD_RUN':
      handleCreateDownloadRun(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'FINALIZE_DOWNLOAD_RUN':
      handleFinalizeDownloadRun(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'GET_DOWNLOAD_HISTORY':
      handleGetDownloadHistory(payload).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message, runs: [] }));
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
  const mode = browserDownloadMode ? DOWNLOAD_RUN_MODE.BROWSER_DOWNLOAD : DOWNLOAD_RUN_MODE.DIRECT_WRITE;

  let repoMetadata = null;
  let branchMetadata = null;
  let treeData = null;
  let actualBranch = branch || '';

  try {
    repoMetadata = await getRepoMetadata(owner, repo, token);
    actualBranch = actualBranch || repoMetadata.defaultBranch;
    branchMetadata = actualBranch
      ? await getBranchMetadata(owner, repo, actualBranch, token)
      : { name: '', commitSha: '' };
    treeData = await getTreeData(owner, repo, actualBranch, token);

    const manifest = buildDownloadPlan({
      tree: treeData.tree,
      selections: normalizedSelections,
      owner,
      repo,
      branch: actualBranch,
      prefix: browserDownloadMode ? '' : settings.downloadPrefix
    });

    if (manifest.entries.length === 0) {
      throw new Error(`No files found for: ${normalizedSelections.map((selection) => selection.path || '/').join(', ')}`);
    }

    const run = await createAndPersistRun({
      owner,
      repo,
      branch: actualBranch,
      mode,
      selectedItems: normalizedSelections,
      manifest,
      settings,
      repoMetadata,
      branchMetadata,
      treeSha: treeData.sha
    });

    console.log(LOG, 'Resolved download plan:', manifest.entries.length, 'files →', manifest.rootPath);
    return {
      ok: true,
      manifest,
      runId: run.runId,
      historyContext: createHistoryContext(run)
    };
  } catch (error) {
    const failedRun = await recordResolveFailure({
      owner,
      repo,
      branch: actualBranch || branch || '',
      mode,
      selectedItems: normalizedSelections,
      settings,
      repoMetadata,
      branchMetadata,
      treeSha: treeData?.sha || '',
      error: error.message
    });

    return {
      ok: false,
      error: error.message,
      runId: failedRun?.runId || ''
    };
  }
}

async function handleCreateDownloadRun(payload) {
  const run = createHistoryRunRecord(payload);
  await saveHistoryRun(run);
  return { ok: true, runId: run.runId, run };
}

async function handleFinalizeDownloadRun({ runId, status, errors = [], markerWritten = false, markerPath = '' }) {
  const currentRun = await getHistoryRun(runId);
  if (!currentRun) {
    return { ok: false, error: `Unknown history run: ${runId}` };
  }

  let finalizedRun = finalizeHistoryRunRecord(currentRun, {
    status,
    cancelled: status === DOWNLOAD_RUN_STATUS.CANCELLED,
    errors,
    markerWritten,
    markerPath
  });

  const mirrorResult = await mirrorRunToNativeSql(finalizedRun);
  finalizedRun = {
    ...finalizedRun,
    mirroredToSql: !!mirrorResult.mirroredToSql,
    nativeHistoryDbPath: mirrorResult.nativeHistoryDbPath || '',
    nativeMirrorError: mirrorResult.nativeMirrorError || ''
  };

  await saveHistoryRun(finalizedRun);
  return { ok: true, run: finalizedRun };
}

async function handleGetDownloadHistory({ limit = 8 } = {}) {
  const runs = await listHistoryRuns({ limit, includePending: false });
  return { ok: true, runs };
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

  try {
    const downloadId = await downloadViaBrowser(options);
    return { ok: true, downloadId, targetPath };
  } catch (error) {
    const sanitizedTargetPath = sanitizeDownloadTargetPath(targetPath);
    if (sanitizedTargetPath !== targetPath && isInvalidFilenameError(error)) {
      console.warn(LOG, 'Retrying invalid browser download filename:', targetPath, '->', sanitizedTargetPath);
      const downloadId = await downloadViaBrowser({
        ...options,
        filename: sanitizedTargetPath
      });
      return {
        ok: true,
        downloadId,
        targetPath: sanitizedTargetPath,
        requestedTargetPath: targetPath,
        sanitized: true
      };
    }

    throw error;
  }
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
    const ping = await sendNativeMessage({ action: 'ping' });
    let historyDb = { available: false, error: 'History database status unavailable.' };

    try {
      historyDb = await sendNativeMessage({ action: 'getHistoryDbStatus' });
    } catch (error) {
      historyDb = { available: false, error: error.message };
    }

    return { ok: true, available: true, ...ping, historyDb };
  } catch (error) {
    return {
      ok: false,
      available: false,
      error: error.message,
      historyDb: { available: false, error: error.message }
    };
  }
}

async function handleOpenNativeFolder({ path }) {
  if (!path) {
    return { ok: false, error: 'No linked folder path configured.' };
  }
  return sendNativeMessage({ action: 'openFolder', path });
}

async function createAndPersistRun({ owner, repo, branch, mode, selectedItems, manifest, settings, repoMetadata, branchMetadata, treeSha }) {
  const run = createHistoryRunRecord({
    owner,
    repo,
    branch,
    defaultBranch: repoMetadata?.defaultBranch || '',
    mode,
    selectedItems,
    resolvedEntries: manifest.entries,
    logicalRootPath: manifest.rootPath,
    linkedNativeRootPath: mode === DOWNLOAD_RUN_MODE.DIRECT_WRITE ? settings.nativeFolderPath : '',
    repoMetadata,
    branchHeadSha: branchMetadata?.commitSha || '',
    treeSha
  });

  await saveHistoryRun(run);
  return run;
}

async function recordResolveFailure({ owner, repo, branch, mode, selectedItems, settings, repoMetadata, branchMetadata, treeSha, error }) {
  try {
    const failedRun = finalizeHistoryRunRecord(
      createHistoryRunRecord({
        owner,
        repo,
        branch,
        defaultBranch: repoMetadata?.defaultBranch || '',
        mode,
        selectedItems,
        resolvedEntries: [],
        logicalRootPath: '',
        linkedNativeRootPath: mode === DOWNLOAD_RUN_MODE.DIRECT_WRITE ? settings.nativeFolderPath : '',
        repoMetadata: repoMetadata || {},
        branchHeadSha: branchMetadata?.commitSha || '',
        treeSha: treeSha || ''
      }),
      {
        status: DOWNLOAD_RUN_STATUS.FAILED,
        errors: [error]
      }
    );

    const mirrorResult = await mirrorRunToNativeSql(failedRun);
    const persisted = {
      ...failedRun,
      mirroredToSql: !!mirrorResult.mirroredToSql,
      nativeHistoryDbPath: mirrorResult.nativeHistoryDbPath || '',
      nativeMirrorError: mirrorResult.nativeMirrorError || ''
    };

    await saveHistoryRun(persisted);
    return persisted;
  } catch (historyError) {
    console.warn(LOG, 'Failed to record resolve failure:', historyError.message);
    return null;
  }
}

function createHistoryContext(run) {
  return {
    runId: run.runId,
    downloadedAt: run.downloadedAt,
    repoUrl: run.repoUrl,
    owner: run.owner,
    repo: run.repo,
    branch: run.branch,
    defaultBranch: run.defaultBranch,
    branchHeadSha: run.branchHeadSha,
    treeSha: run.treeSha,
    logicalRootPath: run.logicalRootPath,
    linkedNativeRootPath: run.linkedNativeRootPath,
    resolvedNativeTargetPath: run.resolvedNativeTargetPath,
    selectionFingerprint: run.selectionFingerprint,
    contentFingerprint: run.contentFingerprint,
    selectedItems: run.selectedItems,
    selectedItemsSummary: run.selectedItemsSummary,
    resolvedEntriesSummary: run.resolvedEntriesSummary
  };
}

async function mirrorRunToNativeSql(run) {
  try {
    const response = await sendNativeMessage({
      action: 'upsertDownloadRun',
      record: run
    });

    return {
      mirroredToSql: !!response.mirrored,
      nativeHistoryDbPath: response.dbPath || '',
      nativeMirrorError: response.error || ''
    };
  } catch (error) {
    return {
      mirroredToSql: false,
      nativeHistoryDbPath: '',
      nativeMirrorError: error.message
    };
  }
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
    chrome.downloads.removeFile(downloadId, () => resolve());
  });
}
