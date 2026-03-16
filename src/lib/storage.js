/**
 * Typed wrapper around chrome.storage.local with defaults.
 */

const DEFAULTS = {
  githubToken: null,
  tokenType: null,        // 'oauth' | 'pat'
  downloadPrefix: '',     // optional subfolder prefix inside the granted target folder
  downloadDirectoryName: '',
  hasDirectoryHandle: false,
  directoryAccessState: 'folder-missing',
  browserDownloadMode: false,
  nativeFolderPath: '',
  openAfterDownload: false,
  autoMode: false,        // auto-download: clear checkboxes + close progress on success
  concurrentDownloads: 3
};

const listeners = new Set();

/**
 * Returns all stored values merged with defaults.
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function getAll() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

/**
 * Returns a single stored value with default fallback.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] !== undefined ? result[key] : DEFAULTS[key];
}

/**
 * Sets one or more values in storage.
 * Supports both `set(key, value)` and `set({key: value, ...})` signatures.
 * @param {string|object} keyOrObj
 * @param {any} [value]
 * @returns {Promise<void>}
 */
export async function set(keyOrObj, value) {
  if (typeof keyOrObj === 'string') {
    return chrome.storage.local.set({ [keyOrObj]: value });
  }
  return chrome.storage.local.set(keyOrObj);
}

/**
 * Resets storage to defaults.
 * @returns {Promise<void>}
 */
export async function clear() {
  return chrome.storage.local.set({ ...DEFAULTS });
}

/**
 * Registers a listener for storage changes.
 * Callback receives { key, oldValue, newValue } for each changed key.
 * @param {function} callback
 */
export function onChange(callback) {
  if (listeners.size === 0) {
    chrome.storage.onChanged.addListener(storageListener);
  }
  listeners.add(callback);
}

/**
 * Unregisters a previously registered storage change listener.
 * @param {function} callback
 */
export function offChange(callback) {
  listeners.delete(callback);
  if (listeners.size === 0) {
    chrome.storage.onChanged.removeListener(storageListener);
  }
}

/** @param {object} changes @param {string} areaName */
function storageListener(changes, areaName) {
  if (areaName !== 'local') return;
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    for (const cb of listeners) {
      cb({ key, oldValue, newValue });
    }
  }
}
