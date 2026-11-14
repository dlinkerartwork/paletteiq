import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalAssetStorageKey,sourceZipFilename,selectedSourceManifest} from '../lib/etsy-listing-source-zip.ts';
import {aiFirstConceptPrompt,aiFirstBackgroundPrompt} from '../lib/etsy-listing-ai-first.ts';

const backend=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const frontend=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const id='12345678-1234-1234-1234-123456789012';
const batch='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const owner='current-user';

test('ZIP securely resolves exact owned source PNG/JPG and batch image bytes',()=>{
  const plain={id,name:'Woodland Fox',imageUrl:'/api/images/'+id+'?format=png&v=7'};
  assert.deepEqual(originalAssetStorageKey(plain,owner),{key:'generated/'+owner+'/'+id+'.png',extension:'png'});
  assert.deepEqual(originalAssetStorageKey({...plain,imageUrl:'/api/images/'+id+'?format=jpg&batch='+batch},owner),
    {key:'generated/'+owner+'/batches/'+batch+'/'+id+'.jpg',extension:'jpg'});
  assert.equal(originalAssetStorageKey({...plain,imageUrl:'https://evil.example/api/images/'+id},owner),null);
  assert.equal(originalAssetStorageKey({...plain,imageUrl:'/api/images/'+batch},owner),null);
  assert.equal(originalAssetStorageKey({...plain,imageUrl:'/api/images/'+id+'?batch=../any'},owner),null);
  assert.equal(originalAssetStorageKey({...plain,id:'../original.png'},owner),null);
  const entry=sourceZipFilename(0,{...plain,name:'../../Woodland/Christmas fox*'},'png');
  assert.match(entry,/^clipart\/0001-[-\w]+-12345678\.png$/);
  assert.doesNotMatch(entry,/\.\.|\\|\*/);
});

test('selected-source ZIP manifest keeps exact chosen files and editable prompt',()=>{
  const data=selectedSourceManifest({theme:'Woodland Christmas',title:'Woodland Christmas',
    subtitle:'CLIPART BUNDLE',badge:'80 PNGs',prompt:'PREMIUM Etsy creative design',
    assets:[{assetId:id,name:'Woodland fox',file:'clipart/0001-Fox-12345678.png'}]});
  assert.equal(data.clipart.length,1);
  assert.equal(data.clipart[0].assetId,id);
  assert.equal(data.lettering.title,'Woodland Christmas');
  assert.equal(data.lettering.subtitle,'CLIPART BUNDLE');
  assert.equal(data.lettering.badge,'80 PNGs');
  assert.equal(data.prompt,'PREMIUM Etsy creative design');
  assert.match(data.purpose,/ZIP is NOT an OpenAI vision input/);
});

test('ZIP action validates selected original IDs and streams immutable bytes, not regenerated art',()=>{
  assert.match(backend,/input\.action === 'source-zip'/);
  assert.match(backend,/originalAssetStorageKey\(asset,user\.userId\)/);
  assert.match(backend,/await storage\.head\(ref\.key\)/);
  assert.match(backend,/selectedSourceManifest/);
  assert.match(backend,/new Response\(zipStream\(entries\)/);
  assert.match(backend,/storage\.get\(key\)/);
  assert.match(backend,/application\/zip/);
  assert.match(frontend,/downloadAiFirstSourceZip/);
  assert.match(frontend,/Download selected source ZIP/);
  assert.match(frontend,/action:'source-zip'/);
  assert.match(frontend,/backgroundPrompt:promptDraft!\.backgroundPrompt/);
  assert.match(frontend,/selectedAssetIds:\[\.\.\.new Set\(positions\.map\(p=>p\.assetId\)\)\]/);
});

test('the user-approved premium prompt adapts the theme and selected actual clipart rather than imposing Christmas',()=>{
  const prompt=aiFirstConceptPrompt({
    theme:'Botanical Wildflowers',style:'Hand-painted botanical watercolor',palette:'sage and blush',
    texture:'soft translucent brush strokes',title:'Wildflower Garden',subtitle:'BOTANICAL CLIPART',
    badge:'120 PNGs',selectedCount:28,sourceAssets:[
      {name:'pink blossom bouquet',category:'Bouquets'},
      {name:'green leaf sprig',category:'Greenery'}
    ]
  });
  assert.match(prompt,/Create a stunning, premium-quality Etsy digital clipart bundle thumbnail/);
  for(const section of ['CANVAS','ARTWORK & COMPOSITION','TYPOGRAPHY','ARTISTIC DIRECTION','CREATIVE FREEDOM','FINAL QUALITY','SOURCE CLIPART REQUIREMENTS'])
    assert.ok(prompt.includes('**'+section+'**'),section);
  assert.match(prompt,/Wildflower Garden/);
  assert.match(prompt,/BOTANICAL CLIPART/);
  assert.match(prompt,/120 PNGs/);
  assert.match(prompt,/pink blossom bouquet/);
  assert.match(prompt,/green leaf sprig/);
  assert.match(prompt,/sage and blush/);
  assert.match(prompt,/Hand-painted botanical watercolor/);
  assert.doesNotMatch(prompt,/cranberry-red|Christmas woodland clipart illustrations/i);
  assert.doesNotMatch(prompt,/\bx\s*:\s*\d|\by\s*:\s*\d/);
  const background=aiFirstBackgroundPrompt({userDirection:prompt,creativeBrief:'Botanical art direction',
    title:'Wildflower Garden',subtitle:'BOTANICAL CLIPART',badge:'120 PNGs'});
  assert.match(background,/ABSOLUTE PRODUCT ARTWORK RULE/);
  assert.match(background,/Only lettering, nonfigurative shapes/);
  assert.doesNotMatch(backend,/form\.append\('image\[\]'/);
});


test('selected source ZIP button is visible in every mode and works before preparing paid prompts',()=>{
  const start=frontend.indexOf('const downloadAiFirstSourceZip = async () =>');
  const end=frontend.indexOf('const generateAiFirstConcept = async () =>',start);
  assert.ok(start>=0 && end>start);
  const downloadHandler=frontend.slice(start,end);
  assert.doesNotMatch(downloadHandler,/if\(!promptsReady\) return/);
  assert.match(downloadHandler,/backgroundPrompt:compositionMode === 'ai-first' && promptsReady/);
  assert.match(downloadHandler,/\? promptDraft!\.backgroundPrompt : undefined/);
  assert.match(frontend,/data-listing-source-zip-download="always-visible"/);
  const buttonStart=frontend.indexOf('data-listing-source-zip-download="always-visible"');
  const buttonEnd=frontend.indexOf('COMPOSITION MODE',buttonStart);
  assert.ok(buttonStart>=0 && buttonEnd>buttonStart);
  const button=frontend.slice(buttonStart,buttonEnd);
  assert.match(button,/Download selected source ZIP/);
  assert.match(button,/onClick=\{\(\) => void downloadAiFirstSourceZip\(\)\}/);
  assert.doesNotMatch(button,/compositionMode === 'ai-first' &&/);
  assert.doesNotMatch(button,/disabled=\{!!working \|\| !positions\.length \|\| !promptsReady\}/);
  assert.match(backend,/const creativePrompt=input\.backgroundPrompt\?\.trim\(\) \|\| aiFirstConceptPrompt\(/);
  assert.match(backend,/sourceAssets:refs\.map/);
  assert.match(backend,/prompt:creativePrompt/);
});
