/**
 * Overlay Bar
 * Floating action bar at the bottom of the viewport.
 * Shows selection count and download/clear buttons.
 * Rendered inside Shadow DOM.
 */

import { addToShadow } from './shadow-host.js';

let _container = null;
let _countEl = null;
let _onDownload = null;
let _onClear = null;
let _visible = false;

/**
 * Initialize the overlay bar (call once).
 * @param {{ onDownload: () => void, onClear: () => void }} handlers
 */
export function initOverlayBar({ onDownload, onClear }) {
  _onDownload = onDownload;
  _onClear = onClear;

  _container = document.createElement('div');
  _container.innerHTML = getTemplate();
  _container.style.cssText = 'display:contents;';

  addToShadow(_container);

  const bar = _container.querySelector('.gfdl-bar');
  const downloadBtn = _container.querySelector('.gfdl-bar__download');
  const clearBtn = _container.querySelector('.gfdl-bar__clear');
  _countEl = _container.querySelector('.gfdl-bar__count');

  downloadBtn.addEventListener('click', () => _onDownload?.());
  clearBtn.addEventListener('click', () => _onClear?.());

  // Initially hidden
  bar.style.transform = 'translateX(-50%) translateY(100%)';
  bar.style.opacity = '0';
}

/**
 * Update the selection count and show/hide the bar.
 * @param {number} count
 */
export function updateOverlayBar(count) {
  if (!_container) return;

  const bar = _container.querySelector('.gfdl-bar');
  if (!bar) return;

  if (count > 0) {
    _countEl.textContent = `${count} ITEM${count > 1 ? 'S' : ''} SELECTED`;
    if (!_visible) {
      _visible = true;
      bar.style.transform = 'translateX(-50%) translateY(0)';
      bar.style.opacity = '1';
    }
  } else {
    if (_visible) {
      _visible = false;
      bar.style.transform = 'translateX(-50%) translateY(100%)';
      bar.style.opacity = '0';
    }
  }
}

/**
 * Destroy the overlay bar.
 */
export function destroyOverlayBar() {
  if (_container) {
    _container.remove();
    _container = null;
    _countEl = null;
    _visible = false;
  }
}

function getTemplate() {
  return `
    <style>
      .gfdl-bar {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(100%);
        opacity: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 8px;
        box-shadow: 3px 3px 0 0 #27272a;
        transition: transform 0.25s ease, opacity 0.2s ease;
        pointer-events: auto;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .gfdl-bar__count {
        color: #ccff00;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
        user-select: none;
      }

      .gfdl-bar__download {
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 16px;
        background: #ccff00;
        color: #000000;
        border: 1px solid #ccff00;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
        white-space: nowrap;
        user-select: none;
      }

      .gfdl-bar__download:hover {
        background: #b3e600;
        border-color: #b3e600;
      }

      .gfdl-bar__download:active {
        transform: translate(2px, 2px);
      }

      .gfdl-bar__clear {
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 12px;
        background: transparent;
        color: #a1a1aa;
        border: 1px solid transparent;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
        white-space: nowrap;
        user-select: none;
      }

      .gfdl-bar__clear:hover {
        color: #fafafa;
        border-color: #3f3f46;
      }

      .gfdl-bar__clear:active {
        transform: translate(2px, 2px);
      }
    </style>

    <div class="gfdl-bar">
      <span class="gfdl-bar__count">0 ITEMS SELECTED</span>
      <button class="gfdl-bar__download">DOWNLOAD</button>
      <button class="gfdl-bar__clear">CLEAR</button>
    </div>
  `;
}
