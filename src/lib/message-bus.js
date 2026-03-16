/**
 * Typed message passing between content script and service worker.
 * Message format: { type: string, payload: any }
 */

/** @type {Map<string, Set<function>>} */
const handlers = new Map();
let listening = false;

/**
 * Sends a message via chrome.runtime.sendMessage.
 * @param {string} type
 * @param {any} [payload]
 * @returns {Promise<any>} Response from the handler.
 */
export function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

/**
 * Registers a handler for a given message type.
 * Handler receives (payload, sender) and may return a value or a Promise.
 * @param {string} type
 * @param {function} handler
 */
export function on(type, handler) {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type).add(handler);
  ensureListener();
}

/**
 * Unregisters a handler for a given message type.
 * @param {string} type
 * @param {function} handler
 */
export function off(type, handler) {
  const set = handlers.get(type);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) handlers.delete(type);
}

/** Installs the single onMessage listener on first use. */
function ensureListener() {
  if (listening) return;
  listening = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message || {};
    const set = handlers.get(type);
    if (!set || set.size === 0) return false;

    // Run all handlers for this type; use the first one that returns a value.
    let responded = false;
    for (const handler of set) {
      const result = handler(payload, sender);
      if (result instanceof Promise) {
        result.then(sendResponse).catch((err) => {
          sendResponse({ __error: err.message || String(err) });
        });
        responded = true;
        break;
      }
      if (result !== undefined) {
        sendResponse(result);
        responded = true;
        break;
      }
    }

    // Return true to keep the message channel open for async responses.
    return responded;
  });
}
