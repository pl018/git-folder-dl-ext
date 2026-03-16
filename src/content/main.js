/**
 * Content Script Entry Point
 * Resolves download plans in the service worker and writes files directly from
 * the user-gesture context.
 */

import { observeNavigation, isFileBrowserPage, parseCurrentUrl } from './github-observer.js';
import { getShadowRoot } from './shadow-host.js';
import {
  injectCheckboxes,
  removeCheckboxes,
  clearSelection,
  getSelectedItems,
  onSelectionChange
} from './checkbox-injector.js';
import { initOverlayBar, updateOverlayBar } from './overlay-bar.js';
import { showProgressModal, updateProgress, showComplete, hideProgressModal } from './progress-modal.js';
import { createCancelState, cancelWriteJob, ensureWritableDirectory, writeFile, writeFiles } from '../lib/file-writer.js';
import { DIRECTORY_ACCESS_STATES } from '../lib/directory-state.js';
import {
  buildRepoMarkerPath,
  createRepoMarkerPayload,
  deriveRunStatus,
  DOWNLOAD_RUN_STATUS
} from '../lib/history-model.js';

const LOG = '[GFDL]';
let activeCancelState = null;

async function safeSendMessage(message) {
  try {
    if (!chrome.runtime?.id) return null;
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.error(LOG, 'sendMessage failed:', err.message);
    return null;
  }
}

getShadowRoot();

initOverlayBar({
  onDownload: handleDownload,
  onClear: () => clearSelection()
});

onSelectionChange((selected) => updateOverlayBar(selected.size));

observeNavigation(() => {
  removeCheckboxes();
  clearSelection();
  updateOverlayBar(0);
  if (isFileBrowserPage()) {
    setTimeout(() => injectCheckboxes(), 500);
  }
});

async function handleDownload() {
  const items = getSelectedItems();
  if (items.length === 0) return;

  const parsed = parseCurrentUrl();
  if (!parsed) return;

  const settings = await chrome.storage.local.get({
    browserDownloadMode: false,
    concurrentDownloads: 3,
    writeRepoMarker: false
  });

  if (settings.browserDownloadMode) {
    await handleBrowserManagedDownload(parsed, items);
    return;
  }

  let directoryResult;
  try {
    directoryResult = await ensureWritableDirectory({
      promptIfMissing: true,
      promptIfExpired: true
    });
  } catch (err) {
    showProgressModal({ onCancel: hideProgressModal });
    showComplete({ total: 0, errors: [`Failed to prepare target folder: ${err.message}`] });
    return;
  }

  if (!directoryResult.ok || !directoryResult.handle) {
    showProgressModal({ onCancel: hideProgressModal });
    showComplete({ total: 0, errors: [getDirectoryErrorMessage(directoryResult.reason)] });
    return;
  }

  showProgressModal({
    onCancel: () => {
      if (activeCancelState) {
        cancelWriteJob(activeCancelState);
        updateProgress({
          completed: 0,
          total: 0,
          currentFile: 'Canceling download and rolling back files...',
          errors: []
        });
        return;
      }

      hideProgressModal();
    }
  });

  const cancelState = createCancelState();
  activeCancelState = cancelState;

  updateProgress({
    completed: 0,
    total: 0,
    currentFile: 'Preparing download plan...',
    errors: []
  });

  const response = await safeSendMessage({
    type: 'RESOLVE_DOWNLOAD_PLAN',
    payload: {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || null,
      selections: items
    }
  });

  if (!response) {
    activeCancelState = null;
    showComplete({ total: 0, errors: ['Extension context lost. Reload page.'] });
    return;
  }

  if (!response.ok) {
    activeCancelState = null;
    showComplete({ total: 0, errors: [response.error] });
    return;
  }

  if (cancelState.cancelled) {
    activeCancelState = null;
    await finalizeDownloadHistoryRun(response.runId, {
      status: DOWNLOAD_RUN_STATUS.CANCELLED,
      errors: []
    });
    handleComplete({ total: 0, errors: [], cancelled: true, rolledBack: 0 });
    return;
  }

  updateProgress({
    completed: 0,
    total: response.manifest.entries.length,
    currentFile: `Saving to ${response.manifest.rootPath}`,
    errors: []
  });

  const result = await writeFiles(directoryResult.handle, response.manifest.entries, {
    concurrency: settings.concurrentDownloads,
    cancelState,
    fetchFile: fetchFileFromBackground,
    onProgress: (progress) => updateProgress(progress)
  });
  activeCancelState = null;

  const markerState = await maybeWriteRepoMarker({
    enabled: settings.writeRepoMarker,
    dirHandle: directoryResult.handle,
    historyContext: response.historyContext,
    cancelled: !!result.cancelled,
    errors: result.errors
  });

  await finalizeDownloadHistoryRun(response.runId, {
    status: deriveRunStatus({
      cancelled: !!result.cancelled,
      totalCount: response.manifest.entries.length,
      errorCount: result.errors.length
    }),
    errors: result.errors,
    markerWritten: markerState.markerWritten,
    markerPath: markerState.markerPath
  });

  handleComplete({
    total: result.completed,
    errors: result.errors,
    rootPath: response.manifest.rootPath,
    cancelled: result.cancelled,
    rolledBack: result.rolledBack
  });
}

async function handleBrowserManagedDownload(parsed, items) {
  showProgressModal({
    onCancel: async () => {
      if (activeCancelState) {
        cancelWriteJob(activeCancelState);
        updateProgress({
          completed: 0,
          total: 0,
          currentFile: 'Canceling browser download job...',
          errors: []
        });
        await cancelBrowserDownloads(activeCancelState.browserDownloadIds || []);
        return;
      }

      hideProgressModal();
    }
  });

  const cancelState = createCancelState();
  cancelState.browserDownloadIds = [];
  activeCancelState = cancelState;

  updateProgress({
    completed: 0,
    total: 0,
    currentFile: 'Preparing browser download plan...',
    errors: []
  });

  const response = await safeSendMessage({
    type: 'RESOLVE_DOWNLOAD_PLAN',
    payload: {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || null,
      selections: items,
      browserDownloadMode: true
    }
  });

  if (!response) {
    activeCancelState = null;
    showComplete({ total: 0, errors: ['Extension context lost. Reload page.'] });
    return;
  }

  if (!response.ok) {
    activeCancelState = null;
    showComplete({ total: 0, errors: [response.error] });
    return;
  }

  const total = response.manifest.entries.length;
  const errors = [];
  let completed = 0;

  for (const entry of response.manifest.entries) {
    if (cancelState.cancelled) {
      break;
    }

    updateProgress({
      completed,
      total,
      currentFile: `Sending ${entry.targetPath} to Chrome...`,
      errors
    });

    const downloadResponse = await safeSendMessage({
      type: 'START_BROWSER_DOWNLOAD',
      payload: {
        downloadUrl: entry.downloadUrl,
        targetPath: entry.targetPath
      }
    });

    if (!downloadResponse?.ok) {
      errors.push(`${entry.targetPath}: ${downloadResponse?.error || 'Failed to start browser download.'}`);
      completed++;
      continue;
    }

    cancelState.browserDownloadIds.push(downloadResponse.downloadId);
    if (downloadResponse.targetPath) {
      entry.targetPath = downloadResponse.targetPath;
    }
    completed++;

    updateProgress({
      completed,
      total,
      currentFile: `Queued ${entry.targetPath}`,
      errors
    });
  }

  if (cancelState.cancelled) {
    await finalizeDownloadHistoryRun(response.runId, {
      status: DOWNLOAD_RUN_STATUS.CANCELLED,
      errors: []
    });
    await cancelBrowserDownloads(cancelState.browserDownloadIds);
    activeCancelState = null;
    handleComplete({
      total: completed,
      errors: [],
      cancelled: true,
      summaryText: 'BROWSER DOWNLOAD CANCELED',
      detailText: completed > 0 ? `Canceled ${completed} queued file${completed > 1 ? 's' : ''}.` : 'No files were handed to Chrome.'
    });
    return;
  }

  await finalizeDownloadHistoryRun(response.runId, {
    status: deriveRunStatus({
      cancelled: false,
      totalCount: total,
      errorCount: errors.length
    }),
    errors
  });

  activeCancelState = null;
  handleComplete({
    total: completed,
    errors,
    summaryText: errors.length === 0
      ? `${completed} FILE${completed > 1 ? 'S' : ''} SENT TO BROWSER`
      : ''
  });
}

async function handleComplete(payload) {
  activeCancelState = null;

  if (payload.cancelled) {
    showComplete(payload);
    return;
  }

  const noErrors = !payload.errors || payload.errors.length === 0;

  let autoModeEnabled = false;
  let openAfterDownload = false;
  let nativeFolderPath = '';
  try {
    const result = await chrome.storage.local.get({
      autoMode: false,
      openAfterDownload: false,
      nativeFolderPath: ''
    });
    autoModeEnabled = result.autoMode;
    openAfterDownload = result.openAfterDownload;
    nativeFolderPath = result.nativeFolderPath;
  } catch {}

  if (noErrors && openAfterDownload && nativeFolderPath) {
    try {
      await safeSendMessage({
        type: 'OPEN_NATIVE_FOLDER',
        payload: { path: nativeFolderPath }
      });
    } catch {}
  }

  if (autoModeEnabled && noErrors) {
    showComplete(payload);
    setTimeout(() => {
      hideProgressModal();
      clearSelection();
      updateOverlayBar(0);
    }, 1200);
    return;
  }

  showComplete(payload);
}

async function cancelBrowserDownloads(downloadIds) {
  if (!downloadIds?.length) {
    return;
  }

  await safeSendMessage({
    type: 'CANCEL_BROWSER_DOWNLOADS',
    payload: { downloadIds }
  });
}

async function finalizeDownloadHistoryRun(runId, payload) {
  if (!runId) {
    return;
  }

  const response = await safeSendMessage({
    type: 'FINALIZE_DOWNLOAD_RUN',
    payload: {
      runId,
      ...payload
    }
  });

  if (!response?.ok) {
    console.warn(LOG, 'Failed to finalize history run:', response?.error || 'Unknown error');
  }
}

async function maybeWriteRepoMarker({ enabled, dirHandle, historyContext, cancelled, errors }) {
  if (!enabled || !dirHandle || !historyContext || cancelled || errors?.length) {
    return { markerWritten: false, markerPath: '' };
  }

  try {
    const markerPath = buildRepoMarkerPath(historyContext.logicalRootPath);
    const payload = createRepoMarkerPayload({
      ...historyContext,
      status: DOWNLOAD_RUN_STATUS.COMPLETED,
      finishedAt: new Date().toISOString()
    });

    await writeFile(dirHandle, markerPath, JSON.stringify(payload, null, 2));
    return { markerWritten: true, markerPath };
  } catch (error) {
    console.warn(LOG, 'Failed to write repo marker:', error.message);
    return { markerWritten: false, markerPath: '' };
  }
}

function getDirectoryErrorMessage(reason) {
  if (reason === DIRECTORY_ACCESS_STATES.EXPIRED) {
    return 'Folder access expired. Reauthorize the target folder to continue.';
  }

  return 'Choose a target folder to continue.';
}

async function fetchFileFromBackground(file) {
  const response = await safeSendMessage({
    type: 'FETCH_FILE_BYTES',
    payload: { downloadUrl: file.downloadUrl }
  });

  if (!response) {
    throw new Error('Extension context lost while fetching file content.');
  }

  if (!response.ok) {
    throw new Error(response.error || 'Failed to fetch file content.');
  }

  if (!Array.isArray(response.bytes)) {
    throw new Error('Background fetch returned an invalid byte payload.');
  }

  return new Uint8Array(response.bytes);
}
