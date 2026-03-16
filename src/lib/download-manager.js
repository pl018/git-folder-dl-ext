/**
 * Download Manager
 * Orchestrates concurrent file downloads via chrome.downloads API.
 * Runs in the service worker context.
 */

/**
 * @typedef {Object} DownloadFile
 * @property {string} relativePath - Path relative to selected folder
 * @property {string} downloadUrl - Full URL to raw file content
 */

/**
 * @typedef {Object} DownloadProgress
 * @property {number} completed
 * @property {number} total
 * @property {string} currentFile
 * @property {string[]} errors
 */

/**
 * Download a set of files preserving directory structure.
 * Uses chrome.downloads.download() which auto-creates subdirectories.
 *
 * @param {DownloadFile[]} files - Files to download
 * @param {Object} options
 * @param {string} options.prefix - Path prefix under Downloads folder (e.g. "my-repo/src")
 * @param {string|null} options.token - GitHub auth token for private repos
 * @param {number} [options.concurrency=3] - Max concurrent downloads
 * @param {(progress: DownloadProgress) => void} [options.onProgress] - Progress callback
 * @returns {Promise<{ completed: number, errors: string[] }>}
 */
export async function downloadFiles(files, options = {}) {
  const {
    prefix = '',
    token = null,
    concurrency = 3,
    onProgress = () => {}
  } = options;

  const state = {
    completed: 0,
    total: files.length,
    currentFile: '',
    errors: [],
    cancelled: false,
    activeDownloadIds: new Set()
  };

  // Queue processing with semaphore
  let running = 0;
  let fileIndex = 0;
  const downloadChangeHandler = createChangeHandler(state);

  chrome.downloads.onChanged.addListener(downloadChangeHandler);

  try {
    await new Promise((resolve, reject) => {
      function processNext() {
        if (state.cancelled) {
          if (running === 0) resolve();
          return;
        }

        while (running < concurrency && fileIndex < files.length) {
          const file = files[fileIndex++];
          running++;

          downloadSingleFile(file, prefix, token, state)
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

          state.currentFile = file.relativePath;
          onProgress({ ...state });
        }

        if (running === 0 && fileIndex >= files.length) {
          resolve();
        }
      }

      processNext();
    });
  } finally {
    chrome.downloads.onChanged.removeListener(downloadChangeHandler);
  }

  return {
    completed: state.completed,
    errors: state.errors
  };
}

/**
 * Download a single file via chrome.downloads.
 * @param {DownloadFile} file
 * @param {string} prefix
 * @param {string|null} token
 * @param {Object} state
 * @returns {Promise<void>}
 */
function downloadSingleFile(file, prefix, token, state) {
  return new Promise((resolve, reject) => {
    // Build the filename with directory structure
    // chrome.downloads creates subdirectories automatically
    const parts = [prefix, file.relativePath].filter(Boolean);
    const filename = parts.join('/').replace(/\/+/g, '/');

    const downloadOptions = {
      url: file.downloadUrl,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    };

    // Add auth header for private repos
    if (token) {
      downloadOptions.headers = [
        { name: 'Authorization', value: `token ${token}` }
      ];
    }

    chrome.downloads.download(downloadOptions, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      state.activeDownloadIds.add(downloadId);

      // Track completion via polling (more reliable than onChanged for completion)
      const checkInterval = setInterval(() => {
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (!items || items.length === 0) {
            clearInterval(checkInterval);
            state.activeDownloadIds.delete(downloadId);
            reject(new Error('Download item not found'));
            return;
          }

          const item = items[0];
          if (item.state === 'complete') {
            clearInterval(checkInterval);
            state.activeDownloadIds.delete(downloadId);
            resolve();
          } else if (item.state === 'interrupted') {
            clearInterval(checkInterval);
            state.activeDownloadIds.delete(downloadId);
            reject(new Error(item.error || 'Download interrupted'));
          }
        });
      }, 500);
    });
  });
}

/**
 * Cancel all active downloads in the given state.
 * @param {{ cancelled: boolean, activeDownloadIds: Set<number> }} state
 */
export function cancelDownloads(state) {
  state.cancelled = true;
  for (const id of state.activeDownloadIds) {
    chrome.downloads.cancel(id);
  }
}

/**
 * Create a change handler for download state tracking.
 * @param {Object} state
 * @returns {Function}
 */
function createChangeHandler(state) {
  return function (delta) {
    // We handle completion via polling in downloadSingleFile,
    // but this can be used for additional UI updates if needed
  };
}
