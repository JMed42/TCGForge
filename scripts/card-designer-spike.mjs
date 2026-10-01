// Phase 0 spike: headless render / fit / export check for the Card Designer renderer.
//   node --expose-gc scripts/card-designer-spike.mjs --out <dir>
// Writes PNG (96 + 300 dpi), PDF, fit-matrix renders and report.json into <dir>.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { renderCard, outputSize, yieldToEventLoop } = require('../electron/cardDesigner/render');
const { toPng, toJpeg, writePdf } = require('../electron/cardDesigner/exporters');
const { generateAssets } = require('../electron/cardDesigner/fixtures/generateAssets');
const { sampleCards } = require('../electron/cardDesigner/fixtures/sampleCards');
const standard = require('../electron/cardDesigner/fixtures/standard.json');
const fitMatrix = require('../electron/cardDesigner/fixtures/fit-matrix.json');

const argOut = process.argv.indexOf('--out');
const outDir = path.resolve(argOut > 0 ? process.argv[argOut + 1] : 'spike-out');
const templateDir = path.join(outDir, 'templates');
fs.mkdirSync(templateDir, { recursive: true });

const art = generateAssets(templateDir);
// Bundled-font path: register a font file under an alias family from assets/fonts.
const sysFont = 'C:\\Windows\\Fonts\\segoeprb.ttf';
if (fs.existsSync(sysFont)) fs.copyFileSync(sysFont, path.join(templateDir, 'assets', 'fonts', 'Scribe-Bold.ttf'));

const cards = sampleCards(art).map((c, i) => ({ id: i + 1, project_id: 1, ...c }));
const [full, noImage, overflow] = cards;

const edgeTemplate = JSON.parse(JSON.stringify(standard));
edgeTemplate.meta.name = 'Edge Cases';
edgeTemplate.layers.find((l) => l.id === 'card-name').font = 'NoSuchFont Pro Bold';
edgeTemplate.layers.push({ id: 'sparkle', type: 'sparkle', x: 0, y: 0, width: 10, height: 10, zIndex: 99 });

const report = { outDir, checks: {}, files: [], warnings: {} };
const save = (name, buf) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, buf);
  report.files.push(name);
  return file;
};
const time = async (fn) => { const t = process.hrtime.bigint(); const r = await fn(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

async function renderTo(name, card, template, dpi) {
  const [res, ms] = await time(() => renderCard(card, template, { dpi, templateDir }));
  await yieldToEventLoop();
  save(name, toPng(res.canvas, dpi));
  report.warnings[name] = res.warnings;
  return { ...res, ms };
}

// 1. Standard renders at both DPIs + PDF
const web = await renderTo('ember-drake-preview.png', full, standard, 96);
const print = await renderTo('ember-drake-print.png', full, standard, 300);
await writePdf(print.canvas, standard, path.join(outDir, 'ember-drake-print.pdf'), 300);
report.files.push('ember-drake-print.pdf');
save('ember-drake-print.jpg', toJpeg(print.canvas));
await renderTo('nameless-wanderer-print.png', noImage, standard, 300);
await renderTo('tidecaller-print.png', overflow, standard, 300);
await renderTo('edge-cases-print.png', full, edgeTemplate, 300);
await renderTo('fit-matrix-print.png', overflow, fitMatrix, 300);
await renderTo('fit-matrix-preview.png', overflow, fitMatrix, 96);

// 2. Sizes
const expectPrint = outputSize(standard, 300);
const expectWeb = outputSize(standard, 96);
report.checks.sizes = {
  print: `${print.width}x${print.height}`,
  web: `${web.width}x${web.height}`,
  pass: print.width === expectPrint.width && print.height === expectPrint.height
    && web.width === expectWeb.width && web.height === expectWeb.height,
  expected: { print: `${expectPrint.width}x${expectPrint.height}`, web: `${expectWeb.width}x${expectWeb.height}` },
};

// 3. Determinism: two independent renders, byte-identical PNGs
for (const [label, card, tpl] of [['standard', full, standard], ['fit-matrix', overflow, fitMatrix]]) {
  const a = toPng((await renderCard(card, tpl, { dpi: 300, templateDir })).canvas, 300);
  const b = toPng((await renderCard(card, tpl, { dpi: 300, templateDir })).canvas, 300);
  report.checks[`deterministic_${label}`] = a.equals(b);
}

// 4. Edge cases produced warnings rather than crashes
const edgeWarnings = report.warnings['edge-cases-print.png'];
report.checks.unknownLayerSkipped = edgeWarnings.some((w) => w.includes('unknown type "sparkle"'));
report.checks.fontFallback = edgeWarnings.some((w) => w.includes('NoSuchFont Pro Bold'));
report.checks.noImagePlaceholder = report.warnings['nameless-wanderer-print.png'].length === 0;
report.checks.bundledFontUsed = !report.warnings['fit-matrix-print.png'].some((w) => w.includes('Scribe'));

// 5. Timing: 50 cards at 300 dpi including PNG encode (sequential, single thread)
const [, batchMs] = await time(async () => {
  for (let i = 0; i < 50; i++) {
    const res = await renderCard(cards[i % cards.length], standard, { dpi: 300, templateDir });
    toPng(res.canvas, 300);
    await yieldToEventLoop();
  }
});
const [, warmMs] = await time(() => renderCard(full, standard, { dpi: 96, templateDir }));
report.checks.timing = {
  coldFirstRender96Ms: Math.round(web.ms),
  warmRender96Ms: Math.round(warmMs),
  singleRender300Ms: Math.round(print.ms),
  batch50At300dpiMs: Math.round(batchMs),
  pass: batchMs < 60000 && warmMs < 500 && print.ms < 500,
};

// 6. Memory: 200 sequential renders, RSS before vs after
const gc = globalThis.gc || (() => {});
gc();
const rssBefore = process.memoryUsage().rss;
for (let i = 0; i < 200; i++) {
  const res = await renderCard(cards[i % cards.length], standard, { dpi: 300, templateDir });
  toPng(res.canvas, 300);
  await yieldToEventLoop();
  if (i % 25 === 0) gc();
}
await yieldToEventLoop();
gc();
const rssAfter = process.memoryUsage().rss;
report.checks.memory = {
  rssBeforeMB: Math.round(rssBefore / 1048576),
  rssAfterMB: Math.round(rssAfter / 1048576),
  deltaMB: Math.round((rssAfter - rssBefore) / 1048576),
  gcExposed: Boolean(globalThis.gc),
  pass: Math.abs(rssAfter - rssBefore) < 50 * 1048576,
};

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 2));
console.log('warnings:', JSON.stringify(report.warnings, null, 2));
