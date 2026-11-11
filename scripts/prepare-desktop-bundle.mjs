import { cpSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
if (process.platform !== 'win32') throw new Error('Windows desktop installers must be built on Windows x64.');
if (process.arch !== 'x64') throw new Error('Use 64-bit Node.js to build the Windows installer.');
const sourceNode = process.execPath;
if (!sourceNode.toLowerCase().endsWith('node.exe') || !existsSync(sourceNode)) throw new Error('A real Windows node.exe is required for bundling.');

// Both editions include the Microsoft runtime needed by native Windows tools.
const vcRedist = path.join(root, 'desktop', 'prerequisites', 'vc_redist.x64.exe');
if (!existsSync(vcRedist)) throw new Error('Run scripts/prepare-windows-prerequisites.ps1 before packaging.');
const verifiedPrerequisite = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$s = Get-AuthenticodeSignature -LiteralPath $env:PALETTEIQ_BUILD_VC_REDIST; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { exit 1 }"
], { env: { ...process.env, PALETTEIQ_BUILD_VC_REDIST: vcRedist }, windowsHide: true, encoding: 'utf8' });
if (verifiedPrerequisite.error || verifiedPrerequisite.status !== 0) throw new Error('Bundled Visual C++ installer must have a valid Microsoft signature.');

const unlicensedEdition = process.argv.includes('--no-license');
const publicKey = path.join(root, 'license-issuer', 'public.pem');
if (!unlicensedEdition && !existsSync(publicKey)) throw new Error('Missing license issuer public key. Keep the existing issuer key for licensed builds.');
const stage = path.join(root, 'dist', 'desktop-runtime');
const paths = ['dist/server/wrangler.json', 'dist/server/index.js', 'dist/client', 'drizzle', 'node_modules/wrangler/bin/wrangler.js'];
for (const item of paths) if (!existsSync(path.join(root, item))) throw new Error(`Desktop packaging prerequisite missing: ${item}`);

if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, 'node'), { recursive: true });
copyFileSync(sourceNode, path.join(stage, 'node', 'node.exe'));
if (!unlicensedEdition) copyFileSync(publicKey, path.join(stage, 'license-public.pem'));
cpSync(path.join(root, 'dist', 'server'), path.join(stage, 'dist', 'server'), { recursive: true });
cpSync(path.join(root, 'dist', 'client'), path.join(stage, 'dist', 'client'), { recursive: true });
cpSync(path.join(root, 'drizzle'), path.join(stage, 'drizzle'), { recursive: true });

// pnpm uses a virtual .pnpm store and symlinks. Copying its root packages
// breaks transitive resolution (e.g. Wrangler needs esbuild). Create a fully
// resolved npm dependency tree in staging on the build machine instead.
const wranglerPackage = JSON.parse(readFileSync(path.join(root, 'node_modules', 'wrangler', 'package.json'), 'utf8'));
const version = wranglerPackage.version;
if (!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(version)) throw new Error('Invalid installed Wrangler version.');
writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'paletteiq-desktop-runtime', private: true, version: '1.0.0',
  dependencies: { wrangler: version },
}, null, 2));
console.log(`Installing isolated Wrangler ${version} runtime dependencies...`);
const install = spawnSync('npm.cmd', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev'], {
  cwd: stage, shell: true, stdio: 'inherit',
  env: { ...process.env, npm_config_update_notifier: 'false' },
});
if (install.error || install.status !== 0) {
  throw new Error(`Bundled Wrangler dependency installation failed (${install.status}): ${install.error?.message || 'npm install failed'}`);
}

const stagedWrangler = path.join(stage, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(stagedWrangler)) throw new Error('Bundled Wrangler entrypoint is missing after dependency installation.');
const nodeExecutable = path.join(stage, 'node', 'node.exe');
const smokeTest = spawnSync(nodeExecutable, [stagedWrangler, '--version'], {
  cwd: stage, encoding: 'utf8', windowsHide: true,
});
if (smokeTest.error || smokeTest.status !== 0) {
  throw new Error(`Bundled Wrangler smoke test failed: ${smokeTest.error?.message || smokeTest.stderr || 'nonzero exit'}`);
}
console.log(`Isolated Wrangler smoke test passed: ${smokeTest.stdout.trim()}`);
if (statSync(nodeExecutable).size < 1_000_000) throw new Error('Bundled Node.js executable looks incomplete.');
console.log('Windows runtime staged. Users will not need Node.js installed.');
console.log(`Staged runtime: ${stage}`);
