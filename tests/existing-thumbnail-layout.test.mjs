import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const state = {};
globalThis.__existingLayoutTest = state;
const mocks = {
  'cloudflare:workers': `export const env = { PALETTEIQ_UPSCALE_SERVER_URL: 'https://gpu.example.test', PALETTEIQ_UPSCALE_SERVER_KEY: 'x'.repeat(40) };`,
  'drizzle-orm': `export const and = (...args) => args; export const eq = (...args) => args;`,
  '@/app/chatgpt-auth': `export const getChatGPTUser = async () => ({ userId: 'owner' });`,
  '@/db': `export const getDb = () => globalThis.__existingLayoutTest.db;`,
  '@/db/schema': `export const projects = 'projects'; export const studioSettings = 'settings';`,
  '@/lib/native-bridge': `export const nativeAssetBucket = () => globalThis.__existingLayoutTest.bucket;`,
  '@/lib/credentials': `export const userCredential = async () => 'test-key'; export const userGeminiKeys = async () => ['test-key'];`,
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier in mocks) return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
  if (specifier.startsWith('@/')) return { url: pathToFileURL(resolve(specifier.slice(2) + '.ts')).href, shortCircuit: true };
  return next(specifier, context);
} });

const {POST}=await import('../app/api/thumbnail-layout/route.ts');
const project={ name:'Woodland', characters:[{id:'fox',name:'Fox',imageUrl:'/private/fox.png',upscaledImageUrl:'/private/fox-upscaled.png'},{id:'owl',name:'Owl',imageUrl:'/private/owl.png'}] };
function setup(){
 state.db={select:()=>({from:()=>({where:()=>({limit:async()=>[{data:JSON.stringify(project)}]})})})};
 state.calls=[];
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);state.calls.push({url,body});
  const layout={slots:[{characterId:'owl',x:90,y:90,width:30,height:40},{characterId:'intruder',x:0,y:0,width:20,height:20},{characterId:'owl',x:0,y:0,width:20,height:20}],texts:[{text:'SHOULD BE REMOVED',x:0,y:0,width:20,height:10}]};
  return Response.json(url.includes('openai')?{output:[{content:[{text:JSON.stringify(layout)}]}]}:{candidates:[{content:{parts:[{text:JSON.stringify(layout)}]}}]});
 };
}
const request=body=>POST(new Request('https://app.test/api/thumbnail-layout',{method:'POST',body:JSON.stringify({projectId:'project-123',mode:'existing',...body})}));
test('existing-character layout sends text only to OpenAI and Gemini, filters invalid IDs and respects no text',async()=>{
 for(const provider of ['openai','gemini']){
  setup();const response=await request({provider,model:provider==='openai'?'gpt-4.1-mini':'gemini-2.5-pro',includeTitle:false});
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.layout.slots.length,1);assert.equal(result.layout.slots[0].characterId,'owl');
  assert.ok(result.layout.slots[0].x+result.layout.slots[0].width<=100);assert.ok(result.layout.slots[0].y+result.layout.slots[0].height<=100);
  assert.deepEqual(result.layout.texts,[]);
  assert.equal(state.calls.length,1);
  const serialized=JSON.stringify(state.calls[0].body);
  assert.doesNotMatch(serialized,/input_image|image_url|inline_data|inlineData|\/private\//);
  assert.match(serialized,/Fox/);assert.match(serialized,/Owl/);
 }
});
test('reference analysis still requires a reference image',async()=>{
 setup();const response=await request({mode:'reference'});assert.equal(response.status,400);assert.equal(state.calls.length,0);
});
