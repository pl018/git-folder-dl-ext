/**
 * Content Script Entry Point
 * Sends download requests to service worker. Does NOT do file I/O.
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

const LOG = '[GFDL]';

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

// Listen for messages from service worker
try {
  chrome.runtime.onMessage.addListener((message) => {
    const { type, payload } = message;
    if (type === 'DOWNLOAD_PROGRESS') updateProgress(payload);
    if (type === 'DOWNLOAD_COMPLETE') handleComplete(payload);
  });
} catch {}

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

  showProgressModal({
    onCancel: () => {
      safeSendMessage({ type: 'CANCEL_DOWNLOAD', payload: {} });
      hideProgressModal();
    },
    onOpenFolder: () => {
      safeSendMessage({ type: 'OPEN_DOWNLOADS_FOLDER', payload: {} });
      hideProgressModal();
    }
  });

  const response = await safeSendMessage({
    type: 'START_DOWNLOAD',
    payload: {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || null,
      selections: items
    }
  });

  if (!response) {
    showComplete({ total: 0, errors: ['Extension context lost. Reload page.'] });
  } else if (!response.ok) {
    showComplete({ total: 0, errors: [response.error] });
  }
}

async function handleComplete(payload) {
  const noErrors = !payload.errors || payload.errors.length === 0;

  let autoModeEnabled = false;
  try {
    const r = await chrome.storage.local.get({ autoMode: false });
    autoModeEnabled = r.autoMode;
  } catch {}

  if (autoModeEnabled && noErrors) {
    showComplete(payload);
    setTimeout(() => {
      hideProgressModal();
      clearSelection();
      updateOverlayBar(0);
    }, 1200);
  } else {
    showComplete(payload);
  }
}
