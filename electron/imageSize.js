// Pixel size of an image from its header bytes (PNG, JPEG, GIF, WebP), or from an SVG's
// viewBox / width / height, for the assets index. Returns { width, height } or null for
// anything else (fonts, damaged files).

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10 || b.toString('latin1', 0, 4) !== 'GIF8') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan data before a frame
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

// The <svg> start tag's viewBox (preferred: it is the drawing's shape) or width/height in plain
// numbers or px. Sizes in other units only give the aspect ratio, which is what symbols need.
function svgSize(b) {
  const head = b.subarray(0, 8192).toString('utf8');
  const m = /<svg\b[^>]*>/i.exec(head);
  if (!m) return null;
  const tag = m[0];
  const attr = (name) => {
    const a = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return a ? (a[2] ?? a[3]) : null;
  };
  const vb = attr('viewBox');
  if (vb) {
    const n = vb.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n[2] > 0 && n[3] > 0) return { width: n[2], height: n[3] };
  }
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const w = num(attr('width'));
  const h = num(attr('height'));
  return w && h ? { width: w, height: h } : null;
}

function imageSize(buf) {
  try {
    return pngSize(buf) || jpegSize(buf) || gifSize(buf) || webpSize(buf) || svgSize(buf);
  } catch {
    return null;
  }
}

module.exports = { imageSize, svgSize };
