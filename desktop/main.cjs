const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PORT = 18763;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
app.setName('PaletteIQ Desktop');
let server = null;
let closing = false;

function dataDirectory() {
  const directory = path.join(app.getPath('userData'), 'paletteiq-data');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function ensureCredentials(directory) {
  const secrets = path.join(directory, 'desktop-secrets.json');
  if (!existsSync(secrets)) {
    writeFileSync(secrets, JSON.stringify({ encryptionKey: randomBytes(32).toString('hex') }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  const config = JSON.parse(readFileSync(secrets, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(config.encryptionKey)) throw new Error('Desktop credential key is invalid');
  return config.encryptionKey;
}

function runtimeConfig(directory, secret) {
  const original = path.join(ROOT, 'dist', 'server', 'wrangler.json');
  if (!existsSync(original)) throw new Error('PaletteIQ server build is missing. Run npm run build first.');
  const config = JSON.parse(readFileSync(original, 'utf8'));
  config.main = path.join(ROOT, 'dist', 'server', 'index.js');
  config.assets.directory = path.join(ROOT, 'dist', 'client');
  config.vars = { ...(config.vars || {}), PALETTEIQ_DESKTOP: '1', PALETTEIQ_LOCAL_NO_AUTH: '1' };
  const configPath = path.join(directory, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(path.join(directory, '.dev.vars'), `STUDIO_CREDENTIAL_ENCRYPTION_KEY=${secret}\n`, { mode: 0o600 });
  return configPath;
}

function launchWrangler(args, directory, secrets, options = {}) {
  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) throw new Error('Wrangler is missing. Run npm install in the PaletteIQ repository.');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PALETTEIQ_DESKTOP: '1',
    PALETTEIQ_LOCAL_NO_AUTH: '1',
    STUDIO_CREDENTIAL_ENCRYPTION_KEY: secrets,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: path.join(directory, 'logs'),
    WRANGLER_REGISTRY_PATH: path.join(directory, 'wrangler-registry'),
    MINIFLARE_REGISTRY_PATH: path.join(directory, 'miniflare-registry'),
  };
  mkdirSync(env.WRANGLER_LOG_PATH, { recursive: true });
  return spawn(process.execPath, [wrangler, ...args], { cwd: ROOT, env, windowsHide: true, stdio: options.stdio || 'pipe' });
}

async function invokeWrangler(args, directory, secret) {
  return await new Promise((resolve, reject) => {
    const child = launchWrangler(args, directory, secret);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3500); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Database initialization failed (${code}). ${stderr}`)));
  });
}

async function prepareDatabase(directory, secret) {
  const configPath = runtimeConfig(directory, secret);
  const config = ['--config', configPath, '--persist-to', path.join(directory, 'state')];
  for (const filename of ['0000_slippery_pyro.sql', '0001_big_bedlam.sql', '0002_fine_red_hulk.sql']) {
    const marker = path.join(directory, `applied-${filename}`);
    if (existsSync(marker)) continue;
    await invokeWrangler(['d1', 'execute', 'DB', '--local', ...config, '--file', path.join(ROOT, 'drizzle', filename)], directory, secret);
    writeFileSync(marker, 'ok\n');
  }
  return configPath;
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
  const configPath = await prepareDatabase(directory, secret);
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
app.on('before-quit', () => { closing = true; if (server && !server.killed) server.kill(); });
