const { cpSync, existsSync, lstatSync, realpathSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// electron-builder excludes node_modules from some extraResources file matching
// paths. Copy the prepared runtime dependencies directly into the unpacked app
// in afterPack, before NSIS creates its installer.
module.exports = async function verifyDesktopPackage(context) {
  if (context.electronPlatformName !== 'win32') return;
  const runtime = path.join(context.appOutDir, 'resources', 'paletteiq-runtime');
  const stagingDependencies = path.join(context.packager.projectDir, 'dist', 'desktop-runtime', 'node_modules');
  const packagedDependencies = path.join(runtime, 'node_modules');
  const stagedEntrypoint = path.join(stagingDependencies, 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(stagedEntrypoint)) {
    throw new Error(`Desktop packaging failed: staged Wrangler missing: ${stagedEntrypoint}`);
  }

  // This explicitly bypasses electron-builder's dependency-tree pruning.
  // The staging script already materializes pnpm's symlinks as real files.
  console.log('Copying standalone desktop dependencies into win-unpacked...');
  cpSync(stagingDependencies, packagedDependencies, { recursive: true, dereference: true, force: true });

  const required = [
    'node/node.exe',
    'node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe',
    'node_modules/@esbuild/win32-x64/esbuild.exe',
    'dist/server/index.js',
    'dist/server/wrangler.json',
    'node_modules/wrangler/bin/wrangler.js',
  ];
  const edition = context.packager.config?.extraMetadata?.paletteiqEdition;
  if (edition !== 'unlicensed') required.push('license-public.pem');
  const base = realpathSync(runtime) + path.sep;
  for (const relative of required) {
    const file = path.join(runtime, relative);
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`Desktop packaging failed: required runtime file missing: ${file}`);
    }
    const actual = realpathSync(file);
    if (!actual.toLowerCase().startsWith(base.toLowerCase())) {
      throw new Error(`Desktop packaging failed: runtime file escapes installation directory: ${file} -> ${actual}`);
    }
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error(`Desktop packaging failed: unexpected runtime symlink: ${file}`);
    }
  }
  const vcRedist = path.join(context.appOutDir, 'resources', 'prerequisites', 'vc_redist.x64.exe');
  if (!existsSync(vcRedist)) throw new Error('Bundled Visual C++ runtime installer is missing.');
  const smoke = spawnSync(path.join(runtime, 'node', 'node.exe'), [path.join(runtime, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '--version'], {
    cwd: runtime, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') },
  });
  if (smoke.error || smoke.status !== 0) throw new Error('Packaged standalone runtime smoke test failed: ' + (smoke.error?.message || smoke.stderr));
  console.log('Desktop package verified: standalone Node.js and Wrangler are present inside win-unpacked.');
};
