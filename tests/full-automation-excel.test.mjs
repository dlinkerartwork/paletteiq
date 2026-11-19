import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEtsyListingExcel } from '../lib/etsy-listing-excel.ts';
import { normalizeListing } from '../lib/etsy-listing.ts';

const load = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const utf8 = new TextDecoder();

function zipEntries(bytes) {
  const entries = new Map();
  let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const compression = view.getUint16(at + 8, true);
    assert.equal(compression, 0, 'Excel ZIP uses stored entries');
    const payloadLength = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true), extraLength = view.getUint16(at + 28, true);
    const name = utf8.decode(bytes.slice(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    entries.set(name, utf8.decode(bytes.slice(start, start + payloadLength)));
    at = start + payloadLength;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50, 'ZIP central directory exists');
  return entries;
}

test('Etsy Listing Draft exports actual OOXML XLSX with escaped Excel cells', () => {
  const draft = normalizeListing({
    title: 'Watercolor Baby Safari & "Blush" Animals',
    description: 'A <great> digital bundle.\n=HYPERLINK("bad","site")',
    tags: ['baby safari', 'pink watercolor'],
    primaryKeyword: 'baby safari clipart',
    imageAltTexts: ['A baby zebra and gazelle'],
    attributes: { style: 'Soft <watercolor>' },
  });
  const bytes = createEtsyListingExcel(draft, ['title','description','tags','imageAltTexts','attributes']);
  assert.ok(bytes.length > 1000);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const entries = zipEntries(bytes);
  for (const entry of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/worksheets/sheet1.xml']) {
    assert.ok(entries.has(entry), entry + ' is required');
  }
  const xml = entries.get('xl/worksheets/sheet1.xml');
  assert.match(xml, /Watercolor Baby Safari &amp; &quot;Blush&quot; Animals/);
  assert.match(xml, /&lt;great&gt;/);
  assert.match(xml, /=HYPERLINK/);
  assert.match(xml, /t="inlineStr"/);
  assert.match(xml, /Image ALT Text/);
  assert.match(xml, /Soft &lt;watercolor&gt;/);
});

test('Settings default models and Full Automation phases are wired to authenticated server endpoints', () => {
  const page = load('app/page.tsx'), flow = load('app/api/full-automation/route.ts');
  const image = load('app/api/image-batches/route.ts'), recovery = load('lib/batch-recovery.ts');
  const installer = load('desktop/background-batch-monitor.cjs');
  const seo = load('components/etsy-listing-draft.tsx');
  assert.match(page, /Full Automation/);
  assert.match(page, /Target characters to generate/);
  assert.match(page, /fetch\('\/api\/full-automation'/);
  assert.match(flow, /stage:'revising'/);
  assert.match(flow, /stage:'completed'/);
  assert.match(flow, /regenerate:true/);
  assert.match(flow, /reviewQueue:f/);
  assert.match(image, /replaceFromImageUrl/);
  assert.match(recovery, /item\?\.replaceFromImageUrl/);
  assert.match(installer, /\/api\/full-automation/);
  assert.match(seo, /Export Excel/);
  assert.doesNotMatch(seo, /Export JSON/);
  assert.match(seo, /application\/vnd.openxmlformats-officedocument.spreadsheetml.sheet/);
});
