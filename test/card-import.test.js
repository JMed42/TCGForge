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

// A project model like the user's: a Unit type with cost, atk and effect; a Spell type.
const MODEL = {
  fields: [
    { key: 'cost', label: 'Cost', kind: 'number' }, { key: 'atk', label: 'ATK', kind: 'number' },
    { key: 'effect', label: 'Effect', kind: 'longText' }, { key: 'rules_text', label: 'Card text', kind: 'longText' },
  ],
  types: [{ id: 1, name: 'Unit', field_keys: ['cost', 'atk', 'effect'] }, { id: 2, name: 'Spell', field_keys: ['cost', 'effect'] }],
};

test('suggestMapping: card type column, library fields by label, aliases, new fields', () => {
  const table = cardImport.toTable([
    ['Card Name', 'Type', 'ATK', 'Effect', 'Attunement Cost', 'Text', 'Art Credit', 'Column H', 'Cost'],
    ['Knight', 'Unit', '3', 'x', '2', 'y', 'z', '', '1'],
    ['Bolt', 'Spell', '', 'x', '', '', '', '', '1'],
  ]);
  assert.deepEqual(cardImport.suggestMapping(table, MODEL), [
    'name', 'card_type', 'atk', 'effect', 'new:attunement_cost', 'rules_text', 'new:art_credit', 'ignore', 'cost',
  ]);
  const mtg = cardImport.toTable([['Name', 'Type'], ['Ember Drake', 'Creature \u2014 Dragon']]);
  assert.deepEqual(cardImport.suggestMapping(mtg, MODEL), ['name', 'new:type'], 'a "Type" column of type lines is not the card type');
  assert.deepEqual(cardImport.suggestMapping(cardImport.toTable([['Name', 'Title']]), MODEL), ['name', 'ignore'], 'a field is mapped once');
});

test('buildPlan: types from a column (new ones created), fields added to types, kinds guessed', () => {
  const table = cardImport.toTable([
    ['Name', 'Card Type', 'ATK', 'Attunement Cost', 'Flying', 'Tags'],
    ['Knight', 'Unit', '3', '', 'TRUE', 'a; b'],
    ['Sword', 'Equipment', '', '2', 'FALSE', ''],
    ['Bolt', 'Spell', '', '', '', ''],
    ['', 'Unit', '1', '', '', ''],
    ['knight', 'Unit', '9', '', '', ''],
    ['', '', '', '', '', ''],
  ]);
  const mapping = ['name', 'card_type', 'atk', 'new:attunement_cost', 'new:flying', 'new:tags'];
  const existing = [{ id: 7, name: 'Bolt', card_type_id: 2, custom_fields: '{"lore":"old"}' }];
  const plan = cardImport.buildPlan(table, mapping, existing, MODEL, { typeId: 1 });
  assert.deepEqual(plan.counts, { create: 2, update: 1, skip: 2, empty: 1 });
  assert.deepEqual(plan.newTypes, ['Equipment']);
  assert.deepEqual(plan.newFields.map((f) => [f.key, f.kind]), [['attunement_cost', 'number'], ['flying', 'yesNo'], ['tags', 'tags']]);
  const [knight, sword, bolt] = plan.rows;
  assert.equal(knight.data.card_type_id, 1);
  assert.deepEqual(knight.data.custom_fields, { atk: '3', flying: true });
  assert.deepEqual(knight.data.tags, ['a', 'b']);
  assert.equal(sword.data.card_type_name, 'Equipment');
  assert.deepEqual(sword.data.custom_fields, { attunement_cost: '2', flying: false });
  assert.equal(bolt.action, 'update');
  assert.equal(bolt.data.card_type_id, 2);
  assert.deepEqual(plan.rows[3].problems, ['no card name']);
  assert.deepEqual(plan.rows[4].problems, ['same name as row 2']);
  const adds = Object.fromEntries(plan.typeFieldAdds.map((a) => [a.typeId || a.typeName, a.keys.sort()]));
  assert.deepEqual(adds, { 1: ['flying', 'tags'], Equipment: ['attunement_cost', 'flying'] }, 'Spell gets nothing: its row fills no new field');
  assert.throws(() => cardImport.buildPlan(table, ['card_type', 'ignore', 'atk', 'ignore', 'ignore', 'ignore'], [], MODEL), /card name/);
  assert.throws(() => cardImport.buildPlan(table, ['name', 'card_type', 'card_type', 'ignore', 'ignore', 'ignore'], [], MODEL), /two columns/);
  assert.throws(() => cardImport.buildPlan(table, ['name', 'hp', 'ignore', 'ignore', 'ignore', 'ignore'], [], MODEL), /unknown field/);
  const strict = cardImport.buildPlan(table, mapping, [], MODEL, { createTypes: false, addFieldsToTypes: false });
  assert.deepEqual(strict.rows[1].problems, ['no card type "Equipment"']);
  assert.match(strict.rows[0].notes[0], /Unit doesn't use flying, tags/);
});

test('toTable without a header row names columns by letter', () => {
  assert.deepEqual(cardImport.toTable([['a', 'b'], ['c']], false), { headers: ['Column A', 'Column B'], rows: [['a', 'b'], ['c', '']], firstRow: 1 });
});

// ----- IPC end to end -----

test('import IPC: read, change sheet, preview, commit once; new types and fields land in the model', async () => {
  const dir = tempDir('import');
  await database.initDatabase(dir);
  const db = fakeIpc();
  database.registerIpcHandlers(db.ipcMain);
  const ipc = fakeIpc();
  const model = database.getCardModelApi();
  registerImportIpc(ipc.ipcMain, { queryCards: database.queryCards, getCardModel: (pid) => model.getModel(pid), importCards: database.importCards, dialog: {}, getWindow: () => null });
  const p = await db.call('createProject', { name: 'P', starter: 'blank' });
  await db.call('createCard', p.id, { name: 'Ember Drake', cost: '5', custom_fields: { artist: 'Procedural' } });

  const file = path.join(dir, 'set.xlsx');
  fs.writeFileSync(file, xlsx([
    { name: 'Readme', rows: [['ignore me']] },
    { name: 'Cards', rows: [['Name', 'Card Type', 'Cost', 'Element', 'Rules'], ['Ember Drake', '', 6, 'Fire', ''], ['Tide Caller', 'Unit', 3, 'Water', 'Draw a card.']] },
  ]));
  const first = await ipc.call('readSpreadsheet', p.id, { inputPath: file });
  assert.equal(first.kind, 'xlsx');
  assert.deepEqual(first.sheets, ['Readme', 'Cards']);
  const read = await ipc.call('readSpreadsheet', p.id, { token: first.token, sheet: 'Cards' });
  assert.deepEqual(read.headers, ['Name', 'Card Type', 'Cost', 'Element', 'Rules']);
  assert.deepEqual(read.suggestedMapping, ['name', 'card_type', 'cost', 'new:element', 'rules_text']);

  const preview = await ipc.call('previewImport', read.token, read.suggestedMapping, {});
  assert.deepEqual(preview.counts, { create: 1, update: 1, skip: 0, empty: 0 });
  assert.deepEqual(preview.newTypes, ['Unit']);
  assert.deepEqual(preview.newFields.map((f) => f.key), ['element']);
  assert.equal(database.queryCards(p.id).length, 1, 'preview writes nothing');

  const res = await ipc.call('commitImport', read.token, read.suggestedMapping, {});
  assert.deepEqual(res, { created: 1, updated: 1, newTypes: 1, newFields: 1, skipped: 0, empty: 0 });
  const cards = database.queryCards(p.id);
  const ember = cards.find((c) => c.name === 'Ember Drake');
  assert.equal(ember.cost, '6');
  assert.deepEqual(JSON.parse(ember.custom_fields), { artist: 'Procedural', element: 'Fire' });
  assert.equal(ember.card_type, 'Card', 'an update without a type cell keeps its type');
  const tide = cards.find((c) => c.name === 'Tide Caller');
  assert.equal(tide.card_type, 'Unit');
  assert.equal(tide.rules_text, 'Draw a card.');
  const m = model.getModel(p.id);
  assert.deepEqual(m.types.map((t) => [t.name, t.field_keys]), [['Card', ['cost', 'rules_text', 'image_path', 'element']], ['Unit', ['cost', 'element', 'rules_text']]]);
  await assert.rejects(() => ipc.call('commitImport', read.token, read.suggestedMapping, {}), /expired/);

  const csvFile = path.join(dir, 'more.csv');
  fs.writeFileSync(csvFile, 'Name;Cost\n"Ash, the Elder";4\n');
  const csv = await ipc.call('readSpreadsheet', p.id, { inputPath: csvFile });
  assert.deepEqual([csv.kind, csv.headers, csv.sampleRows], ['csv', ['Name', 'Cost'], [['Ash, the Elder', '4']]]);
  await assert.rejects(() => ipc.call('readSpreadsheet', p.id, { inputPath: path.join(dir, 'old.xls') }), /ENOENT|not supported/);
});

// ----- files saved by Excel 16 (test/fixtures) -----

test('a workbook saved by Excel: sheets, formulas, line breaks and date formats', () => {
  const wb = readXlsx(fs.readFileSync(path.join(__dirname, 'fixtures', 'ashfall.xlsx')));
  assert.deepEqual(wb.sheetNames, ['Notes', 'Cards']);
  const rows = wb.readSheet('Cards');
  assert.deepEqual(rows[0], ['Card Name', 'Type', 'Rarity', 'Cost', 'ATK', 'HP', 'Text', 'Flavour', 'Faction', 'Keywords', 'Release']);
  assert.equal(rows[1][1], 'Creature \u2014 Dragon');
  assert.match(rows[1][6], /^Flying\.\r?\nWhen Ember Drake/);
  assert.equal(rows[1][10], '2026-01-01', 'date-formatted serial becomes an ISO date');
  assert.equal(rows[4][3], '5', 'formula cell gives its cached value');
  const table = cardImport.toTable(rows);
  const mapping = cardImport.suggestMapping(table, { fields: [], types: [] });
  assert.deepEqual(mapping, ['name', 'new:type', 'new:rarity', 'new:cost', 'new:atk', 'new:hp', 'new:rules_text', 'new:flavor_text', 'new:faction', 'new:tags', 'new:release']);
  const plan = cardImport.buildPlan(table, mapping, [], { fields: [], types: [{ id: 1, name: 'Card', field_keys: [] }] });
  assert.deepEqual(plan.counts, { create: 4, update: 0, skip: 2, empty: 0 });
  assert.deepEqual(Object.fromEntries(plan.newFields.map((f) => [f.key, f.kind])).atk, 'number');
  assert.equal(plan.rows[0].data.rules_text, 'Flying.\nWhen Ember Drake enters play, deal 2 damage to each opposing creature.');
});

test('the same sheet saved by Excel as CSV (Windows-1252) reads the same', () => {
  const { delimiter, rows } = readCsv(fs.readFileSync(path.join(__dirname, 'fixtures', 'ashfall-cards.csv')));
  assert.equal(delimiter, ',');
  assert.equal(rows[1][1], 'Creature \u2014 Dragon');
  assert.equal(rows[3][7], 'Caf\u00e9 songs at low tide.');
  assert.equal(rows[1][10], '2026-01-01');
});
