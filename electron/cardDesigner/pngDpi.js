// Adds a pHYs chunk (physical pixel density) to a PNG so print and layout tools open it at its
// real size. Electron's nativeImage.toPNG() doesn't write one.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function withDpi(png, dpi) {
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data[8] = 1; // unit: metre
  const type = Buffer.from('pHYs', 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);

  // Drop any existing pHYs, then insert ours right after IHDR (which is always first).
  const parts = [SIGNATURE];
  let off = 8;
  let inserted = false;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const kind = png.toString('ascii', off + 4, off + 8);
    const end = off + 12 + len;
    if (kind !== 'pHYs') parts.push(png.subarray(off, end));
    if (kind === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    off = end;
  }
  return Buffer.concat(parts);
}

module.exports = { withDpi, crc32 };
