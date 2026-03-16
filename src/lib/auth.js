/**
 * GitHub authentication module.
 * Supports OAuth Device Flow (primary) and PAT validation (fallback).
 */

import { get, set } from './storage.js';

// ---------------------------------------------------------------------------
// OAuth Device Flow
// ---------------------------------------------------------------------------

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * Starts the GitHub OAuth Device Flow.
 * Directs the user to enter a code at the verification URI.
 *
 * @param {string} clientId  - GitHub OAuth App client ID
 * @param {string} [scope='public_repo'] - Requested OAuth scopes
 * @returns {Promise<{deviceCode: string, userCode: string, verificationUri: string, interval: number, expiresIn: number}>}
 */
export async function startDeviceFlow(clientId, scope = 'public_repo') {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ client_id: clientId, scope })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device flow initiation failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in
  };
}

/**
 * Polls GitHub for an access token after the user authorises the device.
 *
 * @param {string} clientId    - GitHub OAuth App client ID
 * @param {string} deviceCode  - Device code from startDeviceFlow
 * @param {number} interval    - Initial polling interval in seconds
 * @returns {Promise<string>}  - Resolved access token
 */
export async function pollForToken(clientId, deviceCode, interval) {
  let pollInterval = interval;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(pollInterval * 1000);

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token poll request failed (${res.status}): ${text}`);
    }

    const data = await res.json();

    if (data.access_token) {
      return data.access_token;
    }

    switch (data.error) {
      case 'authorization_pending':
        // User hasn't entered the code yet — keep polling.
        break;

      case 'slow_down':
        // GitHub is asking us to back off.
        pollInterval += 5;
        break;

      case 'expired_token':
        throw new Error('Device code expired. Please restart the authentication flow.');

      case 'access_denied':
        throw new Error('User denied the authorisation request.');

      default:
        throw new Error(`Unexpected OAuth error: ${data.error} — ${data.error_description || ''}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PAT Validation
// ---------------------------------------------------------------------------

/**
 * Validates a personal access token against the GitHub API.
 *
 * @param {string} token
 * @returns {Promise<{valid: boolean, username?: string, avatarUrl?: string}>}
 */
export async function validateToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      return { valid: false };
    }

    const data = await res.json();
    return {
      valid: true,
      username: data.login,
      avatarUrl: data.avatar_url
    };
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Checks the current authentication status by reading the stored token
 * and validating it against GitHub.
 *
 * @returns {Promise<{authenticated: boolean, username?: string, tokenType?: string}>}
 */
export async function getAuthStatus() {
  const token = await get('githubToken');
  const tokenType = await get('tokenType');

  if (!token) {
    return { authenticated: false };
  }

  const result = await validateToken(token);

  if (!result.valid) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    username: result.username,
    tokenType: tokenType || undefined
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
