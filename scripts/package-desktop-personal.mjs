import { spawnSync } from 'node:child_process';
import { existsSync, renameSync, readFileSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.');
const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, 'release', `PaletteIQ-Setup-${pkg.version}-x64.exe`);
const destination = path.join(root, 'release', `PaletteIQ-Personal-Setup-${pkg.version}-x64.exe`);
if (existsSync(destination)) throw new Error('Personal installer already exists. Move or rename it before rebuilding: ' + destination);
const result = spawnSync('npm.cmd', ['run', 'desktop:package:win'], {
  cwd: root,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, PALETTEIQ_LICENSE_MODE: 'disabled' },
});
if (result.error || result.status !== 0) {
  throw new Error('Personal installer build failed: ' + (result.error?.message || result.status));
}
if (!existsSync(source)) throw new Error('Installer was not created: ' + source);
renameSync(source, destination);
if (existsSync(source + '.blockmap')) renameSync(source + '.blockmap', destination + '.blockmap');
console.log('Personal installer (no activation required): ' + destination);
