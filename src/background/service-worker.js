/**
 * Service Worker (Background Script)
 * Handles GitHub API calls and resolves download manifests for direct writes.
 */

import { getAll, set } from '../lib/storage.js';
import { getAuthStatus, validateToken, startDeviceFlow, pollForToken } from '../lib/auth.js';
import { getTree, getDefaultBranch } from '../lib/github-api.js';
import { buildDownloadPlan } from '../lib/download-plan.js';

const LOG = '[GFDL-SW]';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
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

async function handleResolveDownloadPlan({ owner, repo, branch, selections }) {
  const settings = await getAll();
  const token = settings.githubToken;

  if (!branch) {
    branch = await getDefaultBranch(owner, repo, token);
  }

  const tree = await getTree(owner, repo, branch, token);
  const manifest = buildDownloadPlan({
    tree,
    selections,
    owner,
    repo,
    branch,
    prefix: settings.downloadPrefix
  });

  if (manifest.entries.length === 0) {
    return {
      ok: false,
      error: `No files found for: ${selections.map((selection) => selection.path || selection).join(', ')}`
    };
  }

  console.log(LOG, 'Resolved download plan:', manifest.entries.length, 'files →', manifest.rootPath);
  return { ok: true, manifest };
}
