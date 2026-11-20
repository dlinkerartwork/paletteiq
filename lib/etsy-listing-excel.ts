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
function cell(col: string, row: number, value: string, style = 0): string {
  return '<c r="' + col + row + '"' + (style ? ' s="' + style + '"' : '') +
    ' t="inlineStr"><is><t xml:space="preserve">' +
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
/** Excel's A..Z, AA.. column naming for all selected SEO fields. */
function columnName(zeroBased: number): string {
  let n = zeroBased + 1, name = '';
  do { n--; name = String.fromCharCode(65 + n % 26) + name; n = Math.floor(n / 26); }
  while (n > 0);
  return name;
}
const columnWidths: Record<string, number> = {
  title: 56, description: 68, tags: 32, imageAltTexts: 54,
  primaryKeyword: 30, secondaryKeywords: 38, longTailKeywords: 42,
  categorySuggestion: 32, attributes: 38, materials: 30,
  photoPlan: 40, priceSuggestion: 28, sku: 24,
  digitalFiles: 40, licenseNotes: 42,
};
function sheetXml(draft: EtsyListingDraft, selection: unknown): string {
  const entries = selectedSeoExportFields(selection);
  const lastColumn = columnName(Math.max(0, entries.length - 1));
  // One listing = one data row. Headers span the first row horizontally
  // so the workbook can be used alongside other spreadsheet listings.
  const header = entries.length
    ? entries.map((key, index) => cell(columnName(index), 1, fields[key], 1)).join('')
    : cell('A', 1, 'No fields selected', 1);
  const values = entries.length
    ? entries.map((key, index) => cell(columnName(index), 2, stringify(draft[key]), 2)).join('')
    : cell('A', 2, '', 2);
  const cols = entries.length
    ? entries.map((key, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) +
      '" width="' + (columnWidths[key] || 28) + '" customWidth="1"/>').join('')
    : '<col min="1" max="1" width="30" customWidth="1"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:' + lastColumn + '2"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="16"/>' +
    '<cols>' + cols + '</cols>' +
    '<sheetData><row r="1" ht="28" customHeight="1">' + header + '</row>' +
    '<row r="2" ht="156" customHeight="1">' + values + '</row></sheetData>' +
    (entries.length ? '<autoFilter ref="A1:' + lastColumn + '2"/>' : '') +
    '</worksheet>';
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
    '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font>' +
    '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF24476D"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs></styleSheet>',
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
