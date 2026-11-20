import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchResearchImageDataUrls } from '../lib/research-image-input.ts';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const url = index => 'https://i.etsystatic.com/1234/photo-' + index + '.jpg';

test('four selected Etsy references download with up to three simultaneous safe fetches', async () => {
  let active = 0, peak = 0, started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2);
  const urls = [url(1), url(2), url(3), url(4)];
  const task = fetchResearchImageDataUrls(urls, async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    active++;
    started++;
    peak = Math.max(peak, active);
    await gate;
    active--;
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal(started, 3, 'the first three requests must start immediately, not sequentially');
  release();
  const images = await task;
  assert.equal(peak, 3);
  assert.equal(started, 4);
  assert.equal(images.length, urls.length);
  assert.ok(images.every(image => image.startsWith('data:image/jpeg;base64,')));
});

test('Auto Follow checkbox belongs to Research and manual completion never submits paid jobs', () => {
  assert.match(page, /className="research-auto-follow"/);
  assert.match(page, /Auto Follow — switch tabs when the current stage finishes/);
  assert.match(page, /editor\.tab === 'analysis'/);
  assert.match(page, /editor\.tab === 'prompts'/);
  assert.match(page, /setTab\('characters'\)/);
  assert.match(page, /setTab\('production'\)/);
  assert.match(page, /paletteiq-auto-follow-automation/);
  assert.match(page, /!result\.project\.fullAutomation\?\.enabled/);
});

test('reference thumbnail opens a modal and checkbox controls selection independently', () => {
  assert.match(page, /aria-label=\{\`Preview reference image/);
  assert.match(page, /className="reference-preview-overlay"/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /aria-label=\{\`Select reference image/);
  assert.match(page, /className="reference-select-toggle"/);
  assert.match(page, /Selected for analysis/);
  assert.match(page, /event\.key === 'Escape'/);
  assert.match(css, /\.reference-preview-dialog/);
  assert.match(css, /\.reference-preview-overlay/);
});

test('parallel worker status is shown individually and the UI refreshes within six seconds', () => {
  assert.match(page, /workerPreviews\.map\(w=>/);
  assert.match(page, /Reference group \{w\.index\+1\}/);
  assert.match(page, /pollResearch\(\), 6000/);
});
