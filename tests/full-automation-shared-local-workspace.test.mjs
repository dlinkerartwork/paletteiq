import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const discover=read('app/api/local-workspace/route.ts');
const gate=read('components/shared-local-workspace-gate.tsx');
const layout=read('app/layout.tsx');
const desktop=read('desktop/main.cjs');
const monitor=read('desktop/background-batch-monitor.cjs');
const flow=read('app/api/full-automation/route.ts');
const page=read('app/page.tsx');

test('shared workspace discovery is limited to the actual local Desktop runtime',()=>{
  assert.match(discover,/PALETTEIQ_DESKTOP/);
  assert.match(discover,/DESKTOP_HOST = '127\.0\.0\.1'/);
  assert.match(discover,/DESKTOP_PORT = '18763'/);
  assert.match(discover,/u\.protocol === 'http:' && u\.hostname === DESKTOP_HOST && u\.port === DESKTOP_PORT/);
  assert.match(discover,/\['localhost', '127\.0\.0\.1'\]/);
  assert.match(discover,/desktop \? 200 : 404/);
  assert.match(discover,/Access-Control-Allow-Origin/);
  assert.match(discover,/Access-Control-Allow-Methods', 'GET, OPTIONS'/);
  assert.match(discover,/Access-Control-Allow-Private-Network/);
  assert.doesNotMatch(discover,/export async function POST|secret:|apiKey:|sessionCookie:/);
});

test('Web and Electron select one backend, never open/write the two SQLite databases directly',()=>{
  assert.match(gate,/const SHARED_ORIGIN = 'http:\/\/127\.0\.0\.1:18763'/);
  assert.match(gate,/fetch\(SHARED_ORIGIN\+'\/api\/local-workspace'/);
  assert.match(gate,/data\.service!=='paletteiq-local-workspace'/);
  assert.match(gate,/data\.mode!=='desktop-shared'/);
  assert.match(gate,/data\.shared!==true/);
  assert.match(gate,/window\.location\.replace\(sharedUrl\(\)\)/);
  assert.match(gate,/window\.location\.assign\(sharedUrl\(\)\)/);
  assert.match(layout,/<SharedLocalWorkspaceGate><AccountWorkspaceGate>/);
  assert.match(desktop,/const SERVER_PORT = 18763/);
  assert.match(desktop,/window\.loadURL\(SERVER_URL\)/);
  assert.doesNotMatch(gate,/\.db\b|sqlite|writeFileSync|/);
});

test('Web remembers shared selection and refuses silent fallback when Desktop is offline',()=>{
  assert.match(gate,/const PREFERENCE = 'paletteiq-use-shared-local-workspace'/);
  assert.match(gate,/remember\(true\)/);
  assert.match(gate,/setMode\(wanted\?'missing':'standalone'\)/);
  assert.match(gate,/mode==='missing'&&preferred/);
  assert.match(gate,/setInterval\(retry,15_000\)/);
  assert.match(gate,/window\.addEventListener\('online',retry\)/);
  assert.match(gate,/Open independent Web workspace instead \(not synchronized\)/);
  assert.match(gate,/Existing independent Web data is not moved/);
});

test('Installed Desktop can opt in to Windows start hidden with the existing single backend and monitor',()=>{
  assert.match(desktop,/canStartWithWindows = \(\) => process\.platform === 'win32' && app\.isPackaged/);
  assert.match(desktop,/app\.setLoginItemSettings\(/);
  assert.match(desktop,/WINDOWS_BACKGROUND_START_ARG/);
  assert.match(desktop,/Start PaletteIQ with Windows \(restore jobs in tray\)/);
  assert.match(desktop,/Open Shared Workspace in Web Browser/);
  assert.match(desktop,/const startHidden = process\.argv\.includes\(WINDOWS_BACKGROUND_START_ARG\)/);
  assert.match(desktop,/if \(startHidden && !tray\) window\.show\(\)/);
  assert.match(desktop,/if \(startHidden && tray\) void pollHiddenImageBatches/);
  assert.match(desktop,/const singleInstanceLock = app\.requestSingleInstanceLock\(\)/);
  assert.match(monitor,/if \(polling\) return false/);
  assert.match(monitor,/action: 'tick', syncAll: true/);
});

test('Recovery uses existing durable OpenAI IDs and a lease, not duplicate paid API submissions',()=>{
  assert.match(flow,/async function tick\(req: Request, owner: string, id: string\)/);
  assert.match(flow,/leaseUntil/);
  assert.match(flow,/pendingImageIds\(records\)/);
  assert.match(flow,/openaiBatchId\.startsWith\('pending:'\)/);
  assert.match(monitor,/\/api\/image-batches\?syncAll=1/);
  assert.match(page,/window\.addEventListener\('online',onOnline\)/);
  assert.match(page,/Auto Follow — switch tabs when the current stage finishes/);
});
