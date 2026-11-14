import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LISTING_WIDTH, LISTING_HEIGHT } from '../lib/etsy-listing-image-plan.ts';

const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const listingApi = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');
const thumbnailApi = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');

test('Designer no longer displays or invokes redundant AI Decorative Background', () => {
  assert.doesNotMatch(designer, /AI DECORATIVE BACKGROUND \(OPENAI\)/);
  assert.doesNotMatch(designer, /generateReferenceBackground/);
  assert.doesNotMatch(designer, /backgroundGenerating/);
  assert.match(designer, /BACKGROUND IMAGE \(LOCAL PNG\/JPG\)/);
  assert.match(designer, /Generate AI Background & Typography/);
});

test('all new listing studio graphics and JPG output are exact square 1024', () => {
  assert.equal(LISTING_WIDTH, 1024);
  assert.equal(LISTING_HEIGHT, 1024);
  assert.match(studio, /canvas\.width = LISTING_WIDTH; canvas\.height = LISTING_HEIGHT/);
  assert.match(studio, /1024 × 1024 px • square 1:1/);
  assert.match(studio, /aspectRatio: '1 \/ 1'/);
  assert.match(listingApi, /size: '1024x1024'/);
  assert.match(listingApi, /both exact 1:1 square at 1024x1024/);
  assert.doesNotMatch(listingApi, /center-cropping the supplied 3:2 background/);
});

test('model selection is unique and in Reference & Assets for listing studio', () => {
  assert.equal((studio.match(/OPENAI BACKGROUND GENERATION MODEL/g) || []).length, 1);
  assert.doesNotMatch(studio, /OPENAI ARTISTIC BACKGROUND MODEL/);
  assert.match(studio, /value=\{config\.imageModel\}/);
  assert.match(studio, /model: config\.imageModel, quality/);
  assert.match(studio, /VISION PROVIDER/);
  assert.match(studio, /VISION MODEL/);
});

test('reference diversity is preferred to repetitive watercolor corners', () => {
  assert.match(listingApi, /Do not force watercolor corner washes/);
  assert.match(listingApi, /distinct nonfigurative graphic structure/);
  assert.match(thumbnailApi, /Only use such motifs when the reference analysis explicitly supports them/);
  assert.match(thumbnailApi, /Avoid repeating the same four-corner watercolor motif/i);
});
