const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { tempDir } = require('./helpers');
const { renderCard, outputSize, yieldToEventLoop } = require('../electron/cardDesigner/render');
const { toPng } = require('../electron/cardDesigner/exporters');
const { layoutText } = require('../electron/cardDesigner/textLayout');

const base = () => ({
  meta: { name: 'T', width: 744, height: 1039, dpi: 300 },
  cornerRadius: 24,
  background: { color: '#204060' },
  layers: [],
});

function solidPng(file, color, w = 40, h = 40) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];

test('bleed grows the canvas on every side and squares the corners', async () => {
  const tpl = base();
  const plain = await renderCard({}, tpl, { dpi: 300 });
  assert.deepEqual([plain.width, plain.height], [744, 1039]);
  assert.equal(pixel(plain.canvas, 0, 0)[3], 0, 'rounded corner is transparent without bleed');

  const bled = await renderCard({}, tpl, { dpi: 300, bleedMm: 3 });
  const b = (3 / 25.4) * 300; // 35.43 px
  assert.deepEqual([bled.width, bled.height], [Math.round(744 + 2 * b), Math.round(1039 + 2 * b)]);
  assert.deepEqual(pixel(bled.canvas, 0, 0), [0x20, 0x40, 0x60, 255], 'background fills the bleed corner');
  assert.deepEqual(outputSize(tpl, 300, 3), { width: bled.width, height: bled.height, scale: 1, bleed: b });
});

test('relative image paths resolve against the template folder, then the project folder', async () => {
  const projectDir = tempDir('assets');
  const templateDir = path.join(projectDir, 'templates');
  solidPng(path.join(templateDir, 'assets', 'frame.png'), '#ff0000');
  solidPng(path.join(projectDir, 'art', 'hero.png'), '#00ff00');
  const tpl = base();
  tpl.cornerRadius = 0;
  tpl.layers = [
    { id: 'frame', type: 'image', source: 'assets/frame.png', x: 0, y: 0, width: 100, height: 100, fit: 'stretch' },
    { id: 'art', type: 'image', source: '{{image_path}}', x: 200, y: 0, width: 100, height: 100, fit: 'stretch' },
  ];
  const r = await renderCard({ image_path: 'art/hero.png' }, tpl, { dpi: 300, templateDir, projectDir });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(pixel(r.canvas, 50, 50), [255, 0, 0, 255]);
  assert.deepEqual(pixel(r.canvas, 250, 50), [0, 255, 0, 255]);
});

test('the image cache picks up a changed file', async () => {
  const dir = tempDir('cache');
  const file = path.join(dir, 'art.png');
  solidPng(file, '#0000ff');
  const tpl = base();
  tpl.cornerRadius = 0;
  tpl.layers = [{ id: 'a', type: 'image', source: file, x: 0, y: 0, width: 50, height: 50, fit: 'stretch' }];
  const first = await renderCard({}, tpl, { dpi: 300 });
  assert.deepEqual(pixel(first.canvas, 10, 10), [0, 0, 255, 255]);
  solidPng(file, '#ffff00', 41, 40); // different size, so the cache key changes even if mtime doesn't
  const second = await renderCard({}, tpl, { dpi: 300 });
  assert.deepEqual(pixel(second.canvas, 10, 10), [255, 255, 0, 255]);
});

test('shrink stops at 6 pt physical by default, or at minFontSize', () => {
  const ctx = createCanvas(10, 10).getContext('2d');
  const long = 'word '.repeat(400);
  const box = { x: 0, y: 0, width: 200, height: 40 };
  const fontFor = (size) => `${size}px sans-serif`;
  const at300 = layoutText(ctx, long, box, { fontSize: 40, overflow: 'shrink', minSize: (6 * 300) / 72 }, fontFor);
  assert.equal(at300.fontSize, 25);
  const custom = layoutText(ctx, long, box, { fontSize: 40, overflow: 'shrink', minSize: 12 }, fontFor);
  assert.equal(custom.fontSize, 12);
});

test('renders stay byte-identical with the shared image cache', async () => {
  const dir = tempDir('det');
  solidPng(path.join(dir, 'templates', 'assets', 'bg.png'), '#336699', 64, 64);
  const tpl = base();
  tpl.background = { color: '#111111', image: 'assets/bg.png', fit: 'tile' };
  tpl.layers = [{ id: 't', type: 'text', value: '{{name}}', x: 20, y: 20, width: 400, height: 60, font: 'sans-serif', fontSize: 30, color: '#fff', overflow: 'shrink' }];
  const opts = { dpi: 192, templateDir: path.join(dir, 'templates'), projectDir: dir };
  const a = toPng((await renderCard({ name: 'Ember Drake' }, tpl, opts)).canvas);
  await yieldToEventLoop();
  const b = toPng((await renderCard({ name: 'Ember Drake' }, tpl, opts)).canvas);
  assert.ok(a.equals(b));
});
