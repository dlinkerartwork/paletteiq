import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/full-automation/route.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../app/chatgpt-auth.ts', import.meta.url), 'utf8');
const scope = readFileSync(new URL('../lib/cloud-automation-context.ts', import.meta.url), 'utf8');
const cron = readFileSync(new URL('../worker/cloud-automation-cron.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../wrangler.cloud-automation-cron.jsonc', import.meta.url), 'utf8');

test('cloud automation is a signed, fixed-action endpoint without client-selected owner or project', () => {
  assert.match(route, /verifiedCloudTick\(req\)/);
  assert.match(route, /crypto\.subtle\.verify\('HMAC'/);
  assert.match(route, /payload\.action !== 'cloud-tick'/);
  assert.match(route, /Math\.abs\(Date\.now\(\) - Number\(time\)\) > 90_000/);
  assert.match(route, /const parsed = \/\^user_/);
  assert.match(route, /eq\(paletteStores\.accountId, accountId\)/);
  assert.match(route, /runWithCloudAutomationUser/);
});

test('cron does not transmit OpenAI credentials or session cookies', () => {
  assert.match(cron, /PALETTEIQ_CLOUD_AUTOMATION_SECRET/);
  assert.match(cron, /crypto\.subtle\.sign\('HMAC'/);
  assert.match(cron, /'x-paletteiq-cloud-signature'/);
  assert.doesNotMatch(cron, /OPENAI_API_KEY|paletteiq_session|Authorization:/);
  assert.match(config, /"crons": \["\* \* \* \* \*"\]/);
});

test('scheduled identity is isolated in async context and cloud mode requires hosted storage', () => {
  assert.match(scope, /new AsyncLocalStorage<ChatGPTUser>\(\)/);
  assert.match(auth, /const scheduledUser = cloudAutomationUser\(\)/);
  assert.match(route, /if \(!env\.DB \|\| !env\.BUCKET\)/);
  assert.match(route, /json_extract/);
});
