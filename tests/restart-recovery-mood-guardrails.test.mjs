import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCreativeAnalysis,mergeSourceEmotionProfile,referenceMoodFromExpressions} from '../lib/creative-intelligence.ts';
import {researchAnalysisInstruction,productionPromptInstruction,diversityExpansionInstruction} from '../lib/creative-research-prompts.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const imageRoute=read('app/api/image-batches/route.ts');
const page=read('app/page.tsx');
const production=read('components/image-production.tsx');
const desktop=read('desktop/main.cjs');

test('reference facial smiles override melancholy AI guesses and generic pastel cue',()=>{
  const analysis=normalizeCreativeAnalysis({
    mood:'dreamy sad watercolor',
    emotionProfile:{dominantMood:'melancholy',referenceMood:'sad and tender',
      observedExpressions:['big happy smile','delighted grin','sparkling eyes and playful gesture']},
    imageObservations:[{imageIndex:1,role:'cover',expressions:['joyful smile'],subjects:['fairy']}],
  });
  const merged=mergeSourceEmotionProfile(analysis,'Cute pastel fairy watercolor',['nursery']);
  assert.equal(merged.emotionProfile.referenceMood,'joyful, cheerful and playful');
  assert.equal(merged.emotionProfile.dominantMood,'joyful, cheerful and playful');
  assert.equal(merged.emotionProfile.moodConfidence,'high');
  assert.match(merged.emotionProfile.moodEvidence,/smile|grin/);
  assert.equal(referenceMoodFromExpressions(['pastel pink watercolor','cute floral texture']).mood,'');
  assert.equal(referenceMoodFromExpressions(['crying and teary eyes','sad downturned mouth']).mood,'sad and tender');
  assert.equal(mergeSourceEmotionProfile(analysis,'Sad tearful fairy painting',[]).emotionProfile.dominantMood,'sad');
});

test('Research reports visible reference mood and image grounded confidence',()=>{
  const instruction=researchAnalysisInstruction({title:'Cute Fairy',description:'pastel',tags:['fairy']},8,50);
  assert.match(instruction,/REFERENCE MOOD MUST BE GROUNDED IN ACTUAL FACES/);
  assert.match(instruction,/"referenceMood":/);
  assert.match(instruction,/"moodEvidence":/);
  assert.match(instruction,/"moodConfidence":/);
});

test('editable target mood in Research & Analysis drives downstream prompts',()=>{
  assert.match(page,/Reference Mood Analysis/);
  assert.match(page,/Select target mood/);
  assert.match(page,/update\(\{emotionDirection:e\.target\.value\}\)/);
  assert.match(page,/referenceMoodFromExpressions/);
  assert.match(page,/Collection mood and expression direction/);
  const prompt=productionPromptInstruction({title:'Cute fairy',analysis:normalizeCreativeAnalysis({emotionProfile:{dominantMood:'joyful, cheerful and playful'}}),characters:[{id:'f1',name:'Little fairy'}]});
  assert.match(prompt,/TARGET MOOD OVERRIDES AMBIGUOUS STYLING/);
  assert.match(prompt,/DO NOT output sad/);
  const expansion=diversityExpansionInstruction({count:10,target:50,title:'Cute Fairy',analysis:normalizeCreativeAnalysis({emotionProfile:{dominantMood:'joyful, cheerful and playful'}}),existing:[],distribution:{}});
  assert.match(expansion,/joyful, cheerful, happy or playful/);
});

test('restart recovery prioritizes importing paid PNGs before expensive similarity review',()=>{
  assert.match(imageRoute,/items\.every\(item => item\.status !== 'pending'\)/);
  assert.match(imageRoute,/const IMAGE_BATCH_SYNC_PER_COLLECTION = 4/);
  assert.match(imageRoute,/sort\(\(a,b\)=>a\.updatedAt-b\.updatedAt\)/);
  assert.match(page,/setInterval\(\(\) => void resumeBatches\(\), 12000\)/);
  assert.match(production,/setInterval\(\(\) => void refresh\(false, true\), 8000\)/);
  assert.match(desktop,/const BACKGROUND_POLL_MS = 20_000/);
  assert.match(imageRoute,/if \(isTerminal && bucket\) \{/);
  assert.match(imageRoute,/if \(changedIds\.size\) \{/);
  assert.doesNotMatch(imageRoute,/\/batches\/.*\/cancel/);
});
