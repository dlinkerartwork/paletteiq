import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  WORKSPACE_TAB_IDS, workspaceHash, isWorkspaceRoute, isStudioTabEnabled, workspaceShortcut, STUDIO_DISABLED_TABS, routeEquals,
  readWorkspaceHistoryState, routeFromWorkspaceHash,
} from '../lib/workspace-history.ts';
import {
  removeClipartQuantity, clampEtsyTitle, ETSY_TITLE_MAX, ETSY_TITLE_IDEAL_MIN, isNearEtsyTitleLimit,
} from '../lib/seo-title-policy.ts';
import { normalizeListing, adaptReferenceSeoToCollection, applySeoLimits } from '../lib/etsy-listing.ts';
import { auditSeo } from '../lib/seo-intelligence.ts';

test('workspace routes encode tab and collection identity and survive roundtrip', () => {
  assert.ok(!WORKSPACE_TAB_IDS.includes('listing-images'));
  assert.ok(!WORKSPACE_TAB_IDS.includes('thumbnails'));
  assert.deepEqual([...STUDIO_DISABLED_TABS], ['thumbnails','listing-images']);
  assert.equal(isStudioTabEnabled('listing-images'), false);
  assert.equal(isStudioTabEnabled('thumbnails'), false);
  assert.equal(isStudioTabEnabled('listing'), true);
  assert.equal(routeFromWorkspaceHash('#paletteiq/thumbnails/some-collection'), null);
  assert.equal(routeFromWorkspaceHash('#paletteiq/listing-images/some-collection'), null);
  const a = { tab: 'listing', projectId: '3c89f5b8-7380-4184-9144-b3c19601ab2c' };
  const b = { tab: 'prompts', projectId: 'other-collection' };
  assert.deepEqual(routeFromWorkspaceHash(workspaceHash(a)), a);
  assert.ok(routeEquals(a, a));
  assert.equal(routeEquals(a, b), false);
  assert.equal(isWorkspaceRoute({ tab:'untrusted',projectId:a.projectId }), false);
  assert.equal(routeFromWorkspaceHash('#paletteiq/not-valid/abc'), null);
  assert.deepEqual(readWorkspaceHistoryState({
    paletteiqWorkspace: { ...a, index:3, session:'active-window' },
  }, 'active-window'), { ...a, index:3, session:'active-window' });
  assert.equal(readWorkspaceHistoryState({
    paletteiqWorkspace: { ...a, index:3, session:'other-tab' },
  }, 'active-window'), null);
});

test('UI navigation uses native browser history and guards unsaved reload', () => {
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/window\.history\.pushState/);
  assert.match(page,/window\.history\.replaceState/);
  assert.match(page,/window\.history\.back\(\)/);
  assert.match(page,/window\.history\.forward\(\)/);
  assert.match(page,/window\.location\.reload\(\)/);
  assert.match(page,/window\.addEventListener\('popstate'/);
  assert.match(page,/window\.addEventListener\('beforeunload'/);
  assert.match(page,/projectSnapshots\.current/);
  assert.match(page,/thumbnailSaveControlsRef\.current\?\.hasUnsaved/);
  for(const text of ['Go back','Go forward','Refresh page']) assert.match(page,new RegExp('aria-label="'+text+'"'));
});

test('SEO titles allow up to 140 characters without any word-count restriction', () => {
  assert.equal(ETSY_TITLE_MAX,140);
  assert.equal(ETSY_TITLE_IDEAL_MIN,125);
  const sample='Baby farm animal watercolor clipart, strawberry birthday animals, soft pastel nursery artwork, printable digital graphics, invitation decorations';
  assert.ok(sample.length > 140);
  const limited=clampEtsyTitle(sample);
  assert.ok(limited.length <= 140 && limited.length >= 125);
  assert.equal(isNearEtsyTitleLimit(limited),true);
  const draft=normalizeListing({title:limited});
  const seo=auditSeo(draft);
  assert.ok(seo.checks.some(c=>c.id==='title-target' && c.passed));
  assert.equal(seo.checks.some(c=>c.id==='title-clarity'),false);
  assert.equal(seo.checks.some(c=>/word(s)? (or fewer|count)/i.test(c.label)),false);
});

test('SEO strips only artwork quantities from title, preserves 3D/year and description count', () => {
  assert.equal(removeClipartQuantity('120 Clipart Cute Farm Animals'), 'Clipart Cute Farm Animals');
  assert.equal(removeClipartQuantity('125+ PNG Elements Pastel Watercolor'), 'PNG Elements Pastel Watercolor');
  assert.equal(removeClipartQuantity('Clipart Bundle of 120'), 'Clipart Bundle');
  assert.equal(removeClipartQuantity('50 Watercolor Baby Farm Animals Clipart'), 'Watercolor Baby Farm Animals Clipart');
  assert.equal(removeClipartQuantity('3D Kawaii Clipart 2026'), '3D Kawaii Clipart 2026');
  assert.equal(removeClipartQuantity('2026 Holiday 3D Clipart'), '2026 Holiday 3D Clipart');
  const result=adaptReferenceSeoToCollection('120 Cute Farm Animals Clipart', 'Includes 120 clipart files.', 85);
  assert.equal(result.title.includes('120'), false);
  assert.equal(result.title.includes('85'), false);
  assert.ok(result.description.includes('85'));
  const normalized=normalizeListing({title:'120 Baby Animal Clipart Bundle'});
  assert.equal(normalized.title,'Baby Animal Clipart Bundle');
  const limited=applySeoLimits(normalized,60,1);
  assert.equal(limited.title,'Baby Animal Clipart Bundle');
});

test('AI SEO instructions target 140 chars and exclude clipart counts, including review alternatives', () => {
  const route=readFileSync(new URL('../app/api/studio/route.ts',import.meta.url),'utf8');
  const settings=readFileSync(new URL('../components/studio-settings.tsx',import.meta.url),'utf8');
  assert.match(route,/NEVER include the number of clipart characters/);
  assert.match(route,/NO word-count rule/);
  assert.match(route,/clampEtsyTitle\(adjusted\.title\)/);
  assert.match(route,/titleAlternatives = result\.titleAlternatives\.map\(title => clampEtsyTitle\(title\)\)/);
  assert.match(settings,/Max 140 characters · target 125–140/);
  assert.doesNotMatch(settings,/TITLE MAX CHARACTERS \(1–140\)/);
});

test('workspace browser keyboard shortcuts are recognized only with exact modifiers', () => {
  const key = (input) => ({ key: 'x', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...input });
  assert.equal(workspaceShortcut(key({ key: 'ArrowLeft', altKey: true })), 'back');
  assert.equal(workspaceShortcut(key({ key: 'ArrowRight', altKey: true })), 'forward');
  assert.equal(workspaceShortcut(key({ key: 'r', ctrlKey: true })), 'refresh');
  assert.equal(workspaceShortcut(key({ key: 'R', metaKey: true })), 'refresh');
  assert.equal(workspaceShortcut(key({ key: 'F5' })), 'refresh');
  assert.equal(workspaceShortcut(key({ key: 'ArrowLeft' })), null);
  assert.equal(workspaceShortcut(key({ key: 'ArrowRight', altKey: true, ctrlKey: true })), null);
  assert.equal(workspaceShortcut(key({ key: 'ArrowLeft', altKey: true, shiftKey: true })), null);
  assert.equal(workspaceShortcut(key({ key: 'r' })), null);
  assert.equal(workspaceShortcut(key({ key: 'r', ctrlKey: true, shiftKey: true })), null);
  assert.equal(workspaceShortcut(key({ key: 'r', ctrlKey: true, metaKey: true })), null);
});
test('history buttons provide hover tooltips and keyboard shortcuts while inactive tabs remain gated', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(page, /aria-keyshortcuts="Alt\+ArrowLeft"/);
  assert.match(page, /aria-keyshortcuts="Alt\+ArrowRight"/);
  assert.match(page, /aria-keyshortcuts="Control\+R Meta\+R F5"/);
  assert.match(page, /workspaceShortcut\(event\)/);
  assert.match(page, /window.addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(page, /event.preventDefault\(\)/);
  assert.match(page, /data-tooltip="Go Back · Alt \+ ←"/);
  assert.match(page, /data-tooltip="Go Forward · Alt \+ →"/);
  assert.match(page, /data-tooltip="Refresh · Ctrl\/⌘ \+ R or F5"/);
  assert.match(css, /\.workspace-history-tip:hover::after/);
  assert.match(css, /\.workspace-history-tip:focus-within::after/);
  assert.match(page, /if \(!isStudioTabEnabled\(next\)\)/);
  assert.match(page, /isStudioTabEnabled\('thumbnails'\) && tab === 'thumbnails'/);
  assert.match(page, /isStudioTabEnabled\('listing-images'\) && tab === 'listing-images'/);
  assert.match(page, /window.history.replaceState\(\{ \.\.\.event.state, paletteiqWorkspace: repaired \}/);
});
