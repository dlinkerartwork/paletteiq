import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../scripts/prepare-desktop-bundle.mjs', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const packageFile = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('packaged app starts Wrangler from bundled Node.js instead of PATH', () => {
  assert.match(main, /app\.isPackaged \? path\.join\(ROOT, 'node', 'node\.exe'\)/);
  assert.match(main, /app\.isPackaged \? path\.join\(process\.resourcesPath, 'paletteiq-runtime'\)/);
  assert.match(preparation, /copyFileSync\(sourceNode, path\.join\(stage, 'node', 'node\.exe'\)\)/);
});

test('Windows installer includes local worker, SQLite migrations, and dependencies', () => {
  assert.match(builder, /from: dist\/desktop-runtime/);
  assert.match(builder, /target: nsis/);
  assert.match(preparation, /cpSync\(path\.join\(root, 'drizzle'\)/);
  assert.match(preparation, /Installing isolated Wrangler/);
  assert.match(preparation, /Bundled Wrangler smoke test failed/);
  assert.match(packageFile.scripts['desktop:package:win'], /electron-builder --win nsis/);
});
