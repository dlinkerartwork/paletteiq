import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { workspaceShortcut } from '../lib/workspace-history.ts';

const file = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const keyboard = (key, flags = {}) => ({
  key, altKey:false, ctrlKey:false, metaKey:false, shiftKey:false, ...flags,
});

test('synthetic keydowns without KeyboardEvent.key never crash when switching Settings tabs', () => {
  for (const raw of [null, undefined, {}, keyboard(undefined), keyboard(null), keyboard(3)]) {
    assert.doesNotThrow(() => workspaceShortcut(raw));
    assert.equal(workspaceShortcut(raw), null);
  }
  assert.equal(workspaceShortcut(keyboard('F5')), 'refresh');
  assert.equal(workspaceShortcut(keyboard('r',{ctrlKey:true})), 'refresh');
  assert.equal(workspaceShortcut(keyboard('R',{metaKey:true})), 'refresh');
  assert.equal(workspaceShortcut(keyboard('ArrowLeft',{altKey:true})), 'back');
  assert.equal(workspaceShortcut(keyboard('ArrowRight',{altKey:true})), 'forward');
  assert.equal(workspaceShortcut(keyboard('r')), null);
  assert.equal(workspaceShortcut(keyboard('r',{ctrlKey:true,metaKey:true})), null);
});

test('each authenticated Etsy store has its own preferences and encrypted API credentials', () => {
  const route = file('app/api/settings/route.ts');
  const auth = file('app/chatgpt-auth.ts');
  const sessions = file('lib/palette-accounts.ts');
  const credentials = file('lib/credentials.ts');
  const bridge = file('components/account-workspace.tsx');
  const page = file('app/page.tsx');
  const ui = file('components/studio-settings.tsx');
  assert.match(sessions,/owner: scopeForStore\(users\[0\]\.id, stores\[0\]\.id\)/);
  assert.match(auth,/userId: account.owner/);
  assert.match(route,/eq\(studioSettings\.owner, user\.userId\)/);
  assert.match(route,/owner: user\.userId/);
  assert.match(route,/Cache-Control', 'private, no-store'/);
  assert.match(credentials,/additionalData: new TextEncoder\(\)\.encode\(owner\)/);
  assert.match(bridge,/export function useActiveStoreId\(\)/);
  assert.match(page,/const activeStoreId = useActiveStoreId\(\)/);
  assert.match(page,/<StudioSettings key={activeStoreId} storeId={activeStoreId}/);
  assert.match(page,/fetch\('\/api\/settings', \{ cache: 'no-store' \}\)/);
  assert.match(page,/\[activeStoreId, updatePreferences\]/);
  assert.match(ui,/paletteiq-settings-pane-' \+ storeId/);
  assert.match(ui,/fetch\('\/api\/settings', \{ cache: 'no-store' \}\)/);
  assert.match(ui,/setCredentials\(\{ etsy: false, openai: false, gemini: false, upscale: false \}\)/);
});
