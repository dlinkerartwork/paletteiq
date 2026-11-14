import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const editor=readFileSync(new URL('../components/etsy-listing-layout-canvas.tsx',import.meta.url),'utf8');
const backend=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const settings=readFileSync(new URL('../components/studio-settings.tsx',import.meta.url),'utf8');

test('source collection art dominates thumbnail: prompt uses scaled compact artistic lettering by default',()=>{
  assert.match(backend,/textScale: 'compact' \| 'balanced' \| 'statement' = 'compact'/);
  assert.match(backend,/TYPOGRAPHY SCALE — COMPACT \(default\)/);
  assert.match(backend,/title block HEIGHT no more than about 22% of canvas/);
  assert.match(backend,/supporting subtitle about 5–7%/);
  assert.match(backend,/all text combined ideally below 33%/);
  assert.match(backend,/Keep title readable but NOT giant/);
  assert.match(backend,/Do not make every line equally large/);
  assert.match(backend,/Optional badge must remain modest/);
  assert.match(backend,/user-selected genuine clipart layers/);
  assert.match(backend,/No generated imitation clipart or substitute objects/);
  assert.match(backend,/if \(input\.textScale !== undefined && !\['compact','balanced','statement'\]\.includes\(input\.textScale\)\)/);
  assert.match(ui,/<option value="compact">Compact — smaller title, more artwork \(recommended\)<\/option>/);
  assert.match(ui,/const \[textScale, setTextScale\] = useState<'compact' \| 'balanced' \| 'statement'>\('compact'\)/);
  assert.match(ui,/placements: effectivePositions, textScale/);
});

test('Studio image model and quality default to SAVED Settings, not static hardcoded choices',()=>{
  assert.match(settings,/model: 'gpt-image-1-mini', quality: 'low'/);
  assert.match(page,/defaultImageModel=\{preferences\.model\} defaultImageQuality=\{preferences\.quality\}/);
  assert.match(ui,/defaultImageModel\?: string/);
  assert.match(ui,/defaultImageQuality\?: string/);
  assert.match(ui,/useState\(\(\) =>\s*\/\^gpt-image-/);
  assert.match(ui,/defaultImageQuality === 'medium' \|\| defaultImageQuality === 'high'/);
  assert.match(ui,/setModel\(defaultImageModel\)/);
  assert.match(ui,/setQuality\(defaultImageQuality as 'low' \| 'medium' \| 'high'\)/);
  assert.match(ui,/onChange=\{e => setModel\(e\.target\.value\)\}/);
  assert.match(ui,/onChange=\{e => setQuality\(e\.target\.value as typeof quality\)\}/);
});

test('Advanced AI settings are always visible, including model quality and lettering size',()=>{
  assert.match(ui,/<section data-listing-advanced-settings="always-visible"/);
  assert.match(ui,/<strong style=\{\{ fontSize: 13 \}\}>Advanced AI settings \(optional\)<\/strong>/);
  assert.match(ui,/OPENAI ARTISTIC BACKGROUND MODEL/);
  assert.match(ui,/BACKGROUND QUALITY/);
  assert.match(ui,/ARTISTIC LETTERING SIZE/);
  assert.match(ui,/onChange=\{e => setTextScale\(e\.target\.value as typeof textScale\)\}/);
  assert.doesNotMatch(ui,/<summary[^>]*>Advanced AI settings \(optional\)<\/summary>/);
});

test('user can rotate original artwork directly on canvas, not only via numeric control',()=>{
  assert.match(editor,/mode: 'move' \| 'resize' \| 'rotate'/);
  assert.match(editor,/const normalizeAngle = \(angle: number\)/);
  assert.match(editor,/const centerX=rect\.left\+/);
  assert.match(editor,/startAngle=Math\.atan2/);
  assert.match(editor,/d\.mode==='rotate'/);
  assert.match(editor,/rotation:Math\.round\(normalizeAngle/);
  assert.match(editor,/aria-label=\{'Rotate '\+source\.name\}/);
  assert.match(editor,/onPointerDown=\{e=>begin\(e,i,'rotate'\)\}/);
  assert.match(editor,/transform:'rotate\('\+\(p\.rotation\|\|0\)\+'deg\)'/);
  assert.match(ui,/min=\{-180\} max=\{180\}/);
  assert.match(ui,/field === 'rotation' \? -180/);
  assert.match(ui,/const file = await compose\(background, layout, assets\)/);
  assert.match(ui,/ctx\.rotate\(\(p\.rotation \|\| 0\) \* Math\.PI \/ 180\)/);
});

test('backend accepts and persists full manual original-clipart rotation with safe bounds',()=>{
  assert.match(backend,/Math\.abs\(p\.rotation \?\? 0\) <= 180/);
  assert.match(backend,/Math\.abs\(p\.rotation \?\? 0\) > 180/);
  assert.match(backend,/Math\.abs\(p\.rotation\?\?0\)<=180/);
  assert.match(backend,/new Set\(placements\.map\(p => p\.assetId\)\)\.size !== placements\.length/);
  assert.match(backend,/originalAssets\(project\.characters \|\| \[\]\)/);
  assert.match(backend,/input\.textScale \?\? 'compact'/);
});
