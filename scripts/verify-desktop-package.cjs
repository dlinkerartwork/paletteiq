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
  // Smoke-test native image tools from the *packaged* runtime. Wrangler
  // --version alone cannot detect absent Sharp or esbuild Windows binaries.
  const nativeSmokeScript = [
    'const sharp = require("sharp");',
    'const esbuild = require("esbuild");',
    'const built = esbuild.transformSync("const answer = 42;", { loader: "js" });',
    'if (!built.code.includes("answer")) throw new Error("esbuild transform failed");',
    'sharp({ create: { width: 2, height: 2, channels: 4, background: "#ffffff" } })',
    '  .png().toBuffer().then(buffer => {',
    '    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))',
    '      throw new Error("Sharp did not encode a valid PNG");',
    '    console.log("Sharp PNG and esbuild native smoke tests passed.");',
    '  }).catch(error => { console.error(error); process.exitCode = 1; });',
  ].join(String.fromCharCode(10));
  // Explicit bundled node.exe and sanitized PATH: do not depend on any
  // globally installed node/npm/python on the build machine.
  const nativeSmoke = spawnSync(path.join(runtime, 'node', 'node.exe'), ['-e', nativeSmokeScript], {
    cwd: runtime, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    },
  });
  if (nativeSmoke.error || nativeSmoke.status !== 0) {
    const detail = (nativeSmoke.error?.message || nativeSmoke.stderr || nativeSmoke.stdout || 'Unknown runtime error')
      .slice(0, 1000);
    throw new Error('Packaged native dependencies failed on Windows (Sharp/esbuild). ' +
      'Check bundled win32-x64 optional binaries and install-script approvals. ' + detail);
  }
  console.log(nativeSmoke.stdout.trim());
  console.log('Desktop package verified: standalone Node.js, Wrangler, Sharp and esbuild work inside win-unpacked.');
};
