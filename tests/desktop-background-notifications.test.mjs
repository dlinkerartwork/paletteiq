import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pollHiddenImageBatches, SYNC_SCRIPT } = require('../desktop/background-batch-monitor.cjs');
const desktop = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');

function fakeWindow({ visible = false, destroyed = false, loading = false, fail = false } = {}) {
  const invoked = [];
  return {
    invoked,
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      isLoadingMainFrame: () => loading,
      executeJavaScript: async (script, userGesture) => {
        invoked.push({ script, userGesture });
        if (fail) throw new Error('renderer offline');
        return true;
      },
    },
  };
}

test('hidden desktop window polls authenticated OpenAI batch status without secrets', async () => {
  const window = fakeWindow();
  assert.equal(await pollHiddenImageBatches(window), true);
  assert.equal(window.invoked.length, 1);
  assert.match(window.invoked[0].script, /\/api\/image-batches\?syncAll=1/);
  assert.match(window.invoked[0].script, /credentials: 'same-origin'/);
  assert.doesNotMatch(SYNC_SCRIPT, /Bearer|sk-|PALETTEIQ_SMTP_PASSWORD|PALETTEIQ_UPSCALE_SERVER_KEY/);
});

test('background monitor never polls a visible, destroyed or loading window', async () => {
  for (const options of [{ visible: true }, { destroyed: true }, { loading: true }]) {
    const window = fakeWindow(options);
    assert.equal(await pollHiddenImageBatches(window), false);
    assert.equal(window.invoked.length, 0);
  }
});

test('renderer errors are contained so batch monitoring retries on next interval', async () => {
  const window = fakeWindow({ fail: true });
  const events = [];
  assert.equal(await pollHiddenImageBatches(window, (...args) => events.push(args)), false);
  assert.equal(events.length, 1);
});

test('closing Desktop hides to tray while explicit Quit stops backend and timer', () => {
  assert.match(desktop, /app\.requestSingleInstanceLock\(\)/);
  assert.match(desktop, /backgroundThrottling: false/);
  assert.match(desktop, /new Tray\(icon\)/);
  assert.match(desktop, /window\.on\('close', event => \{/);
  assert.match(desktop, /event\.preventDefault\(\);\s*window\.hide\(\)/);
  assert.match(desktop, /pollHiddenImageBatches\(window, diagnostics\.write\)/);
  assert.match(desktop, /Quit completely \(stop background monitoring\)/);
  assert.match(desktop, /app\.on\('before-quit', \(\) => \{/);
  assert.match(desktop, /clearInterval\(backgroundMonitorTimer\)/);
  assert.match(desktop, /server\.kill\(\)/);
});
