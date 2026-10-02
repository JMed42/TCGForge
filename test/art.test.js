const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { tempDir } = require('./helpers');
const art = require('../electron/cardDesigner/art');

function png(file, color, w = 300, h = 200) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
}

test('importing art copies it into the project and dedupes by content', async () => {
  const userData = tempDir('art');
  const src = png(path.join(tempDir('src'), 'Ember Drake (final).png'), '#ff8800');
  const rel = await art.importCardArt(userData, 3, src);
  assert.match(rel, /^assets\/art\/ember_drake_final-[0-9a-f]{8}\.png$/);
  assert.ok(fs.existsSync(path.join(userData, 'projects', '3', ...rel.split('/'))));
  assert.equal(await art.importCardArt(userData, 3, src), rel, 'same content, same file');
  fs.unlinkSync(src);
  assert.ok(fs.existsSync(path.join(userData, 'projects', '3', ...rel.split('/'))), 'copy survives the original being deleted');
});

test('non-images are rejected', async () => {
  const userData = tempDir('art-bad');
  const dir = tempDir('src-bad');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'fake.png'), 'not really a png');
  await assert.rejects(() => art.importCardArt(userData, 1, path.join(dir, 'notes.txt')), /unsupported image type/);
  await assert.rejects(() => art.importCardArt(userData, 1, path.join(dir, 'fake.png')));
  assert.ok(!fs.existsSync(path.join(userData, 'projects', '1', 'assets')), 'nothing copied');
});

test('thumbnails are small and report the original size', async () => {
  const userData = tempDir('thumb');
  const rel = await art.importCardArt(userData, 1, png(path.join(tempDir('s'), 'big.png'), '#123456', 1200, 900));
  const t = await art.thumbnail(userData, 1, rel);
  assert.deepEqual([t.width, t.height], [1200, 900]);
  assert.ok(t.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(await art.thumbnail(userData, 1, 'assets/art/missing.png'), null);
  assert.equal(await art.thumbnail(userData, 1, 'secrets.txt'), null, 'only image paths are read');
});
