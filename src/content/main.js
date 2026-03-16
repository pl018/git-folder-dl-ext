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
import { createCancelState, cancelWriteJob, ensureWritableDirectory, writeFiles } from '../lib/file-writer.js';
import { DIRECTORY_ACCESS_STATES } from '../lib/directory-state.js';

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
    handleComplete({ total: 0, errors: [], cancelled: true, rolledBack: 0 });
    return;
  }

  const settings = await chrome.storage.local.get({
    concurrentDownloads: 3
  });

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

  handleComplete({
    total: result.completed,
    errors: result.errors,
    rootPath: response.manifest.rootPath,
    cancelled: result.cancelled,
    rolledBack: result.rolledBack
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
