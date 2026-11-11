import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const state = {};
globalThis.__upscaleTest = state;
const mocks = {
  'cloudflare:workers': `export const env = { PALETTEIQ_UPSCALE_SERVER_URL: 'https://gpu.example.test', PALETTEIQ_UPSCALE_SERVER_KEY: 'x'.repeat(40) };`,
  'drizzle-orm': `export const and = (...args) => args; export const eq = (...args) => args;`,
  '@/app/chatgpt-auth': `export const getChatGPTUser = async () => ({ userId: 'owner' });`,
  '@/db': `export const getDb = () => globalThis.__upscaleTest.db;`,
  '@/db/schema': `export const projects = 'projects'; export const studioSettings = 'settings';`,
  '@/lib/native-bridge': `export const nativeAssetBucket = () => globalThis.__upscaleTest.bucket;`,
  '@/lib/credentials': `export const decryptCredential = async value => value;`,
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier in mocks) return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
  if (specifier.startsWith('@/')) return { url: pathToFileURL(resolve(specifier.slice(2) + '.ts')).href, shortCircuit: true };
  return next(specifier, context);
} });
const imageApi = await import('../app/api/upscale/route.ts');
const thumbnailApi = await import('../app/api/thumbnail-upscale/route.ts');
const png = (w, h) => { const b = new Uint8Array(34); b.set([137,80,78,71,13,10,26,10]); const view = new DataView(b.buffer); view.setUint32(16,w); view.setUint32(20,h); b[25]=6; return b; };
const jpeg = (w, h) => Uint8Array.from([255,216,255,192,0,11,8,h>>8,h&255,w>>8,w&255,1,1,17,0,255,217]);
const post = (api, body) => api.POST(new Request('https://app.test/api/upscale', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }));
const ref = id => `/api/images/${id}?format=png`;
const tempRef = id => `/api/thumbnail-background?projectId=project&assetId=${id}&format=png`;
const original = '11111111-1111-4111-8111-111111111111';
const temp = '22222222-2222-4222-8222-222222222222';

function setup() {
  state.project = { characters: [{id:'character',imageUrl:ref(original)}], thumbnails:[{id:'thumbnail'}] };
  state.objects = new Map([[`generated/owner/${original}.png`, png(10,12)], [`generated/owner/${temp}.png`,png(10,12)]]);
  state.requests = []; state.results = new Map();
  const settings = { preferences: JSON.stringify({upscaleFactor:4}), upscaleCredential:null };
  state.db = {
    select() { return { from(table) { return { where() { return { limit:async () => table === 'settings' ? [settings] : [{id:'project', data:JSON.stringify(state.project)}] }; } }; } }; },
    update() { return { set(value) { return { where:async () => {state.project=JSON.parse(value.data);} }; } }; },
  };
  state.bucket = {
    get: async key => {const bytes=state.objects.get(key); return bytes ? {arrayBuffer:async () => bytes.buffer} : null;},
    put: async (key,bytes) => {state.objects.set(key, bytes);},
  };
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/v1/jobs')) {
      const file = new Uint8Array(await init.body.get('file').arrayBuffer());
      const view = new DataView(file.buffer); const factor=Number(init.body.get('scale'));
      const id=(state.requests.length+1).toString(16).padStart(32,'0');
      const w=view.getUint32(16),h=view.getUint32(20);
      state.requests.push({w,h,factor});
      state.results.set(id,{png:png(w*factor,h*factor),jpg:jpeg(w*factor,h*factor)});
      return Response.json({id});
    }
    const id=new URL(url).pathname.split('/')[3];
    if (url.includes('/result')) return new Response(state.results.get(id)[url.includes('format=jpg')?'jpg':'png']);
    return Response.json({status:'completed'});
  };
}

test('image upscale uses the latest result as the next source and rejects stale completion', async () => {
  setup();
  assert.equal((await post(imageApi,{projectId:'project',characterId:'character',factor:6})).status,200);
  assert.equal(state.project.characters[0].upscaleJob.factor,6);
  assert.equal((await imageApi.GET(new Request('https://app.test/api/upscale?projectId=project&characterId=character'))).status,200);
  const prior=state.project.characters[0].upscaledImageUrl;
  assert.equal((await post(imageApi,{projectId:'project',characterId:'character',factor:8})).status,200);
  assert.equal(state.project.characters[0].upscaleJob.sourceUrl,prior);
  assert.deepEqual(state.requests,[{w:10,h:12,factor:6},{w:60,h:72,factor:8}]);
  const response=await imageApi.GET(new Request('https://app.test/api/upscale?projectId=project&characterId=character'));
  assert.equal(response.status,200); assert.equal((await response.json()).width,480);
  assert.equal((await post(imageApi,{projectId:'project',characterId:'character',factor:2})).status,200);
  state.project.characters[0].upscaledImageUrl = ref(original);
  assert.equal((await imageApi.GET(new Request('https://app.test/api/upscale?projectId=project&characterId=character'))).status,409);
});

test('thumbnail result is stored as JPEG and a completed thumbnail can be upscaled again', async () => {
  setup();
  const body={projectId:'project',thumbnailId:'thumbnail',sourceUrl:tempRef(temp),factor:6};
  assert.equal((await post(thumbnailApi,body)).status,200);
  let response=await thumbnailApi.GET(new Request('https://app.test/api/thumbnail-upscale?projectId=project&thumbnailId=thumbnail'));
  assert.equal(response.status,200);
  const prior=state.project.thumbnails[0].upscaledImageUrl;
  assert.match(prior,/format=jpg$/);
  const key=`generated/owner/${new URL(prior,'https://app.test').searchParams.get('assetId')}.jpg`;
  assert.deepEqual([...state.objects.get(key).slice(0,2)],[255,216]);
  state.objects.set(`generated/owner/${temp}.png`,png(60,72)); // Browser canvas preserves latest natural dimensions.
  assert.equal((await post(thumbnailApi,{...body,factor:8,previousUpscaledUrl:prior})).status,200);
  response=await thumbnailApi.GET(new Request('https://app.test/api/thumbnail-upscale?projectId=project&thumbnailId=thumbnail'));
  assert.equal(response.status,200); assert.equal((await response.json()).width,480);
  assert.deepEqual(state.requests,[{w:10,h:12,factor:6},{w:60,h:72,factor:8}]);
  assert.equal((await post(thumbnailApi,{...body,previousUpscaledUrl:prior})).status,409);
});

test('unsupported scale is rejected before sending a GPU request', async () => {
  setup();
  assert.equal((await post(imageApi,{projectId:'project',characterId:'character',factor:5})).status,400);
  assert.equal((await post(thumbnailApi,{projectId:'project',thumbnailId:'thumbnail',sourceUrl:tempRef(temp),factor:5})).status,400);
  assert.equal(state.requests.length,0);
});
