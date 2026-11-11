import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const state={};globalThis.__thumbnailExportTest=state;
const mocks={
 'cloudflare:workers': 'export const env={};',
 'drizzle-orm': 'export const and=(...x)=>x; export const eq=(...x)=>x;',
 '@/app/chatgpt-auth': "export const getChatGPTUser=async()=>({userId:'owner'});",
 '@/db': 'export const getDb=()=>globalThis.__thumbnailExportTest.db;',
 '@/db/schema': "export const projects='projects',studioSettings='settings';",
 '@/lib/native-bridge': 'export const nativeAssetBucket=()=>globalThis.__thumbnailExportTest.bucket;',
};
registerHooks({resolve(specifier,context,next){
 if(specifier in mocks)return {url:'data:text/javascript,'+encodeURIComponent(mocks[specifier]),shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};
 return next(specifier,context);
}});
const {POST}=await import('../app/api/exports/route.ts');
function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};
 const end=bytes.length-22;let offset=view.getUint32(end+16,true);
 for(let i=0;i<view.getUint16(end+10,true);i++){
  assert.equal(view.getUint32(offset,true),0x02014b50);
  const len=view.getUint16(offset+28,true),size=view.getUint32(offset+24,true),local=view.getUint32(offset+42,true);
  const name=new TextDecoder().decode(bytes.slice(offset+46,offset+46+len));
  const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
  files[name]=bytes.slice(start,start+size);
  offset+=46+len+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
 }
 return files;
}
const original='11111111-1111-4111-8111-111111111111',scaled='22222222-2222-4222-8222-222222222222';
const ref=id=>`/api/thumbnail-background?projectId=project&assetId=${id}&format=jpg`;
function setup(upscaled=true){
 const project={name:'Test',listing:{title:'Original clipart collection'},characters:[{id:'character',name:'Fox',imageUrl:`/api/images/${original}?format=png`}],thumbnails:[{id:'thumb',name:'Cover',width:1024,height:1024,aiImageUrl:ref(original),upscaledImageUrl:upscaled?ref(scaled):undefined}]};
 const objects=new Map([[`generated/owner/${original}.png`,new Uint8Array([1,2,3])],[`generated/owner/${original}.jpg`,new Uint8Array([255,216,1])],[`generated/owner/${scaled}.jpg`,new Uint8Array([255,216,6,8,255,217])]]);
 state.db={select:()=>({from:table=>({where:()=>({limit:async()=>table==='settings'?[]:[{data:JSON.stringify(project)}]})})})};
 state.bucket={head:async key=>objects.has(key)?{}:null,get:async key=>objects.has(key)?{body:new Response(objects.get(key)).body}:null};
 return objects;
}
test('listing package and image ZIP include exact upscale JPG bytes, not original thumbnail',async()=>{
 for(const scope of ['package','all']){
  setup();const res=await POST(new Request('https://app.test/api/exports',{method:'POST',body:JSON.stringify({projectId:'project',scope})}));
  assert.equal(res.status,200);
  const files=unzip(new Uint8Array(await res.arrayBuffer()));
  assert.deepEqual([...files['thumbnails/001-cover.jpg']],[255,216,6,8,255,217]);
  if(scope==='package')assert.ok(files['etsy-listing-draft.txt']);
 }
});
test('uses original thumbnail only when no upscale exists',async()=>{
 setup(false);const res=await POST(new Request('https://app.test/api/exports',{method:'POST',body:JSON.stringify({projectId:'project',scope:'package'})}));
 assert.equal(res.status,200);assert.deepEqual([...unzip(new Uint8Array(await res.arrayBuffer()))['thumbnails/001-cover.jpg']],[255,216,1]);
});
test('missing upscale blocks export instead of silently using original',async()=>{
 const objects=setup();objects.delete(`generated/owner/${scaled}.jpg`);
 const res=await POST(new Request('https://app.test/api/exports',{method:'POST',body:JSON.stringify({projectId:'project',scope:'package'})}));
 assert.equal(res.status,409);
});
