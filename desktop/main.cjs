const { app, BrowserWindow, dialog, shell, safeStorage, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, appendFileSync, statSync, renameSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { loadOrCreateKey } = require('./key-vault.cjs');
const { startNativeStorage } = require('./native-storage.cjs');
const { backupWorkspace, restoreWorkspaceSeparate, validateWorkspace } = require('./workspace-backup.cjs');
const { windowsDeviceCode, readValidLicense } = require('./license.cjs');

const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'paletteiq-runtime') : path.resolve(__dirname, '..');
const SERVER_PORT = 18763;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
app.setName('PaletteIQ Desktop');
let server = null;
let nativeStorage = null;
let closing = false;
let activeDirectory = null;

function workspaceRoot() {
  const directory = path.join(app.getPath('userData'), 'paletteiq-data');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function dataDirectory() {
  const root = workspaceRoot();
  const pointer = path.join(root, 'active-workspace.json');
  if (!existsSync(pointer)) return root;
  const name = JSON.parse(readFileSync(pointer, 'utf8')).name;
  if (typeof name !== 'string' || !/^restored-[0-9]+-[0-9a-f]{8}$/.test(name)) throw new Error('Invalid active workspace selector');
  const directory = path.join(root, 'restored-workspaces', name);
  validateWorkspace(directory, { requireNoCredentials: false });
  return directory;
}

const MAX_DIAGNOSTIC_LOG_BYTES = 2 * 1024 * 1024;
function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/piq_[A-Za-z0-9_=-]{12,}/g, '[REDACTED_CLIENT_KEY]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(X-API-Key\s*[:=]\s*)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/(STUDIO_CREDENTIAL_ENCRYPTION_KEY|PALETTEIQ_NATIVE_BRIDGE_TOKEN|PALETTEIQ_UPSCALE_SERVER_KEY|api[_-]?key|password|authorization|access[_-]?token)(\s*[=:]\s*)[^\s,"'}]+/gi, '$1$2[REDACTED]');
}
function diagnosticLogger(directory) {
  const folder = path.join(directory, 'logs');
  mkdirSync(folder, { recursive: true });
  const filename = path.join(folder, 'desktop-backend.log');
  const rotate = () => {
    for (let i = 2; i >= 1; i--) {
      const source = i === 1 ? filename : path.join(folder, `desktop-backend.${i - 1}.log`);
      const target = path.join(folder, `desktop-backend.${i}.log`);
      if (existsSync(source)) { if (existsSync(target)) unlinkSync(target); renameSync(source, target); }
    }
  };
  if (existsSync(filename) && statSync(filename).size >= MAX_DIAGNOSTIC_LOG_BYTES) rotate();
  const write = (kind, chunk) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const line = `[${new Date().toISOString()}] [${kind}] ${sanitizeDiagnostic(raw).slice(0, 2000)}\n`;
      try {
        if (existsSync(filename) && statSync(filename).size + Buffer.byteLength(line) > MAX_DIAGNOSTIC_LOG_BYTES) rotate();
        appendFileSync(filename, line, { encoding: 'utf8', mode: 0o600 });
      } catch { /* Logging must never stop the application. */ }
    }
  };
  return { folder, write };
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
  const remoteUrl = process.env.PALETTEIQ_UPSCALE_SERVER_URL || '';
  const remoteKey = process.env.PALETTEIQ_UPSCALE_SERVER_KEY || '';
  if (/[\r\n]/.test(remoteUrl + remoteKey)) throw new Error('Invalid Remote GPU configuration');
  writeFileSync(path.join(directory, '.dev.vars'), `STUDIO_CREDENTIAL_ENCRYPTION_KEY=${secret}\nPALETTEIQ_NATIVE_BRIDGE_TOKEN=${nativeBridge.token}\nPALETTEIQ_UPSCALE_SERVER_URL=${remoteUrl}\nPALETTEIQ_UPSCALE_SERVER_KEY=${remoteKey}\n`, { mode: 0o600 });
  return configPath;
}

function launchWrangler(args, directory, secrets, options = {}) {
  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) throw new Error('Wrangler is missing. Run npm install in the PaletteIQ repository.');
  // Wrangler's argument parser misreads argv when started through Electron's
  // ELECTRON_RUN_AS_NODE mode on Windows. The developer preview uses the real
  // Node.js executable. Standalone installers will bundle their own runtime.
  const nodeExecutable = app.isPackaged ? path.join(ROOT, 'node', 'node.exe') : (process.env.PALETTEIQ_NODE_EXECUTABLE || 'node');
  if (app.isPackaged && !existsSync(nodeExecutable)) throw new Error('Bundled Node.js runtime is missing. Reinstall PaletteIQ Desktop.');
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

function configureWorkspaceMenu(directory) {
  const error = async e => dialog.showMessageBox({ type: 'error', title: 'Workspace backup', message: e instanceof Error ? e.message : String(e) });
  const selectedName = path.basename(directory);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Workspace', submenu: [
    { label: 'Backup active workspace to ZIP…', click: async () => { try {
      const choice = await dialog.showSaveDialog({ title: 'Backup PaletteIQ workspace', defaultPath: `PaletteIQ-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
      if (choice.canceled || !choice.filePath) return;
      await backupWorkspace({ directory, database: nativeStorage.database, destination: choice.filePath });
      await dialog.showMessageBox({ type: 'info', message: 'Workspace backup created. API keys were excluded.', detail: choice.filePath });
    } catch (e) { await error(e); } } },
    { label: 'Restore ZIP as separate workspace…', click: async () => { try {
      const choice = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PaletteIQ ZIP', extensions: ['zip'] }] });
      if (choice.canceled || !choice.filePaths[0]) return;
      const restored = await restoreWorkspaceSeparate({ source: choice.filePaths[0], workspaceRoot: workspaceRoot() });
      await dialog.showMessageBox({ type: 'info', message: 'Backup restored separately. Active workspace was not changed.', detail: `Restored to: ${restored}\nUse Workspace → Switch workspace to open the restored copy.` });
    } catch (e) { await error(e); } } },
    { label: 'Switch to restored workspace…', click: async () => { try {
      const root = path.join(workspaceRoot(), 'restored-workspaces');
      mkdirSync(root, { recursive: true });
      const choice = await dialog.showOpenDialog({ defaultPath: root, properties: ['openDirectory'] });
      if (choice.canceled || !choice.filePaths[0]) return;
      const chosen = choice.filePaths[0];
      const name = path.basename(chosen);
      if (!/^restored-[0-9]+-[0-9a-f]{8}$/.test(name) || path.resolve(chosen).toLowerCase() !== path.resolve(root, name).toLowerCase()) throw new Error('Choose a restored workspace inside the PaletteIQ data directory');
      validateWorkspace(chosen, { requireNoCredentials: false });
      const confirmation = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Switch and restart'], defaultId: 0, cancelId: 0, message: `Open restored workspace ${name}? Current workspace stays intact.` });
      if (confirmation.response !== 1) return;
      writeFileSync(path.join(workspaceRoot(), 'active-workspace.json'), JSON.stringify({ name }));
      app.relaunch(); app.quit();
    } catch (e) { await error(e); } } },
    { label: 'Open Logs Folder', click: () => { const folder = path.join(directory, 'logs'); mkdirSync(folder, { recursive: true }); void shell.openPath(folder); } },
    { label: 'Switch to original workspace…', enabled: selectedName !== 'paletteiq-data', click: async () => { try {
      const confirmation = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Switch and restart'], defaultId: 0, cancelId: 0, message: 'Return to your original workspace? The restored workspace will remain saved.' });
      if (confirmation.response !== 1) return;
      const pointer = path.join(workspaceRoot(), 'active-workspace.json');
      if (existsSync(pointer)) unlinkSync(pointer);
      app.relaunch(); app.quit();
    } catch (e) { await error(e); } } },
  ] }]));
}

function isUnlicensedEdition() {
  if (!app.isPackaged) return false;
  // Only the installer edition metadata controls activation. Environment
  // variables and user settings must never disable licensing.
  const metadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
  return metadata.paletteiqEdition === 'unlicensed';
}

async function requireActivation() {
  if (!app.isPackaged || isUnlicensedEdition()) return; // Developer preview and explicit unlicensed edition.
  const publicKeyFile = path.join(ROOT, 'license-public.pem');
  if (!existsSync(publicKeyFile)) throw new Error('Desktop license verification key is missing from the installer.');
  const publicKey = readFileSync(publicKeyFile, 'utf8');
  const device = windowsDeviceCode();
  const target = path.join(workspaceRoot(), 'activation-license.json');
  try { if (existsSync(target)) { readValidLicense(target, publicKey, device); return; } }
  catch { /* Offer replacement license on changed devices or invalid files. */ }
  while (true) {
    const choice = await dialog.showMessageBox({
      type: 'info', title: 'PaletteIQ activation',
      message: 'PaletteIQ Desktop requires a license for this Windows device.',
      detail: `Device code: ${device}\n\nSend this code to the PaletteIQ license issuer and request a non-expiring license file. Press Ctrl+C to copy this dialog text.`,
      buttons: ['Select license file…', 'Exit'], defaultId: 0, cancelId: 1,
    });
    if (choice.response !== 0) throw new Error('Activation is required to launch PaletteIQ Desktop.');
    const selection = await dialog.showOpenDialog({
      title: 'Choose your PaletteIQ license',
      properties: ['openFile'], filters: [{ name: 'PaletteIQ license', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) continue;
    try {
      readValidLicense(selection.filePaths[0], publicKey, device);
      copyFileSync(selection.filePaths[0], target);
      return;
    } catch (error) {
      await dialog.showMessageBox({ type: 'error', title: 'License rejected', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function launch() {
  await requireActivation();
  const directory = dataDirectory();
  activeDirectory = directory;
  const secret = ensureCredentials(directory);
  const nativeBridge = { token: randomBytes(32).toString('hex') };
  nativeStorage = await startNativeStorage({ directory, migrationsDir: path.join(ROOT, 'drizzle'), token: nativeBridge.token });
  const configPath = runtimeConfig(directory, secret, { ...nativeBridge, port: nativeStorage.port });
  await migrateLegacyDatabase(directory, secret, configPath, { ...nativeStorage, token: nativeBridge.token });
  const diagnostics = diagnosticLogger(directory);
  diagnostics.write('desktop', 'PaletteIQ backend starting.');
  server = launchWrangler(['dev', '--local', '--config', configPath, '--persist-to', path.join(directory, 'state'), '--ip', '127.0.0.1', '--port', String(SERVER_PORT)], directory, secret, { stdio: 'pipe' });
  server.stdout?.on('data', chunk => diagnostics.write('stdout', chunk));
  server.stderr?.on('data', chunk => diagnostics.write('stderr', chunk));
  server.on('error', error => diagnostics.write('process', error.message));

  server.on('exit', () => { server = null; if (!closing) app.quit(); });
  await waitForLocalServer();
  configureWorkspaceMenu(directory);
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
  if (activeDirectory) {
    try { unlinkSync(path.join(activeDirectory, '.dev.vars')); } catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove temporary credential environment', error); }
  }
});

