import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conceptFamily, familyDistribution, normalizeCreativeAnalysis, selectDiverseConcepts } from '../lib/creative-intelligence.ts';
import { diversityExpansionInstruction, productionPromptInstruction, researchAnalysisInstruction } from '../lib/creative-research-prompts.ts';

test('deep source research separates observed pixels from suggested compatible categories', () => {
  const instruction = researchAnalysisInstruction({
    title: 'Pink Strawberry Farm Animals Birthday PNG Bundle',
    description: 'Pastel baby farm animals', tags: ['strawberry farm', 'farm animal clipart'],
  }, 7);
  for (const term of ['MICRO-THEME', 'dominant', 'primary keyword', 'long-tail',
    'imageObservations', 'observedSubjects', 'subjectFamilies', 'selected images', 'TITLE']) {
    assert.match(instruction.toLowerCase(), new RegExp(term.toLowerCase()), term);
  }
  assert.match(instruction, /Pink Strawberry Farm Animals Birthday/);
  assert.match(instruction, /cannot prove that a character was pictured/);
});

test('analysis values are bounded, cleaned and persistent for deeper visual signals', () => {
  const result = normalizeCreativeAnalysis({
    theme: 'Farm Animals', subtheme: 'Birthday Party', microtheme: 'Pink Strawberry Barnyard',
    primaryKeyword: 'pink farm animal clipart',
    dominantColors: [{name:'Strawberry pink',hex:'#EBA5BD'}, {name:'Broken',hex:'badcolor'}],
    imageObservations: [{imageIndex:2, role:'contact sheet', subjects:['cow','pig'], colors:['pink'],notes:'Two baby animals'}],
    subjectFamilies: ['cow','pig','sheep','goat','duck'],
    longTailKeywords: ['pink strawberry farm animal png'],
  });
  assert.equal(result.microtheme, 'Pink Strawberry Barnyard');
  assert.equal(result.dominantColors[0].hex, '#EBA5BD');
  assert.equal(result.dominantColors[1].hex, undefined);
  assert.deepEqual(result.imageObservations[0].subjects, ['cow','pig']);
  assert.equal(result.longTailKeywords[0], 'pink strawberry farm animal png');
});

test('cow calf cattle share ONE family instead of passing as new species', () => {
  assert.equal(conceptFamily('calf', 'Baby Cow with Pink Bow'), 'cow');
  assert.equal(conceptFamily('bovine', 'Pink Cattle'), 'cow');
  assert.equal(conceptFamily('sheep', 'Baby Lamb'), 'sheep');
  assert.equal(conceptFamily('duckling', 'Tiny Duck'), 'duck');
});

test('category cap prevents monotonous farm animal lists and duplicates', () => {
  const cows = Array.from({length:15},(_,i)=>({name:`Cow pose ${i}`,family:'cow'}));
  const proposed = [
    ...Array.from({length:20},(_,i)=>({name:`Another cow pose ${i}`,family:'cow'})),
    {name:'Strawberry Piglet',family:'pig'},
    {name:'Ribbon Duckling',family:'duck'},
    {name:'Strawberry Piglet',family:'pig'},
    {name:'Pony with Birthday Hat',family:'horse'},
    {name:'Baby Lamb in Overalls',family:'sheep'},
  ];
  const chosen = selectDiverseConcepts(proposed,cows,120,20);
  assert.deepEqual(chosen.map(c=>c.family), ['pig','duck','horse','sheep']);
  const distribution = familyDistribution([...cows,...chosen]);
  assert.equal(distribution.cow,15);
  assert.equal(Object.keys(distribution).length,5);
});

test('niche, keywords and source-title context reach expansion and image prompts', () => {
  const analysis = normalizeCreativeAnalysis({
    theme:'Farm Animals',subtheme:'Baby Farm Animals',microtheme:'Pink Strawberry Birthday Barnyard',
    style:'Soft watercolor',palette:'Pastel pink and cream',primaryKeyword:'strawberry farm clipart',
    keywords:['farm birthday png','pink baby cow clipart'],subjectFamilies:['cow','pig','horse','sheep','duck'],
  });
  const expand = diversityExpansionInstruction({count:20,target:120,title:'Pink Strawberry Farm Party',
    analysis,existing:[{name:'Baby Cow',family:'cow'}],distribution:{cow:14}});
  const prompts = productionPromptInstruction({title:'Pink Strawberry Farm Party',analysis,
    characters:[{id:'c1',name:'Birthday Duckling',family:'duck',description:'A duckling with a tiny berry'}]});
  assert.match(expand,/CURRENT FAMILY COUNTS/);
  assert.match(expand,/MAXIMIZE VARIETY OF SUBJECT IDENTITIES/);
  assert.match(expand,/Pink Strawberry Birthday Barnyard/);
  assert.match(prompts,/GENERAL THEME, SUB-THEME and MICRO-THEME/);
  assert.match(prompts,/strawberry farm clipart/);
  assert.match(prompts,/Birthday Duckling/);
  assert.match(prompts,/subject must fit the source listing TITLE/i);
});

test('UI and API use the same research context, family selection and production brief', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
  assert.match(page,/creativeContext\(project\)/);
  assert.match(page,/selectDiverseConcepts\(proposals, working\.characters/);
  assert.match(page,/selectDiverseConcepts\(proposals, current\.characters/);
  assert.match(page,/Detailed source research/);
  assert.match(page,/Subject family distribution/);
  assert.match(api,/researchAnalysisInstruction\(source/);
  assert.match(api,/diversityExpansionInstruction\(/);
  assert.match(api,/productionPromptInstruction\(/);
});
