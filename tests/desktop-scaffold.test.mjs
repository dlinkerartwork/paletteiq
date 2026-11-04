import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const desktop = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../app/chatgpt-auth.ts', import.meta.url), 'utf8');

test('desktop binds to loopback, stores data in userData, and isolates browser renderer', () => {
  assert.match(desktop, /127\.0\.0\.1/);
  assert.match(desktop, /app\.getPath\('userData'\)/);
  assert.match(desktop, /nodeIntegration: false, contextIsolation: true, sandbox: true/);
});

test('SQLite D1 and R2 state is persisted under user profile, not repository checkout', () => {
  assert.match(desktop, /path\.join\(directory, 'state'\)/);
  assert.match(desktop, /d1', 'execute'/);
});

test('desktop anonymous identity requires explicitly configured desktop mode', () => {
  assert.match(auth, /localBindings\.PALETTEIQ_DESKTOP === "1"/);
  assert.match(auth, /host === "localhost" \|\| host === "127\.0\.0\.1"/);
});

test('Wrangler CLI runs using Node, not Electron argv emulation', () => {
  assert.match(desktop, /PALETTEIQ_NODE_EXECUTABLE \|\| 'node'/);
  assert.match(desktop, /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.match(desktop, /spawn\(nodeExecutable, \[wrangler, \.\.\.args\]/);
});
