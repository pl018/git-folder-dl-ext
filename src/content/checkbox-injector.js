/**
 * Checkbox Injector
 * Adds selection checkboxes to GitHub file/folder rows.
 * Manages selection state and notifies listeners on change.
 */

const ATTR_INJECTED = 'data-gfdl';
let _styleInjected = false;

// Multiple selectors for resilience against GitHub DOM changes
const ROW_SELECTORS = [
  'div.react-directory-row',
  'tr.react-directory-row',
  '[class*="TreeView"] [role="treeitem"]',
  'table[aria-labelledby] tbody tr',
  '.js-navigation-item',
  '[data-testid="repos-file-tree-container"] [role="row"]'
];

/** @type {Set<string>} */
const _selected = new Set();

/** @type {Array<(selected: Set<string>) => void>} */
const _listeners = [];

let _lastCheckedIndex = -1;

/**
 * Get the combined selector string.
 */
function getRowSelector() {
  return ROW_SELECTORS.join(', ');
}

/**
 * @typedef {{ path: string, type: 'tree'|'blob' }} RowInfo
 */

/**
 * Extract the path and type from a file row element.
 * @param {HTMLElement} row
 * @returns {RowInfo|null}
 */
function getRowInfo(row) {
  // Try multiple strategies to find the file/folder link
  const treeLink = row.querySelector('a[href*="/tree/"]');
  const blobLink = row.querySelector('a[href*="/blob/"]');
  const link = treeLink || blobLink ||
               row.querySelector('a.Link--primary') ||
               row.querySelector('a[class*="Link"]') ||
               row.querySelector('a');

  if (!link) return null;

  const href = link.getAttribute('href') || '';
  // Extract path from href: /owner/repo/tree/branch/path/to/folder
  const match = href.match(/\/[^/]+\/[^/]+\/(tree|blob)\/[^/]+\/?(.*)/);
  if (match) {
    return {
      path: match[2] || link.textContent.trim(),
      type: match[1] // 'tree' or 'blob'
    };
  }

  // Fallback: determine type from row context
  const type = isDirectoryRow(row) ? 'tree' : 'blob';
  return { path: link.textContent.trim(), type };
}

/**
 * Check if a row represents a directory (not a file).
 * @param {HTMLElement} row
 * @returns {boolean}
 */
function isDirectoryRow(row) {
  // Check for folder icon SVG
  const svg = row.querySelector('svg');
  if (svg) {
    const ariaLabel = svg.getAttribute('aria-label') || '';
    if (ariaLabel.toLowerCase().includes('directory') || ariaLabel.toLowerCase().includes('folder')) {
      return true;
    }
  }
  // Check for tree link
  const link = row.querySelector('a[href*="/tree/"]');
  return !!link;
}

/**
 * Create a styled checkbox element.
 * @returns {HTMLElement}
 */
function createCheckbox() {
  const wrapper = document.createElement('div');
  wrapper.className = 'gfdl-checkbox-wrap';
  wrapper.style.cssText = `
    position: absolute;
    left: 6px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    z-index: 2;
    opacity: 0;
    transition: opacity 0.15s ease-in-out;
  `;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'gfdl-checkbox';
  input.style.cssText = `
    appearance: none;
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border: 1px solid #3f3f46;
    border-radius: 3px;
    background: rgba(24, 24, 27, 0.8);
    cursor: pointer;
    margin: 0;
    padding: 0;
    transition: all 0.15s ease-in-out;
  `;

  wrapper.appendChild(input);
  return wrapper;
}

/**
 * Apply checked visual style.
 * @param {HTMLInputElement} checkbox
 * @param {boolean} checked
 */
function styleCheckbox(checkbox, checked) {
  const wrapper = checkbox.closest('.gfdl-checkbox-wrap');
  if (checked) {
    checkbox.style.background = '#ccff00';
    checkbox.style.borderColor = '#ccff00';
    checkbox.style.boxShadow = 'inset 0 0 0 2px #000';
    // Keep checked checkboxes always visible
    if (wrapper) wrapper.style.opacity = '1';
  } else {
    checkbox.style.background = 'rgba(24, 24, 27, 0.8)';
    checkbox.style.borderColor = '#3f3f46';
    checkbox.style.boxShadow = 'none';
    // Unchecked goes back to ghosted (hover-reveal)
    if (wrapper) wrapper.style.opacity = '';
  }
}

/**
 * Inject checkboxes into all file/folder rows on the current page.
 */
export function injectCheckboxes() {
  // Inject global CSS for hover-reveal behavior (once)
  if (!_styleInjected) {
    const style = document.createElement('style');
    style.textContent = `
      .react-directory-row:hover .gfdl-checkbox-wrap { opacity: 0.6 !important; }
      .react-directory-row .gfdl-checkbox-wrap input:checked { opacity: 1 !important; }
      .gfdl-checkbox-wrap:hover { opacity: 1 !important; }
    `;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  const rows = document.querySelectorAll(getRowSelector());
  let index = 0;

  console.log('[GFDL] Found', rows.length, 'rows to inject checkboxes into');

  rows.forEach((row) => {
    if (row.hasAttribute(ATTR_INJECTED)) {
      index++;
      return;
    }

    const info = getRowInfo(row);
    if (!info) {
      index++;
      return;
    }

    row.setAttribute(ATTR_INJECTED, 'true');
    // Store the type on the row for later retrieval
    row.setAttribute('data-gfdl-type', info.type);

    const wrapper = createCheckbox();
    const checkbox = wrapper.querySelector('input');
    const currentIndex = index;
    const selectionKey = `${info.type}:${info.path}`;

    // Set initial state if previously selected
    if (_selected.has(selectionKey)) {
      checkbox.checked = true;
      styleCheckbox(checkbox, true);
    }

    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      handleCheck(selectionKey, checkbox.checked, currentIndex, e.shiftKey);
      styleCheckbox(checkbox, checkbox.checked);
    });

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Insert as absolutely-positioned overlay inside the large-screen name cell.
    // This avoids disrupting the table column structure.
    const nameCell = row.querySelector('td.react-directory-row-name-cell-large-screen') ||
                     row.querySelector('td[class*="name-cell-large"]') ||
                     row.querySelector('td[class*="name-cell"]') ||
                     row.querySelector('td');

    if (nameCell) {
      nameCell.style.position = 'relative';
      nameCell.style.paddingLeft = '28px';
      nameCell.appendChild(wrapper);
    } else {
      // Div-based layout fallback: append at end of row
      row.style.position = 'relative';
      row.appendChild(wrapper);
    }

    // Add hover listener on the row to reveal/hide the checkbox
    row.addEventListener('mouseenter', () => {
      if (!checkbox.checked) wrapper.style.opacity = '0.6';
    });
    row.addEventListener('mouseleave', () => {
      if (!checkbox.checked) wrapper.style.opacity = '0';
    });

    index++;
  });
}

/**
 * Handle a checkbox check/uncheck with shift-click support.
 * @param {string} selectionKey - "type:path" format
 * @param {boolean} checked
 * @param {number} index
 * @param {boolean} shiftKey
 */
function handleCheck(selectionKey, checked, index, shiftKey) {
  if (checked) {
    _selected.add(selectionKey);
  } else {
    _selected.delete(selectionKey);
  }

  // Shift+click range selection
  if (shiftKey && _lastCheckedIndex >= 0 && _lastCheckedIndex !== index) {
    const rows = document.querySelectorAll(getRowSelector());
    const start = Math.min(_lastCheckedIndex, index);
    const end = Math.max(_lastCheckedIndex, index);

    for (let i = start; i <= end; i++) {
      const row = rows[i];
      if (!row) continue;
      const info = getRowInfo(row);
      if (!info) continue;
      const key = `${info.type}:${info.path}`;

      const cb = row.querySelector('.gfdl-checkbox');
      if (cb) {
        cb.checked = checked;
        styleCheckbox(cb, checked);
      }
      if (checked) _selected.add(key);
      else _selected.delete(key);
    }
  }

  _lastCheckedIndex = index;
  _notifyListeners();
}

/**
 * Remove all injected checkboxes and clear selection.
 */
export function removeCheckboxes() {
  document.querySelectorAll('.gfdl-checkbox-wrap').forEach(el => el.remove());
  document.querySelectorAll(`[${ATTR_INJECTED}]`).forEach(el => {
    el.removeAttribute(ATTR_INJECTED);
  });
}

/**
 * Clear all selections.
 */
export function clearSelection() {
  _selected.clear();
  _lastCheckedIndex = -1;
  document.querySelectorAll('.gfdl-checkbox').forEach(cb => {
    cb.checked = false;
    styleCheckbox(cb, false);
  });
  _notifyListeners();
}

/**
 * Get current selected items with type info.
 * @returns {Array<{type: string, path: string}>}
 */
export function getSelectedItems() {
  return Array.from(_selected).map(key => {
    const colonIdx = key.indexOf(':');
    return {
      type: key.slice(0, colonIdx),
      path: key.slice(colonIdx + 1)
    };
  });
}

/**
 * Get current selected paths (just paths, no type).
 * @returns {string[]}
 */
export function getSelectedPaths() {
  return getSelectedItems().map(item => item.path);
}

/**
 * Get selection count.
 * @returns {number}
 */
export function getSelectionCount() {
  return _selected.size;
}

/**
 * Register a listener for selection changes.
 * @param {(selected: Set<string>) => void} fn
 */
export function onSelectionChange(fn) {
  _listeners.push(fn);
}

/**
 * Unregister a selection change listener.
 * @param {(selected: Set<string>) => void} fn
 */
export function offSelectionChange(fn) {
  const idx = _listeners.indexOf(fn);
  if (idx >= 0) _listeners.splice(idx, 1);
}

function _notifyListeners() {
  for (const fn of _listeners) {
    fn(_selected);
  }
}
