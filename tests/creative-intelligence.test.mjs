import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conceptFamily, expressionDistribution, extractEmotionCues, familyDistribution, mergeSourceEmotionProfile, normalizeCreativeAnalysis, selectDiverseConcepts } from '../lib/creative-intelligence.ts';
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

test('cute and baby are style and age signals, whereas happy/sad/angry are moods', () => {
  assert.deepEqual(extractEmotionCues('Cute Baby Happy Barnyard Animals'), ['cute', 'baby', 'happy']);
  assert.deepEqual(extractEmotionCues('Sad crying puppy and angry cat'), ['sad', 'angry']);
  assert.deepEqual(extractEmotionCues('Pastel Flower Clipart'), []);
  assert.deepEqual(extractEmotionCues('grumpy baby ducklings'), ['baby', 'angry']);
});

test('visual facial-expression evidence remains distinct from title and tags', () => {
  const parsed = normalizeCreativeAnalysis({
    theme: 'Farm Animals',
    emotionProfile: {
      dominantMood: 'cheerful', observedExpressions: ['smiling cow', 'happy pig'],
      expressionStyle: 'rounded joyful eyes', recommendedExpressions: ['soft smile', 'closed-eye grin'],
    },
    imageObservations: [
      { imageIndex: 1, role: 'contact sheet', subjects: ['cow'], colors: ['pink'], expressions: ['smiling with eyes closed'], notes: 'Cow visible' },
      { imageIndex: 2, role: 'product mockup', subjects: ['barn'], colors: ['green'], notes: 'no visible face' },
    ],
  });
  const merged = mergeSourceEmotionProfile(parsed, 'Angry Baby Farm Animals', ['happy farm png']);
  assert.deepEqual(merged.emotionProfile.titleCues, ['baby', 'angry']);
  assert.deepEqual(merged.emotionProfile.tagCues, ['happy']);
  assert.equal(merged.emotionProfile.dominantMood, 'angry');
  assert.ok(merged.emotionProfile.ageCues.includes('baby'));
  assert.deepEqual(merged.emotionProfile.observedExpressions, ['smiling cow', 'happy pig']);
  assert.deepEqual(merged.imageObservations[0].expressions, ['smiling with eyes closed']);
  assert.deepEqual(merged.imageObservations[1].expressions, []);
});

test('explicit happy baby words take priority, while cute alone does not force a smiling face', () => {
  const parsed = normalizeCreativeAnalysis({ mood: 'soft watercolor', emotionProfile: { dominantMood: 'gentle' } });
  const happy = mergeSourceEmotionProfile(parsed, 'Happy Baby Farm Animals', ['sad watercolor png']);
  assert.equal(happy.emotionProfile.dominantMood, 'happy');
  assert.deepEqual(happy.emotionProfile.ageCues, ['baby']);
  const cute = mergeSourceEmotionProfile(parsed, 'Cute Farm Animal Clipart', []);
  assert.equal(cute.emotionProfile.dominantMood, 'gentle');
  assert.deepEqual(cute.emotionProfile.ageCues, ['cute']);
});

test('concept selection favors expression variation within eligible subject-family quotas', () => {
  const existing = [{ name: 'Baby cow', family: 'cow', expression: 'gentle smile' }];
  const choices = [
    { name: 'Happy pig with a smile', family: 'pig', expression: 'gentle smile' },
    { name: 'Delighted duck', family: 'duck', expression: 'closed-eye grin' },
    { name: 'Shy lamb', family: 'sheep', expression: 'subtle bashful smile' },
  ];
  const selected = selectDiverseConcepts(choices, existing, 120, 3);
  assert.equal(selected[0].family, 'duck');
  assert.equal(selected[1].family, 'sheep');
  assert.equal(selected[2].family, 'pig');
  assert.deepEqual(expressionDistribution([...existing, ...selected]), {
    'gentle smile': 2, 'closed-eye grin': 1, 'subtle bashful smile': 1,
  });
});

test('research, expansion and image prompts retain observed expressions, title mood and age', () => {
  const research = researchAnalysisInstruction({
    title: 'Sad Baby Watercolor Farm Animals', description: 'Sad little animals',
    tags: ['sad animal png', 'cute baby clipart'],
  }, 4);
  assert.match(research,/titleCues/);
  assert.match(research,/observedExpressions/);
  assert.match(research,/ageCues/);
  assert.match(research,/eyes, mouth, eyebrows/);
  const analysis = mergeSourceEmotionProfile(normalizeCreativeAnalysis({
    emotionProfile: { observedExpressions: ['sad downcast eyes'], recommendedExpressions: ['teary gaze'] },
  }), 'Sad Baby Farm Animals', ['baby animals']);
  const expand = diversityExpansionInstruction({
    count: 20, target: 120, title: 'Sad Baby Farm Animals', analysis,
    existing: [{ name: 'Baby pig', family: 'pig', expression: 'teary gaze' }],
    distribution: { pig: 1 }, expressionCounts: { 'teary gaze': 1 },
  });
  assert.match(expand,/CURRENT EXPRESSION COUNTS/);
  assert.match(expand,/Do not assign random happy smiles/);
  assert.match(expand,/sad/);
  const production = productionPromptInstruction({
    title: 'Sad Baby Farm Animals', analysis,
    characters: [{ id:'pig1', name:'Baby Piglet', family:'pig', expression:'downcast eyes',
      description:'small pink snout' }],
  });
  assert.match(production,/EXPRESSION AND AGE ARE MANDATORY/);
  assert.match(production,/downcast eyes/);
  assert.match(production,/Baby requires juvenile proportions/);
});

test('UI/API forward editable per-character expression and source mood throughout production', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
  assert.match(page,/EXPRESSION \/ FACE/);
  assert.match(page,/Collection mood and expression direction/);
  assert.match(page,/Character expression distribution/);
  assert.match(page,/emotionDirection: research\.emotionProfile\.dominantMood/);
  assert.match(page,/existing: working\.characters\.map\(c => \(\{ name: c\.name, family: c\.family, expression: c\.expression \}\)\)/);
  assert.match(api,/mergeSourceEmotionProfile\(normalizeCreativeAnalysis\(raw\), source\.title, source\.tags\)/);
  assert.match(api,/expressionCounts: expressionDistribution\(existing\)/);
  assert.match(api,/expression: String\(c\.expression \?\? ''\)/);
});
