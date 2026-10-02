const test = require('node:test');
const assert = require('node:assert');
const sheets = require('../electron/cardDesigner/sheets');

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

test('pages: copies are consecutive, items sit at the bleed box, marks only for used slots', () => {
  const l = sheets.layoutSheet({ paper: 'a4', bleedMm: 3, ...POKER });
  const pages = sheets.buildSheetPages(l, 10, (i) => ({ id: i }));
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.items.length), [8, 2]);
  const t0 = sheets.slotTrimMm(l, 0);
  assert.deepEqual([pages[0].items[0].xMm, pages[0].items[0].yMm], [t0.x - 3, t0.y - 3]);
  assert.equal(pages[1].items[1].card.id, 9);
  assert.ok(pages[1].marks.length < pages[0].marks.length, 'a partly filled page has fewer trim lines');
  assert.equal(sheets.buildSheetPages(l, 3, () => ({}), { cropMarks: false })[0].marks.length, 0);
});

test('single-card PDF page leaves room for crop marks', () => {
  const tpl = { size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3 } };
  const l = sheets.singleCardPage(tpl);
  assert.deepEqual([l.pageWidthMm, l.pageHeightMm], [63 + 6 + 10, 88 + 6 + 10]);
  const page = sheets.buildSheetPages(l, 1, () => ({}))[0];
  assert.deepEqual([page.items[0].xMm, page.items[0].yMm], [5, 5]);
  assert.equal(page.marks.length, 8);
});
