const test = require('node:test');
const assert = require('node:assert');
const { createCanvas, loadImage } = require('canvas');
const { withDpi, crc32 } = require('../electron/cardDesigner/pngDpi');

test('crc32 matches the PNG reference value', () => {
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082);
});

test('withDpi writes one pHYs chunk after IHDR and the PNG still decodes', async () => {
  const c = createCanvas(3, 2);
  c.getContext('2d').fillRect(0, 0, 3, 2);
  const once = withDpi(c.toBuffer('image/png'), 300);
  const twice = withDpi(once, 600);
  for (const [buf, dpi] of [[once, 300], [twice, 600]]) {
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
    assert.equal(buf.toString('ascii', 37, 41), 'pHYs', 'right after IHDR');
    assert.equal(buf.toString('latin1').split('pHYs').length - 1, 1, 'exactly one pHYs');
    assert.equal(Math.round(buf.readUInt32BE(41) * 0.0254), dpi);
    const img = await loadImage(buf);
    assert.deepEqual([img.width, img.height], [3, 2]);
  }
  assert.throws(() => withDpi(Buffer.from('nope'), 300), /not a PNG/);
});
