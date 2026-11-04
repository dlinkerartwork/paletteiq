// Standalone integration smoke test: run after `npm run build`.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startNativeStorage } = require('../desktop/native-storage.cjs');
const root = path.resolve('.');
const temp = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-bridge-smoke-'));
const token = 'bridge-smoke-token';
let bridge, worker;
try {
  bridge = await startNativeStorage({ directory: temp, migrationsDir: path.join(root, 'drizzle'), token });
  const config = JSON.parse(readFileSync(path.join(root, 'dist', 'server', 'wrangler.json'), 'utf8'));
  config.main = path.join(root, 'dist', 'server', 'index.js');
  config.assets.directory = path.join(root, 'dist', 'client');
  config.vars = { PALETTEIQ_DESKTOP: '1', PALETTEIQ_LOCAL_NO_AUTH: '1', PALETTEIQ_NATIVE_BRIDGE_URL: `http://127.0.0.1:${bridge.port}` };
  writeFileSync(path.join(temp, 'wrangler.json'), JSON.stringify(config));
  writeFileSync(path.join(temp, '.dev.vars'), `STUDIO_CREDENTIAL_ENCRYPTION_KEY=${'f'.repeat(64)}\nPALETTEIQ_NATIVE_BRIDGE_TOKEN=${token}\n`);
  const port = 18764;
  worker = spawn(process.execPath, [path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--config', path.join(temp, 'wrangler.json'), '--persist-to', path.join(temp, 'legacy-state'), '--ip', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  worker.stdout.on('data', chunk => { logs = (logs + chunk.toString()).slice(-5000); });
  worker.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-5000); });
  let success = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (worker.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/studio`, { signal: AbortSignal.timeout(1000) });
      const text = await response.text();
      if (response.status === 200 && text.trim() === '[]') { success = true; break; }
      if (response.status >= 400) logs += `\nHTTP ${response.status}: ${text.slice(0, 800)}`;
    } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!success) throw new Error(`Native bridge smoke failed: ${logs.slice(-3500)}`);
  process.stdout.write('Native SQLite bridge served /api/studio successfully.\n');
} finally {
  if (worker && worker.exitCode === null) worker.kill();
  if (bridge) { bridge.server.close(); bridge.database.close(); }
  rmSync(temp, { recursive: true, force: true });
}
