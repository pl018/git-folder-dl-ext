/**
 * SPA Navigation Observer for GitHub.
 * Detects page transitions in GitHub's Turbo/pjax SPA
 * and fires a callback when the page content is ready.
 */

const REPO_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(\/((tree|blob)\/([^/]+)(\/(.*))?)?)?/;

let _callback = null;
let _debounceTimer = null;
let _lastUrl = null;
let _observer = null;

function _debouncePageReady() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    const url = location.href;
    if (url !== _lastUrl) {
      _lastUrl = url;
      if (_callback) _callback(url, parseCurrentUrl());
    }
  }, 300);
}

/**
 * Parse the current GitHub URL into structured parts.
 * @returns {{ owner: string, repo: string, branch: string, type: string, path: string } | null}
 */
export function parseCurrentUrl() {
  return parseGitHubUrl(location.href);
}

/**
 * Parse any GitHub URL into structured parts.
 * @param {string} url
 * @returns {{ owner: string, repo: string, branch: string, type: string, path: string } | null}
 */
export function parseGitHubUrl(url) {
  const m = url.match(REPO_PATTERN);
  if (!m) return null;

  let path = m[8] || '';
  if (path.endsWith('/')) path = path.slice(0, -1);

  return {
    owner: m[1],
    repo: m[2],
    branch: m[6] || '',
    type: m[5] || '',       // 'tree' | 'blob' | ''
    path
  };
}

/**
 * Returns true if the current page is a repo file-browser view (tree or root).
 */
export function isFileBrowserPage() {
  const parsed = parseCurrentUrl();
  if (!parsed) return false;
  // Repo root (no type) or tree view
  return parsed.type === '' || parsed.type === 'tree';
}

/**
 * Start observing GitHub SPA navigation.
 * @param {(url: string, parsed: object|null) => void} callback
 */
export function observeNavigation(callback) {
  _callback = callback;
  _lastUrl = location.href;

  // Override pushState/replaceState
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    origPush.apply(this, args);
    _debouncePageReady();
  };

  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    _debouncePageReady();
  };

  // Back/forward navigation
  window.addEventListener('popstate', _debouncePageReady);

  // MutationObserver on main content area for Turbo swaps
  const target = document.querySelector('main') ||
                 document.querySelector('[data-turbo-body]') ||
                 document.body;

  _observer = new MutationObserver((mutations) => {
    // Only trigger if child nodes changed (content swap)
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        _debouncePageReady();
        break;
      }
    }
  });

  _observer.observe(target, { childList: true, subtree: true });

  // Fire immediately for the initial page load
  callback(location.href, parseCurrentUrl());
}

/**
 * Stop observing navigation.
 */
export function stopObserving() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  window.removeEventListener('popstate', _debouncePageReady);
  _callback = null;
  clearTimeout(_debounceTimer);
}
