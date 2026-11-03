// Streaming ZIP (store method, data descriptors). Files never need to fit in RAM at once.
export type ZipEntry = { name: string; stream: () => Promise<ReadableStream<Uint8Array> | null> };
const encoder = new TextEncoder();
const u16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
const u32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
const crcUpdate = (crc: number, bytes: Uint8Array) => { let c = crc; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return c >>> 0; };

export function zipStream(entries: ZipEntry[]) {
  async function* chunks() {
      let offset = 0;
      const central: Uint8Array[] = [];
      const advance = (bytes: Uint8Array) => { offset += bytes.byteLength; return bytes; };
        for (const entry of entries) {
          const stream = await entry.stream();
          if (!stream) throw new Error(`Missing source file: ${entry.name}`);
          const name = encoder.encode(entry.name);
          const start = offset;
          const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
          u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x808); u16(lv, 8, 0); u16(lv, 10, 0); u16(lv, 12, 33); u16(lv, 26, name.length); local.set(name, 30); yield advance(local);
          let crc = 0xffffffff; let size = 0;
          const reader = stream.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 0xffffffff || offset + value.byteLength > 0xffffffff) throw new Error('ZIP exceeds 4 GB limit.');
              crc = crcUpdate(crc, value); yield advance(value);
            }
          } finally { reader.releaseLock(); }
          crc = (crc ^ 0xffffffff) >>> 0;
          const descriptor = new Uint8Array(16); const dv = new DataView(descriptor.buffer);
          u32(dv, 0, 0x08074b50); u32(dv, 4, crc); u32(dv, 8, size); u32(dv, 12, size); yield advance(descriptor);
          const header = new Uint8Array(46 + name.length); const cv = new DataView(header.buffer);
          u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x808); u16(cv, 10, 0); u16(cv, 12, 0); u16(cv, 14, 33);
          u32(cv, 16, crc); u32(cv, 20, size); u32(cv, 24, size); u16(cv, 28, name.length); u32(cv, 42, start); header.set(name, 46); central.push(header);
        }
        const centralOffset = offset;
        for (const header of central) yield advance(header);
        const footer = new Uint8Array(22); const fv = new DataView(footer.buffer);
        u32(fv, 0, 0x06054b50); u16(fv, 8, central.length); u16(fv, 10, central.length); u32(fv, 12, offset - centralOffset); u32(fv, 16, centralOffset); yield advance(footer);
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) { try { const { value, done } = await iterator.next(); if (done) controller.close(); else controller.enqueue(value); } catch (error) { controller.error(error); } },
    async cancel() { await iterator.return(); },
  });
}
