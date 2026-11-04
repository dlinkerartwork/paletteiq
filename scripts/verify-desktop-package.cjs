const { existsSync, lstatSync, realpathSync } = require('node:fs');
const path = require('node:path');

// electron-builder calls this after unpacking but before producing NSIS.
// Throwing fails the build instead of delivering a broken installer.
module.exports = async function verifyDesktopPackage(context) {
  if (context.electronPlatformName !== 'win32') return;
  const runtime = path.join(context.appOutDir, 'resources', 'paletteiq-runtime');
  const required = [
    'node/node.exe',
    'dist/server/index.js',
    'dist/server/wrangler.json',
    'node_modules/wrangler/bin/wrangler.js',
  ];
  for (const relative of required) {
    const file = path.join(runtime, relative);
    if (!existsSync(file)) throw new Error(`Desktop packaging failed: required runtime file missing: ${file}`);
    const actual = realpathSync(file);
    const base = realpathSync(runtime) + path.sep;
    if (!actual.toLowerCase().startsWith(base.toLowerCase())) {
      throw new Error(`Desktop packaging failed: runtime file escapes installation directory: ${file} -> ${actual}`);
    }
    if (lstatSync(file).isSymbolicLink()) throw new Error(`Desktop packaging failed: unexpected runtime symlink: ${file}`);
  }
  console.log('Desktop package verified: standalone Node.js and Wrangler are present inside win-unpacked.');
};
