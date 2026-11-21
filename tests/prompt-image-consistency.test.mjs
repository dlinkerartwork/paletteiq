import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  preserveSavedPromptLineage,imageWithoutPromptCount,
} from '../lib/prompt-image-consistency.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('stale editor snapshot cannot erase a prompt used to generate a paid PNG',()=>{
  const saved=[
    {id:'a',prompt:'A complete saved original clipart prompt, made by paid OpenAI Responses.',imageUrl:'/api/images/a?batch=receipt',status:'done'},
    {id:'b',prompt:'Another real saved prompt for an image',imageUrl:'/api/images/b?batch=receipt',status:'done'},
    {id:'c',prompt:'Paid prompt already imported successfully',status:'ready'},
    {id:'d',prompt:'Manual free text not yet used',status:'draft'},
  ];
  const incoming=[
    {id:'a',prompt:'',imageUrl:undefined,status:'draft'},
    {id:'b',prompt:'New nonempty manual edit',imageUrl:'/api/images/b?batch=receipt',status:'done'},
    {id:'c',prompt:'',status:'draft'},
    {id:'d',prompt:'',status:'draft'},
  ];
  const result=preserveSavedPromptLineage(incoming,saved,new Set(['c']));
  assert.equal(result[0].prompt,saved[0].prompt,'original image prompt must survive older browser Save');
  assert.equal(result[1].prompt,'New nonempty manual edit','nonempty explicit prompt edits still win');
  assert.equal(result[2].prompt,saved[2].prompt,'completed paid prompt remains recoverable');
  assert.equal(result[3].prompt,'','manual blank permitted when no image or completed paid receipt exists');
  assert.equal(result[0].imageUrl,undefined,'helper does not invent image references; separate image merge owns those');
  assert.equal(saved[0].prompt,'A complete saved original clipart prompt, made by paid OpenAI Responses.');
});

test('79 saved image URLs with only 50 prompts exposes at least 29 mismatches and can preserve source lineage',()=>{
  const saved=Array.from({length:100},(_,i)=>({
    id:'char-'+i,prompt:i<79?'original paid prompt '+i:'',
    imageUrl:i<79?'/api/images/char-'+i:undefined,
  }));
  const stale=saved.map((row,i)=>({
    ...row,prompt:i<50?row.prompt:'',
  }));
  assert.equal(stale.filter(c=>!!c.imageUrl).length,79);
  assert.equal(stale.filter(c=>!!c.prompt.trim()).length,50);
  assert.equal(imageWithoutPromptCount(stale),29);
  const fixed=preserveSavedPromptLineage(stale,saved);
  assert.equal(fixed.filter(c=>!!c.prompt.trim()).length,79);
  assert.equal(imageWithoutPromptCount(fixed),0);
  assert.equal(fixed.filter(c=>!!c.imageUrl).length,79,'no images deleted or regenerated');
});

test('stale saves cannot overwrite active, completed or terminal paid Prompt lineage',()=>{
  const studio=read('app/api/studio/route.ts');
  const prompts=read('app/api/prompt-jobs/route.ts');
  assert.match(studio,/preserveSavedPromptLineage\(/);
  assert.match(studio,/const completedPromptIds=new Set/);
  assert.match(studio,/serverPromptJob\?\.items/);
  assert.match(studio,/incoming.characters,old.characters\|\|\[\],completedPromptIds/);
  assert.match(prompts,/const recoverLostDonePrompt=recoverExisting && item.status==='done'/);
  assert.match(prompts,/!existingCharacter\?\.prompt\?\.trim\(\)/);
  assert.match(prompts,/\(item.status==='done' && !characters.get\(item.id\)\?\.prompt\?\.trim\(\)\)/);
  assert.match(prompts,/promptFingerprint\(character.prompt\|\|''\)!==item.originalFingerprint/);
  assert.match(prompts,/if\(!recoverExisting\) await progressPromptBatches\(owner,id,job.id,key\)/);
});

test('image generation accepts only existing saved prompts and UI exposes mismatched sources',()=>{
  const image=read('app/api/image-batches/route.ts');
  const flow=read('app/api/full-automation/route.ts');
  const page=read('app/page.tsx');
  assert.match(image,/selected.some\(c => !c\?\.prompt/);
  assert.match(flow,/p.characters.filter\(c=>!c.imageUrl&&!!c.prompt\?\.trim\(\)/);
  assert.match(flow,/imageWithoutPromptCount: imageWithoutPromptCount\(p.characters\)/);
  assert.match(page,/Image \/ Prompt consistency warning/);
  assert.match(page,/savedPromptProgress.imagesWithoutPrompts/);
  assert.match(page,/Recover Existing Prompt Responses \(no new paid job\)/);
});
