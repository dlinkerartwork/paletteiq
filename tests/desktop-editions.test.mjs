import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(file, 'utf8');

test('licensed installer remains the default and no-license uses a dedicated build config', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const normal = read('electron-builder.yml');
  const alternate = read('electron-builder.no-license.yml');
  const main = read('desktop/main.cjs');
  assert.match(scripts['desktop:package:win'], /prepare-desktop-bundle\.mjs(?! --no-license)/);
  assert.match(scripts['desktop:package:win:no-license'], /prepare-desktop-bundle\.mjs --no-license/);
  assert.match(scripts['desktop:package:win:no-license'], /--config electron-builder\.no-license\.yml/);
  assert.match(alternate, /extends: \.\/electron-builder\.yml/);
  assert.match(alternate, /paletteiqEdition: unlicensed/);
  assert.match(alternate, /PaletteIQ-NoLicense-Setup-/);
  assert.match(normal, /appId: com\.dlinkerartwork\.paletteiq/);
  assert.match(main, /metadata\.paletteiqEdition === 'unlicensed'/);
  assert.match(main, /if \(!app\.isPackaged \|\| isUnlicensedEdition\(\)\) return/);
  assert.match(main, /readValidLicense\(/);
  assert.doesNotMatch(main, /process\.env\.[A-Z_]*LICENSE.*return/);
});

test('no-license staging does not require issuer keys while licensed packaging does', () => {
  const stage = read('scripts/prepare-desktop-bundle.mjs');
  const verify = read('scripts/verify-desktop-package.cjs');
  assert.match(stage, /process\.argv\.includes\('--no-license'\)/);
  assert.match(stage, /if \(!unlicensedEdition && !existsSync\(publicKey\)\)/);
  assert.match(stage, /if \(!unlicensedEdition\) copyFileSync\(publicKey/);
  assert.match(verify, /edition !== 'unlicensed'/);
  assert.match(verify, /required\.push\('license-public\.pem'\)/);
});
