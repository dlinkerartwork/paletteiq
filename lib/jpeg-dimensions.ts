/** Read JPEG SOF dimensions without decoding the full GPU image in a Worker. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const invalid = () => new Error('GPU server must return a valid JPEG thumbnail. Update paletteiq-server if it still returns PNG.');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw invalid();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalid();
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 8) throw invalid();
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (!width || !height) throw invalid();
      return { width, height };
    }
    offset += length;
  }
  throw invalid();
}
