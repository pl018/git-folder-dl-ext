/**
 * Popup Script
 * Manages auth status display, settings, and directory access state.
 */

import { checkStoredDirectory, ensureWritableDirectory, forgetDirectory, pickDirectory } from '../lib/file-writer.js';
import { DIRECTORY_ACCESS_STATES } from '../lib/directory-state.js';

const authDot = document.getElementById('authDot');
const authText = document.getElementById('authText');
const authActions = document.getElementById('authActions');
const authConnected = document.getElementById('authConnected');
const authUser = document.getElementById('authUser');
const connectBtn = document.getElementById('connectBtn');
const showPatBtn = document.getElementById('showPatBtn');
const patSection = document.getElementById('patSection');
const patInput = document.getElementById('patInput');
const savePatBtn = document.getElementById('savePatBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const deviceFlowSection = document.getElementById('deviceFlowSection');
const deviceCodeEl = document.getElementById('deviceCode');
const downloadPathDisplay = document.getElementById('downloadPathDisplay');
const pickFolderBtn = document.getElementById('pickFolderBtn');
const clearFolderBtn = document.getElementById('clearFolderBtn');
const nativeFolderDisplay = document.getElementById('nativeFolderDisplay');
const linkFolderBtn = document.getElementById('linkFolderBtn');
const nativeHelperHint = document.getElementById('nativeHelperHint');
const downloadPrefix = document.getElementById('downloadPrefix');
const autoMode = document.getElementById('autoMode');
const openAfterDownload = document.getElementById('openAfterDownload');
const concurrency = document.getElementById('concurrency');
const concurrencyValue = document.getElementById('concurrencyValue');
const extensionIdHint = document.getElementById('extensionIdHint');
let nativeHelperAvailable = false;
let directoryHandleReady = false;

loadAuthStatus();
loadSettings();
loadDirectoryStatus();
loadNativeHelperStatus();
extensionIdHint.textContent = `Extension ID: ${chrome.runtime.id}`;

connectBtn.addEventListener('click', startOAuthFlow);
showPatBtn.addEventListener('click', () => {
  patSection.style.display = patSection.style.display === 'none' ? 'flex' : 'none';
});
savePatBtn.addEventListener('click', saveToken);
disconnectBtn.addEventListener('click', disconnect);

pickFolderBtn.addEventListener('click', pickFolder);
clearFolderBtn.addEventListener('click', clearFolder);
linkFolderBtn.addEventListener('click', linkNativeFolderPath);

downloadPrefix.addEventListener('change', () => saveSetting('downloadPrefix', downloadPrefix.value.trim()));
autoMode.addEventListener('change', () => saveSetting('autoMode', autoMode.checked));
openAfterDownload.addEventListener('change', () => saveSetting('openAfterDownload', openAfterDownload.checked));
concurrency.addEventListener('input', () => {
  concurrencyValue.textContent = concurrency.value;
  saveSetting('concurrentDownloads', parseInt(concurrency.value, 10));
});

async function loadDirectoryStatus() {
  const directory = await checkStoredDirectory();

  if (directory.accessState === DIRECTORY_ACCESS_STATES.READY) {
    showDirectoryReady(directory.name);
    return;
  }

  if (directory.accessState === DIRECTORY_ACCESS_STATES.EXPIRED) {
    showDirectoryNeedsAccess(directory.name);
    return;
  }

  showDirectoryUnset();
}

async function pickFolder() {
  try {
    const directory = await checkStoredDirectory();
    const result = directory.accessState === DIRECTORY_ACCESS_STATES.READY
      ? { ok: true, name: (await pickDirectory()).name }
      : await ensureWritableDirectory({
          promptIfMissing: true,
          promptIfExpired: true
        });

    if (!result.ok) {
      await loadDirectoryStatus();
      return;
    }

    showNativeFolderUnlinked();
    showDirectoryReady(result.name);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Folder pick error:', err);
    }
  }
}

async function clearFolder() {
  await forgetDirectory();
  showDirectoryUnset();
  showNativeFolderUnlinked();
}

function showDirectoryReady(name) {
  directoryHandleReady = true;
  downloadPathDisplay.textContent = name;
  downloadPathDisplay.classList.remove('path-picker__value--empty');
  pickFolderBtn.textContent = 'CHANGE';
  clearFolderBtn.style.display = 'inline-flex';
  updateLinkFolderAvailability();
}

function showDirectoryNeedsAccess(name) {
  directoryHandleReady = false;
  downloadPathDisplay.textContent = `${name} (reauthorization needed)`;
  downloadPathDisplay.classList.remove('path-picker__value--empty');
  pickFolderBtn.textContent = 'REAUTHORIZE';
  clearFolderBtn.style.display = 'inline-flex';
  updateLinkFolderAvailability();
}

function showDirectoryUnset() {
  directoryHandleReady = false;
  downloadPathDisplay.textContent = 'Not set — click Browse';
  downloadPathDisplay.classList.add('path-picker__value--empty');
  pickFolderBtn.textContent = 'BROWSE';
  clearFolderBtn.style.display = 'none';
  updateLinkFolderAvailability();
}

async function loadNativeHelperStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_NATIVE_HELPER_STATUS', payload: {} });
  nativeHelperAvailable = !!status?.available;
  updateLinkFolderAvailability();
  nativeHelperHint.textContent = nativeHelperAvailable
    ? 'Native helper ready. Link the same folder path for Explorer open support.'
    : `Install the native helper with scripts/install-native-host.ps1 -ExtensionId ${chrome.runtime.id}`;
}

async function linkNativeFolderPath() {
  if (!nativeHelperAvailable) return;

  const response = await chrome.runtime.sendMessage({ type: 'PICK_NATIVE_FOLDER', payload: {} });
  if (!response?.ok || !response.path) {
    return;
  }

  await chrome.storage.local.set({ nativeFolderPath: response.path });
  showNativeFolderLinked(response.path);
}

function showNativeFolderLinked(path) {
  nativeFolderDisplay.textContent = path;
  nativeFolderDisplay.classList.remove('path-picker__value--empty');
  linkFolderBtn.textContent = 'RELINK';
}

function showNativeFolderUnlinked() {
  nativeFolderDisplay.textContent = 'Not linked';
  nativeFolderDisplay.classList.add('path-picker__value--empty');
  linkFolderBtn.textContent = 'LINK';
}

function updateLinkFolderAvailability() {
  linkFolderBtn.disabled = !nativeHelperAvailable || !directoryHandleReady;
}

async function loadAuthStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS', payload: {} });
    if (status.authenticated) showAuthenticated(status.username);
    else showUnauthenticated();
  } catch {
    showUnauthenticated();
  }
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get({
      downloadPrefix: '',
      autoMode: false,
      openAfterDownload: false,
      nativeFolderPath: '',
      concurrentDownloads: 3
    });
    downloadPrefix.value = result.downloadPrefix;
    autoMode.checked = result.autoMode;
    openAfterDownload.checked = result.openAfterDownload;
    concurrency.value = result.concurrentDownloads;
    concurrencyValue.textContent = result.concurrentDownloads;
    if (result.nativeFolderPath) {
      showNativeFolderLinked(result.nativeFolderPath);
    } else {
      showNativeFolderUnlinked();
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSetting(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error(`Failed to save ${key}:`, err);
  }
}

async function saveToken() {
  const token = patInput.value.trim();
  if (!token) return;
  savePatBtn.textContent = '...';
  savePatBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_TOKEN',
      payload: { token, tokenType: 'pat' }
    });
    if (result.ok) {
      showAuthenticated(result.username);
      patInput.value = '';
      patSection.style.display = 'none';
    } else {
      alert(result.error || 'Invalid token');
    }
  } catch (err) {
    alert('Failed to save token: ' + err.message);
  } finally {
    savePatBtn.textContent = 'SAVE';
    savePatBtn.disabled = false;
  }
}

async function startOAuthFlow() {
  const CLIENT_ID = 'YOUR_GITHUB_OAUTH_CLIENT_ID';
  if (CLIENT_ID === 'YOUR_GITHUB_OAUTH_CLIENT_ID') {
    patSection.style.display = 'flex';
    patInput.focus();
    return;
  }

  connectBtn.textContent = '...';
  connectBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'AUTH_DEVICE_FLOW',
      payload: { clientId: CLIENT_ID, scope: 'public_repo' }
    });
    if (!result.ok) {
      alert(result.error);
      return;
    }

    deviceFlowSection.style.display = 'block';
    deviceCodeEl.textContent = result.userCode;
    try {
      await navigator.clipboard.writeText(result.userCode);
    } catch {}

    chrome.tabs.create({ url: result.verificationUri });
    const tokenResult = await chrome.runtime.sendMessage({
      type: 'POLL_DEVICE_TOKEN',
      payload: { clientId: CLIENT_ID, deviceCode: result.deviceCode, interval: result.interval }
    });
    deviceFlowSection.style.display = 'none';

    if (tokenResult.ok) showAuthenticated(tokenResult.username);
    else alert(tokenResult.error || 'Authentication failed');
  } catch (err) {
    alert('OAuth error: ' + err.message);
    deviceFlowSection.style.display = 'none';
  } finally {
    connectBtn.textContent = 'CONNECT WITH GITHUB';
    connectBtn.disabled = false;
  }
}

async function disconnect() {
  await chrome.storage.local.set({ githubToken: null, tokenType: null });
  showUnauthenticated();
}

function showAuthenticated(username) {
  authDot.className = 'auth-status__dot auth-status__dot--ok';
  authText.textContent = 'Connected';
  authActions.style.display = 'none';
  authConnected.style.display = 'flex';
  authUser.textContent = username || 'Authenticated';
}

function showUnauthenticated() {
  authDot.className = 'auth-status__dot auth-status__dot--err';
  authText.textContent = 'Not connected';
  authActions.style.display = 'flex';
  authConnected.style.display = 'none';
}
