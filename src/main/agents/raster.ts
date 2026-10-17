/** Read dimensions before allocating a decoded raster. The native decoder still validates the complete image. */
export function rasterSize(data: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.readUInt32BE(8) === 13 && data.toString('ascii', 12, 16) === 'IHDR') return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (mime === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    // A small extended canvas does not bound every later frame. Refuse before native decoding.
    if (kind === 'VP8X') return null;
    if (kind === 'VP8 ' && data[23] === 0x9d && data[24] === 1 && data[25] === 0x2a) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && data[20] === 0x2f) { const bits = data.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
  }
  if (mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    for (let n = 0; n < 1024 && at + 3 < data.length; n++) {
      if (data[at++] !== 0xff) return null;
      while (data[at] === 0xff) at++;
      const marker = data[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (at + 2 > data.length) return null;
      const length = data.readUInt16BE(at);
      if (length < 2 || at + length > data.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 7 ? { height: data.readUInt16BE(at + 3), width: data.readUInt16BE(at + 5) } : null;
      at += length;
    }
  }
  return null;
}
export function boundedRaster(data: Buffer, mime: string): { width: number; height: number } | null {
  const size = rasterSize(data, mime);
  return size && size.width >= 16 && size.height >= 16 && size.width <= 1024 && size.height <= 1024 ? size : null;
}
