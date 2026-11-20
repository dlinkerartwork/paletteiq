import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryCharacterSubject,primaryCharacterTarget,isPrimaryCharacter} from '../lib/primary-character-focus.ts';
import {selectDiverseConcepts} from '../lib/creative-intelligence.ts';
import {researchAnalysisInstruction,diversityExpansionInstruction} from '../lib/creative-research-prompts.ts';
import {hybridMergeInstruction} from '../lib/hybrid-research.ts';
import {readFileSync} from 'node:fs';

const title='Pastel Fairy Garden Clipart Watercolor Fairy Clipart Cute Little Girl Clipart Baby Fairy clipart Fairy Garden Nursery Clip Magical Fairy.';
const source={title,description:'nursery watercolor fairies',tags:['fairy','garden']};
const fairy=(i)=>({name:'Fairy '+i,family:'fairy',expression:'dreamy '+i,
  silhouette:'Unique fairy silhouette '+i+' with individual wing geometry',accessories:'flower '+i});
const prop=(i)=>({name:'Garden Mushroom '+i,family:'mushroom',expression:'not applicable',
  silhouette:'Garden mushroom '+i+' distinct canopy shape',accessories:'none'});

test('Fairy Garden listing correctly identifies the recurring main character',()=>{
  assert.equal(primaryCharacterSubject(title),'fairy');
  assert.equal(primaryCharacterTarget(50,'fairy'),35);
  assert.equal(isPrimaryCharacter({name:'Sleepy Baby Fairy',family:'fairy'},'fairy'),true);
  assert.equal(isPrimaryCharacter({name:'Garden Butterfly',family:'butterfly'},'fairy'),false);
  assert.equal(primaryCharacterSubject('Farm animals and flowers'),null);
});

test('concept selection keeps fairy variants and limits supporting objects',()=>{
  const selected=selectDiverseConcepts([...Array.from({length:45},(_,i)=>prop(i)),...Array.from({length:45},(_,i)=>fairy(i))],
    [],50,50,4,'fairy');
  assert.equal(selected.length,50);
  assert.ok(selected.filter(c=>isPrimaryCharacter(c,'fairy')).length>=35);
  assert.ok(selected.filter(c=>!isPrimaryCharacter(c,'fairy')).length<=15);
});

test('even a low-fairy research response does not fill the target with props',()=>{
  const selected=selectDiverseConcepts([
    ...Array.from({length:45},(_,i)=>prop(i)),...Array.from({length:5},(_,i)=>fairy(i))
  ],[],50,50,4,'fairy');
  assert.equal(selected.filter(c=>isPrimaryCharacter(c,'fairy')).length,5);
  assert.ok(selected.filter(c=>!isPrimaryCharacter(c,'fairy')).length<=15);
  assert.ok(selected.length<50,'AI Fill must add primary fairies rather than treating props as completed target');
});

test('all generation prompts describe the hero quota and preserve creative variety',()=>{
  assert.match(researchAnalysisInstruction(source,8,50),/at least 35 of the 50 original concepts/);
  const expansion=diversityExpansionInstruction({count:15,target:50,title,analysis:{},existing:Array.from({length:5},(_,i)=>fairy(i)),distribution:{fairy:5}});
  assert.match(expansion,/Remaining main characters needed: 30/);
  assert.match(expansion,/Generate 15 or more NEW, visually distinct fairy characters/);
  const merged=hybridMergeInstruction(source,[{index:0,images:['one'],status:'completed',resultText:JSON.stringify({theme:'fairies',characters:[fairy(1)]})}],50);
  assert.match(merged,/At least 35 of the 50 original concepts MUST be "fairy"/);
});

test('research import and automation expansion apply focal selection',()=>{
  const research=readFileSync(new URL('../app/api/research-jobs/route.ts',import.meta.url),'utf8');
  const flow=readFileSync(new URL('../app/api/full-automation/route.ts',import.meta.url),'utf8');
  assert.match(research,/primaryCharacterSubject\(source\.title\)/);
  assert.match(flow,/primaryCharacterSubject\(p\.title\|\|p\.name\)/);
});
