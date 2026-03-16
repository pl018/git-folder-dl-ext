import { finalizeHistoryRunRecord, sortHistoryRuns } from './history-model.js';

const DB_NAME = 'gfdl-history';
const STORE_NAME = 'downloadRuns';
const DB_VERSION = 1;

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'runId' });

      if (!store.indexNames.contains('downloadedAt')) {
        store.createIndex('downloadedAt', 'downloadedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function executeTransaction(mode, callback) {
  return openHistoryDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    let result;
    try {
      result = callback(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  }));
}

export async function saveHistoryRun(run) {
  return executeTransaction('readwrite', (store) => {
    store.put(run);
    return run;
  });
}

export async function getHistoryRun(runId) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(runId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function finalizeHistoryRun(runId, updates) {
  const run = await getHistoryRun(runId);
  if (!run) {
    throw new Error(`Unknown history run: ${runId}`);
  }

  const finalized = finalizeHistoryRunRecord(run, updates);
  await saveHistoryRun(finalized);
  return finalized;
}

export async function listHistoryRuns({ limit = 10, includePending = false } = {}) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      let runs = sortHistoryRuns(request.result || []);
      if (!includePending) {
        runs = runs.filter((run) => run.status !== 'pending');
      }
      resolve(runs.slice(0, limit));
    };
    request.onerror = () => reject(request.error);
  });
}
