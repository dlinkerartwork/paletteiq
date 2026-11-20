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


test('Excel headers occupy one horizontal row and listing values align directly underneath', () => {
  const listing = normalizeListing({
    title: 'Ocean & Shells', description: 'Pastel <blue> beach\nSummer clipart',
    tags: ['beach decor', 'ocean nursery'],
    imageAltTexts: ['Hammock by the sea'], primaryKeyword: 'summer beach art',
    attributes: { palette: 'Muted coral' },
  });
  const selected = ['title', 'description', 'tags', 'imageAltTexts', 'primaryKeyword', 'attributes'];
  const entries = zipEntries(createEtsyListingExcel(listing, selected));
  const sheet = entries.get('xl/worksheets/sheet1.xml');
  const styles = entries.get('xl/styles.xml');
  assert.match(sheet, /<dimension ref="A1:F2"\/>/);
  const header = sheet.match(/<row r="1"[^>]*>(.*?)<\/row>/)?.[1];
  const values = sheet.match(/<row r="2"[^>]*>([\s\S]*?)<\/row>/)?.[1];
  assert.ok(header && values, 'One header row and one data row are required');
  for (const [column, label] of [
    ['A','Title'],['B','Description'],['C','Tags'],['D','Image ALT Text'],
    ['E','Primary keyword'],['F','Attributes'],
  ]) {
    assert.ok(header.includes(`<c r="${column}1" s="1" t="inlineStr"><is><t xml:space="preserve">${label}</t></is></c>`),
      label + ' must be a horizontal header');
    assert.ok(values.includes(`<c r="${column}2" s="2" t="inlineStr">`),
      label + ' value must be directly below its header');
  }
  assert.match(values,/Ocean &amp; Shells/);
  assert.match(values,/Pastel &lt;blue&gt;/);
  assert.match(values,/beach decor\nocean nursery/);
  assert.match(values,/palette: Muted coral/);
  assert.doesNotMatch(sheet,/ETSY LISTING FIELD|<dimension ref="A1:B7"/);
  assert.match(sheet,/<pane ySplit="1" topLeftCell="A2"/);
  assert.match(sheet,/<autoFilter ref="A1:F2"\/>/);
  assert.match(styles,/<cellXfs count="3">/);
});

test('Excel defaults to four horizontal SEO fields and handles an empty selection', () => {
  const listing = normalizeListing({ title: 'Default export' });
  const standard = zipEntries(createEtsyListingExcel(listing)).get('xl/worksheets/sheet1.xml');
  assert.match(standard,/<dimension ref="A1:D2"\/>/);
  assert.match(standard,/<c r="D1" s="1" t="inlineStr">/);
  assert.match(standard,/<c r="D2" s="2" t="inlineStr">/);
  const empty = zipEntries(createEtsyListingExcel(listing, [])).get('xl/worksheets/sheet1.xml');
  assert.match(empty,/<dimension ref="A1:A2"\/>/);
  assert.match(empty,/No fields selected/);
});

test('Settings default models and Full Automation phases are wired to authenticated server endpoints', () => {
  const page = load('app/page.tsx'), flow = load('app/api/full-automation/route.ts');
  const image = load('app/api/image-batches/route.ts'), recovery = load('lib/batch-recovery.ts');
  const installer = load('desktop/background-batch-monitor.cjs');
  const seo = load('components/etsy-listing-draft.tsx');
  assert.match(page, /Full Automation/);
  assert.match(page, /Target characters to generate/);
  assert.match(page, /fetch\('\/api\/full-automation'/);
  assert.match(flow, /setStage\(owner,id,'revising'/);
  assert.match(flow, /stage:'completed'/);
  assert.match(flow, /regenerate:true/);
  assert.match(flow, /characterIds:f\.reviewQueue/);
  assert.match(image, /replaceFromImageUrl/);
  assert.match(recovery, /item\?\.replaceFromImageUrl/);
  assert.match(installer, /\/api\/full-automation/);
  assert.match(seo, /Export Excel/);
  assert.doesNotMatch(seo, /Export JSON/);
  assert.match(seo, /application\/vnd.openxmlformats-officedocument.spreadsheetml.sheet/);
});
