import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const settings=load('components/studio-settings.tsx');
const route=load('app/api/settings/route.ts');
const page=load('app/page.tsx');
const automation=load('app/api/full-automation/route.ts');

test('SEO AI Prompts tab is directly after Production Defaults',()=>{
  const nav=settings.match(/\['credentials','API Credentials'\][\s\S]*?\['backup','Backup & Restore'\]/)?.[0];
  assert.ok(nav,'settings tab list found');
  assert.match(nav,/\['production','Production Defaults'\],\s*\['seo','SEO AI Prompts'\]/);
  assert.ok(nav.indexOf("['seo','SEO AI Prompts']")<nav.indexOf("['upscale','Remote GPU Upscale']"));
});

test('new SEO defaults select Gemini 3.5 Flash in UI and server',()=>{
  assert.match(settings,/seoProvider: 'gemini', seoGeminiModel: 'gemini-3\.5-flash'/);
  assert.match(route,/seoProvider: 'gemini', seoGeminiModel: 'gemini-3\.5-flash'/);
  assert.match(settings,/preferences\.seoProvider \?\? 'gemini'/);
  assert.match(settings,/preferences\.seoGeminiModel \?\? 'gemini-3\.5-flash'/);
  assert.match(page,/seoProvider=\{preferences\.seoProvider \?\? 'gemini'\}/);
  assert.match(page,/seoGeminiModel=\{preferences\.seoGeminiModel \?\? 'gemini-3\.5-flash'\}/);
  assert.match(page,/geminiModel: preferences\.seoGeminiModel \?\? 'gemini-3\.5-flash'/);
});

test('saved SEO provider/model override the new defaults; automation does not force OpenAI',()=>{
  assert.match(route,/\.\.\.defaultPrefs, \.\.\.\(row \? JSON\.parse\(row\.preferences\) : \{\}\)/);
  assert.match(page,/\.\.\.defaultPrefs, \.\.\.data\.preferences/);
  assert.match(automation,/seoProvider:'gemini'/);
  assert.match(automation,/if\(config\.seoProvider==='openai'\)/);
  assert.match(automation,/seoGeminiModel:config\.seoGeminiModel\|\|'gemini-3\.5-flash'/);
  assert.doesNotMatch(automation,/seoProvider:p\.fullAutomation\?\.textModel\?'openai'/);
});

test('Gemini model dropdown retains saved selection even outside refreshed model list',()=>{
  assert.match(settings,/!geminiModels\.some\(m => m\.id === \(preferences\.seoGeminiModel/);
  assert.match(settings,/saved\/default — check availability/);
  assert.match(settings,/onChange=\{e => edit\('seoGeminiModel', e\.target\.value\)\}/);
});
