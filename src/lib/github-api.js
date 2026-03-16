/**
 * GitHub API client for tree/file operations.
 * Handles repository metadata, recursive tree fetching, and download URL resolution.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds common request headers.
 * @param {string|null} token
 * @returns {Record<string, string>}
 */
function buildHeaders(token) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }
  return headers;
}

/**
 * Checks the rate-limit header and warns when running low.
 * @param {Response} res
 */
function checkRateLimit(res) {
  const remaining = res.headers.get('X-RateLimit-Remaining');
  if (remaining !== null && Number(remaining) < 100) {
    console.warn(`GitHub API rate-limit low: ${remaining} requests remaining.`);
  }
}

/**
 * Performs a fetch, checks response status, inspects rate-limit headers,
 * and returns parsed JSON.
 *
 * @param {string} url
 * @param {string|null} token
 * @returns {Promise<any>}
 */
async function apiFetch(url, token) {
  const res = await fetch(url, { headers: buildHeaders(token) });

  checkRateLimit(res);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status} for ${url}: ${body}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the default branch name for a repository.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string|null} token
 * @returns {Promise<string>}
 */
export async function getDefaultBranch(owner, repo, token) {
  const data = await apiFetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    token
  );
  return data.default_branch;
}

/**
 * Fetches the full recursive tree for a given branch/ref.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string|null} token
 * @returns {Promise<Array<{path: string, type: string, sha: string, size?: number, url: string}>>}
 */
export async function getTree(owner, repo, branch, token) {
  const data = await apiFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token
  );
  if (!Array.isArray(data?.tree)) {
    const apiMessage = typeof data?.message === 'string' ? ` ${data.message}` : '';
    throw new Error(`GitHub tree response was invalid for ${owner}/${repo}@${branch}.${apiMessage}`.trim());
  }
  return data.tree.map(item => ({
    path: item.path,
    type: item.type,
    sha: item.sha,
    size: item.size,
    url: item.url
  }));
}

/**
 * Filters a tree array to only blobs that fall under `folderPath`.
 * Returned paths are relative to folderPath.
 *
 * @param {Array<{path: string, type: string}>} tree
 * @param {string} folderPath - e.g. "src/components"
 * @returns {Array<{path: string, type: string, sha: string, size?: number, url: string}>}
 */
export function filterTree(tree, folderPath) {
  if (!Array.isArray(tree)) {
    return [];
  }

  // Normalise: strip leading/trailing slashes
  const prefix = folderPath.replace(/^\/+|\/+$/g, '');

  // If the folderPath is empty (root), return all blobs as-is
  if (!prefix) {
    return tree.filter(item => item.type === 'blob');
  }

  const prefixWithSlash = prefix + '/';

  return tree
    .filter(item => item.type === 'blob' && item.path.startsWith(prefixWithSlash))
    .map(item => ({
      ...item,
      path: item.path.slice(prefixWithSlash.length)
    }));
}

/**
 * Builds a raw.githubusercontent.com URL for a single file.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} filePath
 * @returns {string}
 */
export function buildRawUrl(owner, repo, branch, filePath) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

/**
 * Main entry point. Resolves selected folder paths into a flat list of
 * downloadable files with their raw URLs.
 *
 * The full tree is fetched once per repository and cached for the lifetime
 * of the call.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string[]} selectedPaths - folder paths to include
 * @param {string|null} token
 * @returns {Promise<Array<{relativePath: string, downloadUrl: string}>>}
 */
export async function resolveDownloads(owner, repo, branch, selectedPaths, token) {
  // Fetch the full tree once and reuse for every selected path.
  const fullTree = await getTree(owner, repo, branch, token);

  /** @type {Array<{relativePath: string, downloadUrl: string}>} */
  const downloads = [];

  for (const selectedPath of selectedPaths) {
    const blobs = filterTree(fullTree, selectedPath);

    for (const blob of blobs) {
      // Preserve folder structure: selectedPath base name + relative path
      const baseName = selectedPath.replace(/^\/+|\/+$/g, '').split('/').pop() || '';
      const relativePath = baseName ? `${baseName}/${blob.path}` : blob.path;

      downloads.push({
        relativePath,
        downloadUrl: buildRawUrl(
          owner,
          repo,
          branch,
          selectedPath.replace(/^\/+|\/+$/g, '') + '/' + blob.path
        )
      });
    }
  }

  return downloads;
}

/**
 * Parses a GitHub URL into its constituent parts.
 *
 * Supported formats:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch/path/to/folder
 *   https://github.com/owner/repo/blob/branch/path/to/file
 *
 * @param {string} url
 * @returns {{owner: string, repo: string, branch: string|null, type: string|null, path: string|null}}
 */
export function parseRepoUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== 'github.com') {
      throw new Error('Not a GitHub URL');
    }

    // Remove leading slash and trailing slashes, then split
    const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');

    if (segments.length < 2) {
      throw new Error('URL must contain at least owner and repo');
    }

    const owner = segments[0];
    const repo = segments[1];

    // Simple repo URL — no branch/path info
    if (segments.length === 2) {
      return { owner, repo, branch: null, type: null, path: null };
    }

    // segments[2] is the type indicator: "tree" or "blob"
    const type = segments[2]; // 'tree' | 'blob'

    if (segments.length === 3) {
      // e.g. /owner/repo/tree — unusual, treat as no branch
      return { owner, repo, branch: null, type, path: null };
    }

    const branch = segments[3];

    // Everything after /owner/repo/tree|blob/branch/ is the path
    const path = segments.length > 4 ? segments.slice(4).join('/') : null;

    return { owner, repo, branch, type, path };
  } catch (err) {
    if (err.message === 'Not a GitHub URL' || err.message.includes('owner and repo')) {
      throw err;
    }
    throw new Error(`Failed to parse GitHub URL: ${err.message}`);
  }
}
