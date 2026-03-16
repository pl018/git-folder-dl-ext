/**
 * Progress Modal
 * Shows download progress inside Shadow DOM.
 */

import { addToShadow } from './shadow-host.js';

let _container = null;
let _onCancel = null;

/**
 * Show the progress modal.
 * @param {{ onCancel: () => void }} handlers
 */
export function showProgressModal({ onCancel }) {
  _onCancel = onCancel;

  if (_container) _container.remove();

  _container = document.createElement('div');
  _container.innerHTML = getTemplate();
  _container.style.cssText = 'display:contents;';
  addToShadow(_container);

  _container.querySelector('.gfdl-progress__cancel').addEventListener('click', () => {
    _onCancel?.();
  });
}

/**
 * Update progress state.
 * @param {{ completed: number, total: number, currentFile: string, errors: string[] }} state
 */
export function updateProgress({ completed, total, currentFile, errors = [] }) {
  if (!_container) return;
  const normalizedErrors = Array.isArray(errors) ? errors : [];

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const fill = _container.querySelector('.gfdl-progress__fill');
  const text = _container.querySelector('.gfdl-progress__text');
  const file = _container.querySelector('.gfdl-progress__file');
  const errorCount = _container.querySelector('.gfdl-progress__errors');

  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = total > 0 ? `DOWNLOADING ${completed} OF ${total}` : 'PREPARING DOWNLOAD';
  if (file) file.textContent = currentFile || '';

  if (normalizedErrors.length > 0 && errorCount) {
    errorCount.textContent = `${normalizedErrors.length} ERROR${normalizedErrors.length > 1 ? 'S' : ''}`;
    errorCount.style.display = 'block';

    let detailEl = _container.querySelector('.gfdl-progress__error-details');
    if (!detailEl) {
      detailEl = document.createElement('div');
      detailEl.className = 'gfdl-progress__error-details';
      errorCount.parentNode.insertBefore(detailEl, errorCount.nextSibling);
    }
    detailEl.innerHTML = normalizedErrors.map((error) => `<div class="gfdl-progress__error-line">${escapeHtml(error)}</div>`).join('');
  }
}

/**
 * Show completion state.
 * @param {{ total: number, errors: string[], cancelled?: boolean, rolledBack?: number }} result
 */
export function showComplete({ total, errors = [], cancelled = false, rolledBack = 0 }) {
  if (!_container) return;
  const normalizedErrors = Array.isArray(errors) ? errors : [];

  const text = _container.querySelector('.gfdl-progress__text');
  const file = _container.querySelector('.gfdl-progress__file');
  const fill = _container.querySelector('.gfdl-progress__fill');
  const cancelBtn = _container.querySelector('.gfdl-progress__cancel');

  if (fill) fill.style.width = '100%';
  if (text) {
    text.textContent = cancelled
      ? 'DOWNLOAD CANCELED'
      : normalizedErrors.length > 0
      ? `COMPLETED WITH ${normalizedErrors.length} ERROR${normalizedErrors.length > 1 ? 'S' : ''}`
      : `${total} FILE${total > 1 ? 'S' : ''} DOWNLOADED`;
  }
  if (file) {
    file.textContent = cancelled && rolledBack > 0
      ? `Rolled back ${rolledBack} file${rolledBack > 1 ? 's' : ''}.`
      : '';
  }
  if (cancelBtn) cancelBtn.textContent = 'CLOSE';

  if (normalizedErrors.length > 0 && _container) {
    const errorCount = _container.querySelector('.gfdl-progress__errors');
    if (errorCount) {
      errorCount.textContent = `${normalizedErrors.length} ERROR${normalizedErrors.length > 1 ? 'S' : ''}`;
      errorCount.style.display = 'block';
    }

    let detailEl = _container.querySelector('.gfdl-progress__error-details');
    if (!detailEl) {
      const insertAfter = errorCount || _container.querySelector('.gfdl-progress__file');
      detailEl = document.createElement('div');
      detailEl.className = 'gfdl-progress__error-details';
      insertAfter.parentNode.insertBefore(detailEl, insertAfter.nextSibling);
    }
    detailEl.innerHTML = normalizedErrors.map((error) => `<div class="gfdl-progress__error-line">${escapeHtml(error)}</div>`).join('');
  }
}

/**
 * Hide and remove the progress modal.
 */
export function hideProgressModal() {
  if (_container) {
    _container.remove();
    _container = null;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTemplate() {
  return `
    <style>
      .gfdl-progress-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .gfdl-progress__card {
        width: 400px;
        max-width: 90vw;
        padding: 20px;
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 8px;
        box-shadow: 3px 3px 0 0 #27272a;
      }

      .gfdl-progress__text {
        color: #fafafa;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 12px;
      }

      .gfdl-progress__track {
        width: 100%;
        height: 8px;
        background: #27272a;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
      }

      .gfdl-progress__fill {
        height: 100%;
        width: 0%;
        background: #ccff00;
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      .gfdl-progress__file {
        color: #a1a1aa;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-height: 16px;
        margin-bottom: 12px;
      }

      .gfdl-progress__errors {
        display: none;
        color: #ef4444;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin-bottom: 4px;
      }

      .gfdl-progress__error-details {
        max-height: 120px;
        overflow-y: auto;
        margin-bottom: 8px;
        padding: 6px 8px;
        background: #0d0d0f;
        border: 1px solid #27272a;
        border-radius: 4px;
      }

      .gfdl-progress__error-line {
        color: #f87171;
        font-size: 10px;
        font-weight: 400;
        font-family: monospace;
        line-height: 1.5;
        word-break: break-all;
        text-transform: none;
        letter-spacing: 0;
      }

      .gfdl-progress__actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .gfdl-progress__cancel {
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 16px;
        background: transparent;
        color: #a1a1aa;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
      }

      .gfdl-progress__cancel:hover {
        color: #fafafa;
        border-color: #fafafa;
      }

      .gfdl-progress__cancel:active {
        transform: translate(2px, 2px);
      }
    </style>

    <div class="gfdl-progress-overlay">
      <div class="gfdl-progress__card">
        <div class="gfdl-progress__text">PREPARING DOWNLOAD</div>
        <div class="gfdl-progress__track">
          <div class="gfdl-progress__fill"></div>
        </div>
        <div class="gfdl-progress__file"></div>
        <div class="gfdl-progress__errors"></div>
        <div class="gfdl-progress__actions">
          <button class="gfdl-progress__cancel">CANCEL</button>
        </div>
      </div>
    </div>
  `;
}
