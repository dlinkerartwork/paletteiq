'use strict';

/**
 * Execute the already-authenticated PaletteIQ image Batch sync on the existing
 * desktop renderer. It runs without a visible window, but requires the
 * background Electron process and its local Wrangler worker to remain alive.
 * No OpenAI credentials or SMTP secrets cross into Electron's main process.
 */
const SYNC_SCRIPT = `fetch('/api/image-batches?syncAll=1', {
  credentials: 'same-origin',
  cache: 'no-store'
}).then(response => response.ok).catch(() => false)`;

async function pollHiddenImageBatches(window, log = () => {}) {
  if (!window || window.isDestroyed() || window.isVisible()) return false;
  const contents = window.webContents;
  if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame()) return false;
  try {
    return Boolean(await contents.executeJavaScript(SYNC_SCRIPT, true));
  } catch (error) {
    // A disconnected GPU server, logged-out session, or renderer navigation
    // must not terminate the Windows background notification monitor.
    log('batch-monitor', error instanceof Error ? error.message : String(error));
    return false;
  }
}

module.exports = { pollHiddenImageBatches, SYNC_SCRIPT };
