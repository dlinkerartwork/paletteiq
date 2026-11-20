import { selectedSeoExportFields, type EtsyListingDraft } from './etsy-listing.ts';

/** Small OOXML workbook writer. No extra runtime dependency or CSV spoofing.
 * All user-provided cells are written as XML inline strings (not formulas).
 */
const encoder = new TextEncoder();
function escapeXml(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function cell(col: string, row: number, value: string): string {
  return '<c r="' + col + row + '" t="inlineStr"><is><t xml:space="preserve">' +
    escapeXml(value) + '</t></is></c>';
}
const fields: Record<string, string> = {
  title: 'Title', description: 'Description', tags: 'Tags',
  imageAltTexts: 'Image ALT Text', primaryKeyword: 'Primary keyword',
  secondaryKeywords: 'Secondary keywords', longTailKeywords: 'Long-tail keywords',
  categorySuggestion: 'Category suggestion', attributes: 'Attributes',
  materials: 'Materials', photoPlan: 'Photo plan', priceSuggestion: 'Price suggestion',
  sku: 'SKU', digitalFiles: 'Digital file plan', licenseNotes: 'License notes',
};
function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, val]) => key + ': ' + String(val)).join('\n');
  return String(value ?? '');
}
function contentTypes(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
}
function sheetXml(draft: EtsyListingDraft, selection: unknown): string {
  const rows: string[] = [];
  const entries = selectedSeoExportFields(selection);
  rows.push('<row r="1">' + cell('A', 1, 'ETSY LISTING FIELD') + cell('B', 1, 'VALUE') + '</row>');
  entries.forEach((key, i) => {
    const index = i + 2;
    rows.push('<row r="' + index + '">' + cell('A', index, fields[key]) +
      cell('B', index, stringify(draft[key])) + '</row>');
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:B' + (entries.length + 1) + '"/>' +
    '<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="90" customWidth="1"/></cols>' +
    '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
}
const manifest: Record<string, string> = {
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>',
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Etsy Listing Draft" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>',
  'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
};

// ZIP stored method with CRC32 and little-endian local/central directory records.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStored(entries: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralLength = 0;
  for (const [name, text] of entries) {
    const filename = encoder.encode(name), payload = encoder.encode(text), checksum = crc32(payload);
    const local = new Uint8Array(30 + filename.length), h = new DataView(local.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true);
    h.setUint16(8, 0, true); h.setUint32(14, checksum, true);
    h.setUint32(18, payload.length, true); h.setUint32(22, payload.length, true);
    h.setUint16(26, filename.length, true); local.set(filename, 30);
    parts.push(local, payload);
    const c = new Uint8Array(46 + filename.length), v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true);
    v.setUint32(16, checksum, true); v.setUint32(20, payload.length, true); v.setUint32(24, payload.length, true);
    v.setUint16(28, filename.length, true); v.setUint32(42, offset, true); c.set(filename, 46);
    central.push(c); centralLength += c.length; offset += local.length + payload.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true); e.setUint32(12, centralLength, true);
  e.setUint32(16, offset, true);
  const size = offset + centralLength + end.length, out = new Uint8Array(size);
  let at = 0; for (const chunk of [...parts, ...central, end]) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export function createEtsyListingExcel(draft: EtsyListingDraft, selection?: unknown): Uint8Array {
  return zipStored([
    ['[Content_Types].xml', contentTypes()],
    ['_rels/.rels', manifest['_rels/.rels']],
    ['xl/workbook.xml', manifest['xl/workbook.xml']],
    ['xl/_rels/workbook.xml.rels', manifest['xl/_rels/workbook.xml.rels']],
    ['xl/styles.xml', manifest['xl/styles.xml']],
    ['xl/worksheets/sheet1.xml', sheetXml(draft, selection)],
  ]);
}
