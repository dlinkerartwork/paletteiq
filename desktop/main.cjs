const { app, BrowserWindow, dialog, shell, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { loadOrCreateKey } = require('./key-vault.cjs');
const { startNativeStorage } = require('./native-storage.cjs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PORT = 18763;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
app.setName('PaletteIQ Desktop');
let server = null;
let nativeStorage = null;
let closing = false;

function dataDirectory() {
  const directory = path.join(app.getPath('userData'), 'paletteiq-data');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function ensureCredentials(directory) {
  return loadOrCreateKey(directory, safeStorage);
}

function runtimeConfig(directory, secret, nativeBridge) {
  const original = path.join(ROOT, 'dist', 'server', 'wrangler.json');
  if (!existsSync(original)) throw new Error('PaletteIQ server build is missing. Run npm run build first.');
  const config = JSON.parse(readFileSync(original, 'utf8'));
  config.main = path.join(ROOT, 'dist', 'server', 'index.js');
  config.assets.directory = path.join(ROOT, 'dist', 'client');
  config.vars = { ...(config.vars || {}), PALETTEIQ_DESKTOP: '1', PALETTEIQ_LOCAL_NO_AUTH: '1', PALETTEIQ_NATIVE_BRIDGE_URL: `http://127.0.0.1:${nativeBridge.port}` };
  const configPath = path.join(directory, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(path.join(directory, '.dev.vars'), `STUDIO_CREDENTIAL_ENCRYPTION_KEY=${secret}\nPALETTEIQ_NATIVE_BRIDGE_TOKEN=${nativeBridge.token}\n`, { mode: 0o600 });
  return configPath;
}

function launchWrangler(args, directory, secrets, options = {}) {
  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) throw new Error('Wrangler is missing. Run npm install in the PaletteIQ repository.');
  // Wrangler's argument parser misreads argv when started through Electron's
  // ELECTRON_RUN_AS_NODE mode on Windows. The developer preview uses the real
  // Node.js executable. Standalone installers will bundle their own runtime.
  const nodeExecutable = process.env.PALETTEIQ_NODE_EXECUTABLE || 'node';
  const env = {
    ...process.env,
    PALETTEIQ_DESKTOP: '1',
    PALETTEIQ_LOCAL_NO_AUTH: '1',
    STUDIO_CREDENTIAL_ENCRYPTION_KEY: secrets,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: path.join(directory, 'logs'),
    WRANGLER_REGISTRY_PATH: path.join(directory, 'wrangler-registry'),
    MINIFLARE_REGISTRY_PATH: path.join(directory, 'miniflare-registry'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  mkdirSync(env.WRANGLER_LOG_PATH, { recursive: true });
  return spawn(nodeExecutable, [wrangler, ...args], { cwd: ROOT, env, windowsHide: true, stdio: options.stdio || 'pipe' });
}

async function invokeWrangler(args, directory, secret) {
  return await new Promise((resolve, reject) => {
    const child = launchWrangler(args, directory, secret);
    let stderr = ''; let stdout = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3500); });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Database initialization failed (${code}). ${stderr}`)));
  });
}

async function migrateLegacyDatabase(directory, secret, configPath, storage) {
  const doneMarker = path.join(directory, 'legacy-d1-import-complete');
  if (existsSync(doneMarker)) return;
  const tables = ['projects', 'studio_settings', 'image_batches'];
  const nonEmpty = tables.some(table => storage.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count);
  if (nonEmpty) return;
  const config = ['--config', configPath, '--persist-to', path.join(directory, 'state')];
  const listOutput = await invokeWrangler(['d1', 'execute', 'DB', '--local', ...config, '--json', '--command', "SELECT name FROM sqlite_master WHERE type='table'"], directory, secret);
  const oldTables = new Set((JSON.parse(listOutput.slice(listOutput.indexOf('[')))?.[0]?.results ?? []).map(row => row.name));
  // Read only; never delete or rewrite the original D1/R2 state.
  for (const table of tables) {
    if (!oldTables.has(table)) continue;
    const output = await invokeWrangler(['d1', 'execute', 'DB', '--local', ...config, '--json', '--command', `SELECT * FROM ${table}`], directory, secret);
    const json = JSON.parse(output.slice(output.indexOf('[')));
    const rows = json?.[0]?.results ?? [];
    if (!Array.isArray(rows)) throw new Error(`Unexpected legacy data for ${table}`);
    if (rows.length) {
      const reply = await fetch(`http://127.0.0.1:${storage.port}/legacy-import`, { method: 'POST', headers: { Authorization: `Bearer ${storage.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ table, rows }) });
      if (!reply.ok) throw new Error(`Legacy migration failed for ${table}: ${await reply.text()}`);
    }
  }
  writeFileSync(doneMarker, 'ok\n');
}

async function waitForLocalServer(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs && server && !closing) {
    try { const response = await fetch(SERVER_URL, { signal: AbortSignal.timeout(1500) }); if (response.status < 500) return; }
    catch { /* Server still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Local PaletteIQ server did not become ready. Check the terminal for Wrangler errors.');
}

async function launch() {
  const directory = dataDirectory();
  const secret = ensureCredentials(directory);
  const nativeBridge = { token: randomBytes(32).toString('hex') };
  nativeStorage = await startNativeStorage({ directory, migrationsDir: path.join(ROOT, 'drizzle'), token: nativeBridge.token });
  const configPath = runtimeConfig(directory, secret, { ...nativeBridge, port: nativeStorage.port });
  await migrateLegacyDatabase(directory, secret, configPath, { ...nativeStorage, token: nativeBridge.token });
  server = launchWrangler(['dev', '--local', '--config', configPath, '--persist-to', path.join(directory, 'state'), '--ip', '127.0.0.1', '--port', String(SERVER_PORT)], directory, secret, { stdio: 'inherit' });
  server.on('exit', () => { server = null; if (!closing) app.quit(); });
  await waitForLocalServer();
  const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1050, minHeight: 680, title: 'PaletteIQ Desktop', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${SERVER_URL}/`) && url !== SERVER_URL) event.preventDefault(); });
  await window.loadURL(SERVER_URL);
}

app.whenReady().then(() => launch().catch(async error => { await dialog.showMessageBox({ type: 'error', title: 'PaletteIQ Desktop', message: error.message || String(error) }); app.quit(); }));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  closing = true;
  if (server && !server.killed) server.kill();
  if (nativeStorage) { nativeStorage.server.close(); nativeStorage.database.close(); }
  // .dev.vars is needed by the local Worker only while the app runs.
  try { unlinkSync(path.join(dataDirectory(), '.dev.vars')); } catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove temporary credential environment', error); }
});
