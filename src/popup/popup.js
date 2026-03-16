/**
 * Popup Script
 * Manages auth status display, settings, and directory picker.
 */

// ---- IndexedDB for directory handle persistence ----
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

async function clearHandleDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- DOM elements ----
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
const downloadPrefix = document.getElementById('downloadPrefix');
const autoMode = document.getElementById('autoMode');
const openAfterDownload = document.getElementById('openAfterDownload');
const concurrency = document.getElementById('concurrency');
const concurrencyValue = document.getElementById('concurrencyValue');

// ---- Initialize ----
loadAuthStatus();
loadSettings();
loadDirectoryStatus();

// ---- Event listeners ----
connectBtn.addEventListener('click', startOAuthFlow);
showPatBtn.addEventListener('click', () => {
  patSection.style.display = patSection.style.display === 'none' ? 'flex' : 'none';
});
savePatBtn.addEventListener('click', saveToken);
disconnectBtn.addEventListener('click', disconnect);

pickFolderBtn.addEventListener('click', pickFolder);
clearFolderBtn.addEventListener('click', clearFolder);

downloadPrefix.addEventListener('change', () => saveSetting('downloadPrefix', downloadPrefix.value.trim()));
autoMode.addEventListener('change', () => saveSetting('autoMode', autoMode.checked));
openAfterDownload.addEventListener('change', () => saveSetting('openAfterDownload', openAfterDownload.checked));
concurrency.addEventListener('input', () => {
  concurrencyValue.textContent = concurrency.value;
  saveSetting('concurrentDownloads', parseInt(concurrency.value));
});

// ---- Directory picker (runs in popup = extension context, no OS restrictions) ----

async function loadDirectoryStatus() {
  try {
    const handle = await loadHandle();
    if (handle) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        showDirectorySet(handle.name);
        return;
      }
      // Try to re-request (popup is user-gesture-friendly)
      const perm2 = await handle.requestPermission({ mode: 'readwrite' });
      if (perm2 === 'granted') {
        showDirectorySet(handle.name);
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to load directory handle:', e);
  }
  showDirectoryUnset();
}

async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await storeHandle(handle);
    // Also save the name in chrome.storage so content script knows a path is set
    await chrome.storage.local.set({ defaultDownloadPath: handle.name, hasDirectoryHandle: true });
    showDirectorySet(handle.name);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Folder pick error:', err);
    }
  }
}

async function clearFolder() {
  await clearHandleDB();
  await chrome.storage.local.set({ defaultDownloadPath: '', hasDirectoryHandle: false });
  showDirectoryUnset();
}

function showDirectorySet(name) {
  downloadPathDisplay.textContent = name;
  downloadPathDisplay.classList.remove('path-picker__value--empty');
  clearFolderBtn.style.display = 'inline-flex';
}

function showDirectoryUnset() {
  downloadPathDisplay.textContent = 'Not set — click Browse';
  downloadPathDisplay.classList.add('path-picker__value--empty');
  clearFolderBtn.style.display = 'none';
}

// ---- Auth ----

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
      concurrentDownloads: 3
    });
    downloadPrefix.value = result.downloadPrefix;
    autoMode.checked = result.autoMode;
    openAfterDownload.checked = result.openAfterDownload;
    concurrency.value = result.concurrentDownloads;
    concurrencyValue.textContent = result.concurrentDownloads;
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
    if (!result.ok) { alert(result.error); return; }
    deviceFlowSection.style.display = 'block';
    deviceCodeEl.textContent = result.userCode;
    try { await navigator.clipboard.writeText(result.userCode); } catch {}
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
