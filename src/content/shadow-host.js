/**
 * Shadow DOM host for all injected UI.
 * Encapsulates extension UI to prevent style conflicts with GitHub.
 */

const HOST_ID = 'gfdl-shadow-host';

let _host = null;
let _shadow = null;

/**
 * Create or return the Shadow DOM host and its shadow root.
 * @returns {{ host: HTMLElement, shadow: ShadowRoot }}
 */
export function getShadowRoot() {
  if (_shadow) return { host: _host, shadow: _shadow };

  // Remove stale host if it exists (e.g. after SPA nav reinit)
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  _host = document.createElement('div');
  _host.id = HOST_ID;
  _host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(_host);

  _shadow = _host.attachShadow({ mode: 'closed' });

  // Inject base styles
  const style = document.createElement('style');
  style.textContent = getBaseStyles();
  _shadow.appendChild(style);

  return { host: _host, shadow: _shadow };
}

/**
 * Add a component element to the shadow root.
 * @param {HTMLElement} el
 */
export function addToShadow(el) {
  const { shadow } = getShadowRoot();
  shadow.appendChild(el);
}

/**
 * Remove the shadow host from the DOM entirely.
 */
export function destroyShadowHost() {
  if (_host) {
    _host.remove();
    _host = null;
    _shadow = null;
  }
}

function getBaseStyles() {
  return `
    :host {
      all: initial;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Design tokens (dark theme) */
    :host {
      --bg-primary: #09090b;
      --bg-secondary: #18181b;
      --bg-tertiary: #27272a;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-tertiary: #71717a;
      --border-primary: #27272a;
      --border-secondary: #3f3f46;
      --accent-primary: #ccff00;
      --accent-hover: #b3e600;
      --accent-fg: #000000;
      --shadow-hard: 3px 3px 0 0 #27272a;
      --radius: 8px;
    }

    /* All children should receive pointer events */
    * {
      pointer-events: auto;
    }
  `;
}
