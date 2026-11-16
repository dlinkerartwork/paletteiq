import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  normalizeCreativeAnalysis, normalizeCreativeControls, defaultCreativeControls,
  reverseEngineeringKeys, styleDNAKeys, characterDNAKeys, selectDiverseConcepts,
} from '../lib/creative-intelligence.ts';
import { researchAnalysisInstruction, diversityExpansionInstruction, productionPromptInstruction } from '../lib/creative-research-prompts.ts';
import { buildPromptBatchInput, projectPromptContext } from '../lib/prompt-batch-jobs.ts';

const sampleSource = {
  title: 'Cute Glossy Squishy Glitter Dumplings',
  description: 'Pastel rounded dumpling illustration in a shiny jelly look',
  tags: ['cute dumpling', 'sparkly kawaii clipart'],
};
const completeAnalysis = normalizeCreativeAnalysis({
  theme: 'Squishy Characters', subtheme: 'Food Characters', microtheme: 'Glitter Dumplings',
  style: 'Glossy jelly-like 3D kawaii', palette: 'pink, lavender, mint',
  visualReverseEngineering: {
    characterShape: 'round chubby dumplings with soft irregular silhouettes',
    facialExpression: 'large reflective pupils, little smiles and cheeks blush',
    colorPalette: 'pastel pink, lavender, mint and gentle color gradients',
    materialTexture: 'resin-like glossy jelly and glittery surfaces',
    specialEffects: 'subtle sparkles and shimmer',
    lightingRendering: 'diffuse studio light, specular reflections, shallow depth',
    characterCategories: 'food and dessert characters',
    accessories: 'ribbons, sprinkles, toppings',
    composition: 'isolated, fully visible objects',
    illustrationQuality: 'clean smooth antialiased edges',
    clipartProduction: 'separate objects, alpha-ready',
    commercialAssets: 'possible invitation and scrapbook use',
  },
  styleDNA: {
    visualLanguage: 'glossy pastel 3D kawaii rendering',
    shapeLanguage: 'rounded squishy body proportions',
    paletteRules: 'mint, lavender and candy pink with accent highlights',
    materialRules: 'resin and translucent jelly-like shine',
    effectRules: 'small glitter flecks and shimmers',
    lightingRules: 'diffuse studio illumination',
    outlineRules: 'soft edges with no harsh black lines',
    renderingRules: 'smooth dimensional high resolution finish',
    compositionRules: 'one centered fully visible object',
    backgroundRules: 'transparent exported PNG, not painted background',
  },
  characterDNA: {
    categoryDiversity: 'desserts, animals, toy objects that fit the niche',
    silhouetteDiversity: 'distinct dumpling and food silhouettes',
    facialDiversity: 'different eye and mouth positions',
    expressionDiversity: 'joyful eyes, winks and surprised faces',
    accessoryDiversity: 'bow, topping and sprinkles distributed',
    colorDiversity: 'several pastel roles but coherent palette',
    duplicationAvoidance: 'reject repeated silhouette and color-only swaps',
  },
  imageObservations: [{
    imageIndex: 1, role:'individual art', subjects: ['dumpling'], colors:['lavender'],
    shapes:['round organic dumpling'], expressions:['wink'],
    materials:['glossy resin'], effects:['sparkles'], notes:'Observed on selected image',
  }],
});

test('reference reverse engineering preserves all twelve analysis dimensions as separate fields', () => {
  assert.equal(reverseEngineeringKeys.length, 12);
  for (const key of reverseEngineeringKeys) assert.ok(completeAnalysis.visualReverseEngineering[key], key);
  assert.equal(styleDNAKeys.length, 10);
  assert.equal(characterDNAKeys.length, 7);
  assert.equal(completeAnalysis.imageObservations[0].shapes[0], 'round organic dumpling');
  assert.equal(completeAnalysis.imageObservations[0].materials[0], 'glossy resin');
  assert.equal(completeAnalysis.imageObservations[0].effects[0], 'sparkles');
});

test('missing reverse-engineering fields normalize safely on legacy collections', () => {
  const older = normalizeCreativeAnalysis({theme:'Flower Art',style:'Watercolor'});
  for (const key of reverseEngineeringKeys) assert.equal(older.visualReverseEngineering[key], '');
  for (const key of styleDNAKeys) assert.equal(older.styleDNA[key], '');
  for (const key of characterDNAKeys) assert.equal(older.characterDNA[key], '');
  assert.deepEqual(older.creativeControls, defaultCreativeControls);
});

test('creative production controls are normalized, bounded and support all-eligible default', () => {
  assert.deepEqual(normalizeCreativeControls({styleConsistency:99,characterVariation:-2,textureControl:2.6,detailQuality:4.1,promptQuantity:10001}), {
    styleConsistency:5,characterVariation:1,textureControl:3,detailQuality:4,promptQuantity:1000,
  });
  assert.equal(normalizeCreativeControls({promptQuantity:0}).promptQuantity, 0);
});

test('visual research asks for all 12 dimensions and distinguishes Style DNA from Character DNA', () => {
  const prompt = researchAnalysisInstruction(sampleSource, 5, 120, {styleConsistency:5,characterVariation:5,textureControl:3,detailQuality:4,promptQuantity:20});
  for (const label of ['Character Shape Analysis','Facial Expression Analysis','Color Palette Analysis',
    'Material & Texture Analysis','Special Effects Analysis','Lighting & Rendering Analysis',
    'Character Category Analysis','Accessories Analysis','Composition Analysis',
    'Illustration Quality Analysis','Clipart Production Analysis','Commercial Asset Analysis']) {
    assert.ok(prompt.includes(label), label);
  }
  assert.match(prompt, /visualReverseEngineering/);
  assert.match(prompt, /styleDNA/);
  assert.match(prompt, /characterDNA/);
  assert.match(prompt, /shape.*silhouette/);
  assert.match(prompt, /glossy 3D, glitter, jelly, pastel or faces on unrelated reference images/);
  assert.match(prompt, /"characterVariation":5/);
});

test('distinct repeated silhouettes are rejected even when color and name differ', () => {
  const previous = [{name:'Pink Dumpling',family:'dumpling',silhouette:'rounded asymmetrical shell with folded rim'}];
  const selected = selectDiverseConcepts([
    {name:'Lavender Dumpling',family:'dumpling',silhouette:'rounded asymmetrical shell with folded rim',colorPlan:'lavender'},
    {name:'Dumpling with Wings',family:'dumpling',silhouette:'teardrop body with distinct little side wings',colorPlan:'mint'},
  ], previous, 120, 2, 5);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, 'Dumpling with Wings');
});

test('character variation adjusts family caps without changing default behavior', () => {
  const present = Array.from({length:12}, (_,index)=>({name:'Cow '+index,family:'cow',silhouette:'cow contour '+index}));
  const newCows = Array.from({length:4}, (_,index)=>({name:'New Cow '+index,family:'cow',silhouette:'contour for cow shape '+index}));
  assert.equal(selectDiverseConcepts(newCows,present,120,4,4).length,3);
  assert.equal(selectDiverseConcepts(newCows,present,120,4,5).length,0);
});

test('nine-component image prompt formula applies reference style, not preset glossy or watercolor', () => {
  const text = productionPromptInstruction({
    title:sampleSource.title, analysis:completeAnalysis,
    characters:[{id:'d1',name:'Lavender Dumpling',family:'dessert',
      shape:'small chubby oval',silhouette:'folded organic outer contour',
      expression:'shy wink',accessories:'glitter sprinkles',colorPlan:'lavender with mint accents'}],
  });
  for (const phrase of ['CHARACTER IDENTITY','SHAPE AND ANATOMY','FACIAL EXPRESSION',
    'COLOR PALETTE','MATERIAL AND TEXTURE','DECORATIVE DETAILS',
    'LIGHTING AND RENDERING','COMPOSITION','OUTPUT REQUIREMENTS']) {
    assert.ok(text.includes(phrase),phrase);
  }
  assert.match(text,/STYLE DNA/);
  assert.match(text,/CHARACTER DNA/);
  assert.match(text,/transparent-background PNG/);
  assert.match(text,/shy wink/);
  assert.match(text,/glossy 3D or glitter/);
});

test('batch prompts preserve all character DNA and creative controls', () => {
  const project={id:'p',name:'Squishy Dumplings',title:sampleSource.title,research:completeAnalysis,
    creativeControls:{styleConsistency:5,characterVariation:4,textureControl:5,detailQuality:5,promptQuantity:12},
    characters:[]};
  assert.equal(projectPromptContext(project).creativeControls.styleConsistency,5);
  const jsonl=buildPromptBatchInput(project,[{id:'d1',name:'Glitter Dumpling',shape:'chubby oval',silhouette:'two soft folded corners',
    accessories:'tiny bow',colorPlan:'pastel lavender',expression:'playful grin',family:'dessert'}],'gpt-4.1-mini').jsonl;
  assert.match(jsonl,/chubby oval/);
  assert.match(jsonl,/two soft folded corners/);
  assert.match(jsonl,/pastel lavender/);
  assert.match(jsonl,/\\"styleConsistency\\":5/);
});

test('all UI and API paths propagate research DNA and five settings', () => {
  const ui=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  const direct=readFileSync(new URL('../app/api/studio/route.ts',import.meta.url),'utf8');
  const remote=readFileSync(new URL('../app/api/research-jobs/route.ts',import.meta.url),'utf8');
  for(const label of ['Style Consistency','Character Variation','Texture Control','Detail Quality','Prompt Quantity']) assert.ok(ui.includes(label),label);
  assert.match(ui,/12-point Visual Reverse Engineering/);
  assert.match(ui,/Style DNA — consistent across the collection/);
  assert.match(ui,/Character DNA — unique per character/);
  assert.match(ui,/quantity > 0\) chosen = chosen.slice\(0, quantity\)/);
  assert.match(ui,/shape: dna.shape/);
  assert.match(direct,/normalizeCreativeControls\(body.creativeControls\)/);
  assert.match(direct,/colorPlan: String\(c.colorPlan/);
  assert.match(remote,/normalizeCreativeControls\(saved.data.creativeControls\)/);
  assert.match(remote,/silhouette: c.silhouette/);
});
