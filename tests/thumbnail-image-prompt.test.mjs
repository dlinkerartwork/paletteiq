import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailImagePrompt } from '../lib/thumbnail-image-prompt.ts';
const collection = { name: 'PRIVATE TITLE', theme: 'Woodland', style: 'Watercolor', characters: [{ name: 'Fox' }] };
const layout = [{ type: 'text', text: 'REFERENCE HEADING', x: 1, y: 2, width: 50, height: 20 }, { type: 'image', x: 10, y: 20, width: 30, height: 30 }];
test('title is included by default for existing clients', () => {
  const prompt = thumbnailImagePrompt(collection, layout, 2000, 2000);
  assert.match(prompt, /PRIVATE TITLE/);
  assert.match(prompt, /REFERENCE HEADING/);
  assert.match(prompt, /never invent DPI, licensing, dimensions/);
  assert.doesNotMatch(prompt, /300 DPI|exact count 1 PNG Clipart/);
});
test('disabled title removes reference lettering and all positive typography instructions', () => {
  const prompt = thumbnailImagePrompt(collection, layout, 2000, 2000, false);
  assert.doesNotMatch(prompt, /PRIVATE TITLE|REFERENCE HEADING|exact count|Preserve a clear central|"type":"text"/);
  assert.match(prompt, /NO TEXT anywhere/);
  assert.match(prompt, /Woodland/);
  assert.match(prompt, /Fox/);
  assert.match(prompt, /"type":"image"/);
});
