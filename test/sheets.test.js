const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const sheets = require('../electron/cardDesigner/sheets');
const database = require('../electron/database');
const { registerCardDesignerIpc } = require('../electron/cardDesigner/ipc');

const POKER = { cardWidthMm: (744 / 300) * 25.4, cardHeightMm: (1039 / 300) * 25.4 }; // 63 x 88 mm

test('cards per page for standard cards', () => {
  const table = {};
  for (const paper of ['letter', 'a4']) {
    for (const bleedMm of [0, 3]) {
      const l = sheets.layoutSheet({ paper, bleedMm, ...POKER });
      table[`${paper}/${bleedMm}`] = `${l.cols}x${l.rows} ${l.orientation}`;
    }
  }
  assert.deepEqual(table, {
    'letter/0': '3x3 portrait',
    'letter/3': '3x2 landscape',
    'a4/0': '3x3 portrait',
    'a4/3': '4x2 landscape',
  });
});

test('the grid is centred and slots are spaced by card + 2 x bleed', () => {
  const l = sheets.layoutSheet({ paper: 'a4', bleedMm: 3, ...POKER });
  const gridW = l.cols * l.cellWidthMm;
  assert.ok(Math.abs(l.originXMm * 2 + gridW - l.pageWidthMm) < 1e-9);
  const a = sheets.slotTrimMm(l, 0);
  const b = sheets.slotTrimMm(l, 1);
  assert.ok(Math.abs(b.x - a.x - (POKER.cardWidthMm + 6)) < 1e-9);
  assert.ok(Math.abs(a.x - (l.originXMm + 3)) < 1e-9, 'trim sits inside the bleed');
});

test('a card larger than the page reports zero per page', () => {
  const l = sheets.layoutSheet({ paper: 'letter', cardWidthMm: 300, cardHeightMm: 400 });
  assert.equal(l.perPage, 0);
});

function pdfInfo(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  const images = new Set([...text.matchAll(/\/Subtype \/Image/g)].map((m) => m.index)).size;
  return { pages: boxes.length, boxes, images };
}

test('exportPrintSheets writes pages at paper size, embedding each card once', async () => {
  const dir = tempDir('sheets');
  await database.initDatabase(dir);
  const db = fakeIpc();
  database.registerIpcHandlers(db.ipcMain);
  const ipc = fakeIpc();
  registerCardDesignerIpc(ipc.ipcMain, {
    userDataPath: dir, getCard: database.getCard, queryCards: database.queryCards,
    listTemplates: database.listTemplates, getTemplate: database.getTemplate, insertTemplate: database.insertTemplate,
    updateTemplate: database.updateTemplate, deleteTemplate: database.deleteTemplate,
    dialog: {}, shell: {}, getWindow: () => null,
  });
  const p = await db.call('createProject', { name: 'P' });
  for (const name of ['A', 'B', 'C', 'D']) await db.call('createCard', p.id, { name });
  const tpl = await ipc.call('createTemplate', p.id, 'T');

  const out = path.join(dir, 'a4.pdf');
  const res = await ipc.call('exportPrintSheets', p.id, tpl.id, { paper: 'a4', bleedMm: 3, copies: 3, outputPath: out });
  assert.equal(res.perPage, 8);
  assert.equal(res.pages, 2); // 4 cards x 3 copies = 12 slots
  const info = pdfInfo(out);
  assert.equal(info.pages, 2);
  for (const [, , w, h] of info.boxes) {
    assert.ok(Math.abs(w - 297 * sheets.MM_TO_PT) < 0.01 && Math.abs(h - 210 * sheets.MM_TO_PT) < 0.01, 'A4 landscape');
  }
  assert.equal(info.images, 4, 'one embedded image per card, not per copy');

  const letter = await ipc.call('exportPrintSheets', p.id, tpl.id, { paper: 'letter', bleedMm: 0, outputPath: path.join(dir, 'letter.pdf') });
  assert.equal(letter.perPage, 9);
  assert.equal(letter.pages, 1);
  const [, , w, h] = pdfInfo(path.join(dir, 'letter.pdf')).boxes[0];
  assert.ok(Math.abs(w - 612) < 0.01 && Math.abs(h - 792) < 0.01, 'Letter portrait 612 x 792 pt');
});
