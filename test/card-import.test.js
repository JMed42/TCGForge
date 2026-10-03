const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const { zip, xlsx } = require('./xlsxFixture');
const { parseCsv, readCsv, detectDelimiter, decode } = require('../electron/import/csv');
const { readXlsx, colIndex } = require('../electron/import/xlsx');
const cardImport = require('../electron/import/cardImport');
const database = require('../electron/database');
const { registerImportIpc } = require('../electron/import/ipc');

// ----- CSV -----

test('csv: quotes, doubled quotes, line breaks in quotes, CRLF and a missing final newline', () => {
  const text = 'name,rules\r\n"Ember, Drake","Deal 2.\nThen ""scry"" 1."\r\nPlain,ok';
  assert.deepEqual(parseCsv(text), [['name', 'rules'], ['Ember, Drake', 'Deal 2.\nThen "scry" 1.'], ['Plain', 'ok']]);
  assert.deepEqual(parseCsv('a,b\n\n'), [['a', 'b'], ['']], 'blank line is a row with one empty cell');
  assert.deepEqual(parseCsv('a,,c\n'), [['a', '', 'c']]);
});

test('csv: delimiter detection ignores delimiters inside quotes', () => {
  assert.equal(detectDelimiter('name;cost\n"A, B";3'), ';');
  assert.equal(detectDelimiter('name\tcost\nA\t3'), '\t');
  assert.equal(detectDelimiter('"a;b;c",d\n'), ',');
  assert.equal(detectDelimiter('single'), ',');
});

test('csv: UTF-8 with BOM, Windows-1252 fallback, UTF-16 with BOM', () => {
  assert.equal(decode(Buffer.from('﻿Café', 'utf8')), 'Café');
  assert.equal(decode(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x51, 0x94])), 'Café “Q”');
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name\tcost\nÉlan\t2', 'utf16le')]);
  assert.deepEqual(readCsv(u16), { delimiter: '\t', rows: [['name', 'cost'], ['Élan', '2']] });
});

// ----- XLSX -----

test('xlsx: shared and inline strings, numbers, booleans, formulas, rich text and gaps', () => {
  const buf = xlsx([
    { name: 'Cards', rows: [
      ['Name', 'Cost', 'Flying', 'Text', 'Total'],
      ['Ember Drake', 5, true, { inline: 'Deal 2 & scry <1>' }, { formula: 'B2*2', value: 10 }],
      null, // an empty row
      [{ rich: ['Tide', 'caller'] }, 0.30000000000000004, false, null, null, 'far'],
    ] },
    { name: 'Notes', rows: [['just', 'notes']] },
  ]);
  const wb = readXlsx(buf);
  assert.deepEqual(wb.sheetNames, ['Cards', 'Notes']);
  assert.deepEqual(wb.readSheet('Cards'), [
    ['Name', 'Cost', 'Flying', 'Text', 'Total'],
    ['Ember Drake', '5', 'TRUE', 'Deal 2 & scry <1>', '10'],
    [],
    ['Tidecaller', '0.30000000000000004', 'FALSE', '', '', 'far'],
  ]);
  assert.deepEqual(wb.readSheet(1), [['just', 'notes']]);
  assert.equal(colIndex('AA12'), 26);
});

test('xlsx: stored (uncompressed) entries work too', () => {
  const files = [];
  const real = xlsx([{ name: 'S', rows: [['a']] }]);
  // Re-pack as stored by reading every entry through the reader's zip layer.
  const { readZip } = require('../electron/import/xlsx');
  const z = readZip(real);
  for (const n of z.names) files.push([n, z.read(n)]);
  assert.deepEqual(readXlsx(zip(files, { store: true })).readSheet(0), [['a']]);
});

test('xlsx: hostile and broken files are refused', () => {
  assert.throws(() => readXlsx(Buffer.from('not a zip at all')), /not an \.xlsx/);
  assert.throws(() => readXlsx(zip([['hello.txt', 'hi']])), /not an \.xlsx workbook/);
  // A 300 MB sheet of zeros compresses to ~300 KB: refused while inflating.
  const bomb = Buffer.alloc(300 * 1024 * 1024, 0x30);
  const wb = xlsx([{ name: 'S', rows: [['a']] }]);
  const z = require('../electron/import/xlsx').readZip(wb);
  const files = z.names.map((n) => [n, n.endsWith('sheet1.xml') ? bomb : z.read(n)]);
  assert.throws(() => readXlsx(zip(files)).readSheet(0), /too large/);
  // Traversal-looking names are only looked up, never written; a workbook pointing at one fails cleanly.
  const evil = z.names.map((n) => [n === 'xl/worksheets/sheet1.xml' ? '../../evil.xml' : n, z.read(n)]);
  assert.throws(() => readXlsx(zip(evil)).readSheet(0), /missing from the file/);
});

// ----- mapping and plan -----

test('suggestMapping: exact names, existing custom fields, aliases, new custom keys', () => {
  const headers = ['Card Name', 'Type', 'ATK', 'HP', 'Text', 'Faction', 'Art Credit', 'Set', 'Column D', '42 Things'];
  assert.deepEqual(cardImport.suggestMapping(headers, ['faction']), [
    'name', 'type', 'power', 'toughness', 'rules_text', 'custom:faction', 'custom:art_credit', 'set_name', 'ignore', 'custom:f_42_things',
  ]);
  assert.deepEqual(cardImport.suggestMapping(['Name', 'Title']), ['name', 'ignore'], 'a field is mapped once');
});

test('buildPlan: create, update by name, duplicates, missing names, tags, custom fields', () => {
  const table = cardImport.toTable([
    ['Name', 'Cost', 'Tags', 'Faction', 'Unused'],
    ['Ember Drake', '6', 'dragon; fire', 'Ember', 'x'],
    ['New Card', '', 'a,b', '', ''],
    ['', '1', '', '', ''],
    ['new card', '2', '', '', ''],
    ['', '', '', '', ''],
  ]);
  const existing = [{ id: 7, name: 'Ember Drake', custom_fields: '{"artist":"Procedural","faction":"Old"}' }];
  const { rows, counts } = cardImport.buildPlan(table, ['name', 'cost', 'tags', 'custom:faction', 'ignore'], existing);
  assert.deepEqual(counts, { create: 1, update: 1, skip: 2, empty: 1 });
  assert.deepEqual(rows[0], {
    line: 2, action: 'update', cardId: 7, name: 'Ember Drake', problems: [],
    data: { name: 'Ember Drake', cost: '6', tags: ['dragon', 'fire'], custom_fields: { artist: 'Procedural', faction: 'Ember' } },
  });
  assert.deepEqual(rows[1].data, { name: 'New Card', tags: ['a', 'b'] }, 'blank cells are left out');
  assert.deepEqual(rows[2].problems, ['no card name']);
  assert.deepEqual([rows[3].action, rows[3].problems], ['skip', ['same name as row 3']]);
  assert.throws(() => cardImport.buildPlan(table, ['cost', 'ignore', 'ignore', 'ignore', 'ignore']), /card name/);
  assert.throws(() => cardImport.buildPlan(table, ['name', 'name', 'ignore', 'ignore', 'ignore']), /two columns/);
  assert.throws(() => cardImport.buildPlan(table, ['name', 'custom:bad key', 'ignore', 'ignore', 'ignore']), /not a valid field name/);
  const noMatch = cardImport.buildPlan(table, ['name', 'cost', 'tags', 'custom:faction', 'ignore'], existing, { matchBy: 'none' });
  assert.equal(noMatch.rows[0].action, 'create');
});

test('toTable without a header row names columns by letter', () => {
  assert.deepEqual(cardImport.toTable([['a', 'b'], ['c']], false), { headers: ['Column A', 'Column B'], rows: [['a', 'b'], ['c', '']], firstRow: 1 });
});

// ----- IPC end to end -----

test('import IPC: read, change sheet, preview, commit once', async () => {
  const dir = tempDir('import');
  await database.initDatabase(dir);
  const db = fakeIpc();
  database.registerIpcHandlers(db.ipcMain);
  const ipc = fakeIpc();
  registerImportIpc(ipc.ipcMain, { queryCards: database.queryCards, getProject: database.getProject, importCards: database.importCards, dialog: {}, getWindow: () => null });
  const p = await db.call('createProject', { name: 'P', cardSchema: { fields: [{ name: 'element', type: 'text' }] } });
  await db.call('createCard', p.id, { name: 'Ember Drake', cost: '5', custom_fields: { artist: 'Procedural' } });

  const file = path.join(dir, 'set.xlsx');
  fs.writeFileSync(file, xlsx([
    { name: 'Readme', rows: [['ignore me']] },
    { name: 'Cards', rows: [['Name', 'Cost', 'Element', 'Rules'], ['Ember Drake', 6, 'Fire', ''], ['Tide Caller', 3, 'Water', 'Draw a card.']] },
  ]));
  const first = await ipc.call('readSpreadsheet', p.id, { inputPath: file });
  assert.equal(first.kind, 'xlsx');
  assert.deepEqual(first.sheets, ['Readme', 'Cards']);
  assert.equal(first.sheet, 'Readme');
  const read = await ipc.call('readSpreadsheet', p.id, { token: first.token, sheet: 'Cards' });
  assert.deepEqual(read.headers, ['Name', 'Cost', 'Element', 'Rules']);
  assert.deepEqual(read.suggestedMapping, ['name', 'cost', 'custom:element', 'rules_text']);
  assert.ok(read.customFields.includes('element') && read.customFields.includes('artist'));
  assert.equal(read.rowCount, 2);

  const preview = await ipc.call('previewImport', read.token, read.suggestedMapping, {});
  assert.deepEqual(preview.counts, { create: 1, update: 1, skip: 0, empty: 0 });
  assert.equal(database.queryCards(p.id).length, 1, 'preview writes nothing');

  const res = await ipc.call('commitImport', read.token, read.suggestedMapping, {});
  assert.deepEqual(res, { created: 1, updated: 1, skipped: 0, empty: 0 });
  const cards = database.queryCards(p.id);
  const ember = cards.find((c) => c.name === 'Ember Drake');
  assert.equal(ember.cost, '6');
  assert.deepEqual(JSON.parse(ember.custom_fields), { artist: 'Procedural', element: 'Fire' });
  const tide = cards.find((c) => c.name === 'Tide Caller');
  assert.equal(tide.rules_text, 'Draw a card.');
  await assert.rejects(() => ipc.call('commitImport', read.token, read.suggestedMapping, {}), /expired/);

  const csvFile = path.join(dir, 'more.csv');
  fs.writeFileSync(csvFile, 'Name;Cost\n"Ash, the Elder";4\n');
  const csv = await ipc.call('readSpreadsheet', p.id, { inputPath: csvFile });
  assert.deepEqual([csv.kind, csv.headers, csv.sampleRows], ['csv', ['Name', 'Cost'], [['Ash, the Elder', '4']]]);
  await assert.rejects(() => ipc.call('readSpreadsheet', p.id, { inputPath: path.join(dir, 'old.xls') }), /ENOENT|not supported/);
});
