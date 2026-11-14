import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LISTING_UPLOAD_CHUNK_BYTES, LISTING_UPLOAD_LIMIT_BYTES,
  readApiJson, uploadListingJpg
} from '../lib/listing-image-upload.ts';

const projectId = '123e4567-e89b-12d3-a456-426614174000';

test('large 3000x2250 listing JPG uploads in 1 MB chunks and assembles at the end', async () => {
  const calls = [];
  const progress = [];
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/thumbnail-background');
    assert.equal(options.method, 'POST');
    const form = options.body;
    assert.equal(form.get('projectId'), projectId);
    const action = form.get('action') || 'direct';
    calls.push({ action, count: form.get('count'), index: form.get('index'), size: form.get('file')?.size ?? 0, id: form.get('uploadId') });
    if (action === 'chunk') return Response.json({ ok: true });
    if (action === 'complete') return Response.json({ url: '/api/thumbnail-background?projectId='+projectId+'&assetId=1&format=jpg' });
    throw Error('Expected chunked request');
  };
  const file = new Blob([new Uint8Array(LISTING_UPLOAD_CHUNK_BYTES * 2 + 19_997)], { type: 'image/jpeg' });
  const saved = await uploadListingJpg(projectId, '01_Main_Cover.jpg', file, fetcher, (done, total) => progress.push([done, total]));
  assert.match(saved, /assetId=1/);
  assert.deepEqual(calls.map(c=>c.action), ['chunk','chunk','chunk','complete']);
  assert.deepEqual(calls.slice(0,3).map(c=>c.size), [1_000_000,1_000_000,19_997]);
  assert.deepEqual(calls.slice(0,3).map(c=>c.index), ['0','1','2']);
  assert.ok(calls.every(c=>c.id===calls[0].id && c.count==='3'));
  assert.deepEqual(progress, [[1,3],[2,3],[3,3]]);
});

test('small listing JPG uploads with one standard authenticated request', async () => {
  let sends = 0;
  const fetcher = async (url, options) => {
    sends++;
    assert.equal(options.body.get('action'), null);
    assert.equal(options.body.get('file').name, '08_Sticker_Sheet_Mockup.jpg');
    return Response.json({ url: '/saved.jpg' });
  };
  const path = await uploadListingJpg(projectId, '08_Sticker_Sheet_Mockup.jpg', new Blob([new Uint8Array(30_000)]), fetcher);
  assert.equal(path,'/saved.jpg');
  assert.equal(sends,1);
});

test('non-JSON HTTP 413 is shown as a readable error instead of a SyntaxError', async () => {
  await assert.rejects(readApiJson(new Response('Payload Too Large', {status:413}), 'Listing JPG upload'), /HTTP 413: Payload Too Large/);
  await assert.rejects(readApiJson(new Response('<html>upstream server failed</html>', {status:502}), 'Listing Studio'), /HTTP 502/);
  await assert.rejects(readApiJson(Response.json({error:'Invalid project'}, {status:404}), 'Listing Studio'), /Invalid project/);
});

test('chunk failures stop assembly and return a precise message', async () => {
  let sends = 0;
  const fetcher = async () => {
    sends++;
    return sends===2 ? new Response('Payload Too Large',{status:413}) : Response.json({ok:true});
  };
  await assert.rejects(
    uploadListingJpg(projectId,'01_Main_Cover.jpg',new Blob([new Uint8Array(2_400_000)]),fetcher),
    /HTTP 413: Payload Too Large/
  );
  assert.equal(sends,2);
});

test('20 MB limit rejects images before sending any HTTP request', async () => {
  const fetcher = async () => { throw Error('Should not send oversized file'); };
  await assert.rejects(
    uploadListingJpg(projectId,'01_Main_Cover.jpg',new Blob([new Uint8Array(LISTING_UPLOAD_LIMIT_BYTES+1)]),fetcher),
    /maximum stored render size is 20 MB/
  );
});

test('listing studio persists paid AI background before uploading, so JPG save can be retried', () => {
  const ui = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');
  assert.match(ui,/await saveRecord\(\{\s*number: step, status: 'draft', backgroundUrl: response.backgroundUrl/);
  assert.match(ui,/Retry save JPG \(no AI cost\)/);
  assert.match(ui,/uploadListingJpg\(projectId, fileName\(number\)/);
  assert.match(route,/value\.renderedImageUrl !== undefined \? value\.renderedImageUrl/);
});
