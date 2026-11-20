import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('Full Automation and Prompt Batch share one non-paid connection warning',()=>{
  assert.match(page,/const \[backendConnectionWarning, setBackendConnectionWarning\] = useState\(''\)/);
  assert.match(page,/const networkPollFailures = useRef\(new Map/);
  assert.match(page,/noteBackendPollError\('prompts',error\)/);
  assert.match(page,/noteBackendPollError\('automation',error\)/);
  assert.match(page,/noteBackendPollHealthy\('prompts'\)/);
  assert.match(page,/noteBackendPollHealthy\('automation'\)/);
  assert.match(page,/Saved automation and OpenAI Batch IDs are preserved/);
});
test('transient network error backs off only status checks, never creates paid retry',()=>{
  assert.match(page,/Math\.min\(60000,5000\*Math\.pow\(2,Math\.min\(count-1,4\)\)\)/);
  assert.match(page,/if \(closed \|\| polling \|\| !canPollBackend\('prompts'\)\) return/);
  assert.match(page,/if \(stopped \|\| running \|\| !canPollBackend\('automation'\)\) return/);
  assert.match(page,/!\/failed to fetch\|networkerror\|network request failed\|load failed\/i\.test\(message\)/);
  assert.match(page,/Check connection<\/button>/);
  assert.match(page,/fetch\('\/api\/studio',\{cache:'no-store'\}\)/);
  assert.doesNotMatch(page,/noteBackendPollError\([^)]*\)[\s\S]{0,300}action:'start'/);
});
