import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchResearchImageDataUrls, isEtsyImageUrl, safeRejectedImageResearch } from '../lib/research-image-input.ts';

const research = readFileSync(new URL('../app/api/research-jobs/route.ts', import.meta.url), 'utf8');
const automation = readFileSync(new URL('../app/api/full-automation/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const imageUrl = 'https://i.etsystatic.com/12345678/sample.jpg';
const rejected = { status:'failed', error:'OpenAI background research failed to start (HTTP 400): { "error": { "message": "Unable to download content from the provided URL before the timeout." } }' };

test('retry requires a definite failed HTTP 400 image URL rejection without a response ID', () => {
  assert.equal(safeRejectedImageResearch(rejected), true);
  assert.equal(safeRejectedImageResearch({...rejected, responseId:'resp_alreadyAccepted'}), false);
  assert.equal(safeRejectedImageResearch({...rejected, status:'queued'}), false);
  assert.equal(safeRejectedImageResearch({status:'failed',error:'OpenAI timed out after accepting the request'}), false);
  assert.equal(safeRejectedImageResearch({status:'failed',error:'OpenAI background research failed to start (HTTP 400): Invalid prompt'}), false);
});

test('Etsy server-side image fetch accepts supported bytes and creates base64 data URLs', async () => {
  const jpeg = Uint8Array.of(255,216,255,224,1,2);
  const result = await fetchResearchImageDataUrls([imageUrl], async (_url, opts) => {
    assert.equal(opts?.redirect, 'manual');
    return new Response(jpeg, {headers:{'content-type':'image/jpeg','content-length':String(jpeg.byteLength)}});
  });
  assert.deepEqual(result, ['data:image/jpeg;base64,'+btoa(String.fromCharCode(...jpeg))]);
});

test('untrusted image URL/redirect, MIME and oversized files fail before OpenAI submission', async () => {
  assert.equal(isEtsyImageUrl('https://example.com/a.jpg'), false);
  assert.equal(isEtsyImageUrl('https://etsystatic.com.evil.example/a.jpg'), false);
  assert.equal(isEtsyImageUrl('http://i.etsystatic.com/a.jpg'), false);
  assert.equal(isEtsyImageUrl(imageUrl), true);
  await assert.rejects(fetchResearchImageDataUrls(['https://example.com/a.jpg']), /genuine HTTPS Etsy/);
  await assert.rejects(fetchResearchImageDataUrls([imageUrl], async () => new Response(null, {status:302,headers:{location:'https://evil.example/a.jpg'}})), /Could not retrieve/);
  await assert.rejects(fetchResearchImageDataUrls([imageUrl], async () => new Response('not an image', {headers:{'content-type':'text/html'}})), /unsupported content type/);
  await assert.rejects(fetchResearchImageDataUrls([imageUrl], async () => new Response('a', {headers:{'content-type':'image/jpeg'}})), /not a valid image/);
  await assert.rejects(fetchResearchImageDataUrls([imageUrl], async () => new Response('x', {headers:{'content-type':'image/jpeg','content-length':'99999999'}})), /bounded image input budget/);
});

test('research prepares verified image bytes before creating paid job receipt', () => {
  const prep = research.indexOf('await fetchResearchImageDataUrls(referenceUrls)');
  const job = research.indexOf('const job: ResearchJob =');
  const claim = research.indexOf('const claim = await getDb().update(projects)');
  const remote = research.indexOf("const ai = await openai(aiKey, 'responses'");
  assert.ok(prep > 0 && job > prep && claim > job && remote > claim);
  assert.match(research, /\.\.\.imageDataUrls\.map\(image_url =>/);
  assert.match(research, /body\.retryFailed === true && safeRejectedImageResearch/);
  assert.match(automation, /canRetryRejectedResearch: Boolean\(canRetryRejectedResearch\(p\)\)/);
  assert.match(page, /Retry rejected image research \(check OpenAI usage first\)/);
  assert.match(page, /retryFailed:true/);
});
