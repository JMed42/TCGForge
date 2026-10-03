const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { LATEST_VERSION } = require('../electron/migrations');
const { imageSize } = require('../electron/imageSize');
const art = require('../electron/cardDesigner/art');

const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><circle cx="12" cy="8" r="7"/></svg>\n';

async function setup() {
  const dir = tempDir('library');
  await database.initDatabase(dir);
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const p = await ipc.call('createProject', { name: 'P' });
  const other = await ipc.call('createProject', { name: 'Other' });
  const icons = path.join(dir, 'projects', String(p.id), 'assets', 'icons');
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(icons, 'fire.svg'), SVG);
  const rule = await ipc.call('createDocument', p.id, { title: 'Burn', type: 'rule' });
  const foreignRule = await ipc.call('createDocument', other.id, { title: 'Elsewhere', type: 'rule' });
  return { dir, ipc, p, other, rule, foreignRule };
}

test('migration v7: library tables, project settings, card reminders', async () => {
  const { dir } = await setup();
  assert.equal(LATEST_VERSION, 7);
  const SQL = await require('sql.js')();
  const db = new SQL.Database(fs.readFileSync(path.join(dir, 'tcgforge.db')));
  const cols = (t) => db.exec(`PRAGMA table_info(${t})`)[0].values.map((r) => r[1]);
  assert.deepEqual(cols('symbols'), ['id', 'project_id', 'shortcode', 'rel_path', 'scale', 'baseline_offset', 'created_at']);
  assert.deepEqual(cols('keywords'), ['id', 'project_id', 'name', 'params_json', 'reminder_template', 'rule_ref', 'created_at', 'updated_at']);
  assert.ok(cols('variables').includes('key') && cols('projects').includes('settings') && cols('cards').includes('reminders'));
});

test('symbols: shortcode shape, unique per project, file inside the project', async () => {
  const { ipc, p, other } = await setup();
  let lib = await ipc.call('saveSymbol', p.id, { shortcode: '{fire}', rel_path: 'assets/icons/fire.svg' });
  assert.deepEqual(lib.symbols.map((s) => [s.shortcode, s.rel_path, s.scale, s.baseline_offset]), [['fire', 'assets/icons/fire.svg', 1, -0.12]]);
  await assert.rejects(() => ipc.call('saveSymbol', p.id, { shortcode: 'fire', rel_path: 'assets/icons/fire.svg' }), /already exists/);
  await assert.rejects(() => ipc.call('saveSymbol', p.id, { shortcode: 'two words', rel_path: 'assets/icons/fire.svg' }), /shortcode/);
  await assert.rejects(() => ipc.call('saveSymbol', p.id, { shortcode: 'x', rel_path: '../secret.png' }), /assets folder/);
  await assert.rejects(() => ipc.call('saveSymbol', p.id, { shortcode: 'x', rel_path: 'assets/icons/missing.png' }), /not found/);
  await assert.rejects(() => ipc.call('saveSymbol', p.id, { shortcode: 'x', rel_path: 'assets/icons/fire.svg', scale: 9 }), /size/);
  lib = await ipc.call('saveSymbol', p.id, { id: lib.symbols[0].id, shortcode: 'T', rel_path: 'assets/icons/fire.svg', scale: 1.2, baseline_offset: -0.2 });
  assert.deepEqual(lib.symbols.map((s) => [s.shortcode, s.scale, s.baseline_offset]), [['T', 1.2, -0.2]]);
  await assert.rejects(() => ipc.call('saveSymbol', other.id, { id: lib.symbols[0].id, shortcode: 'T', rel_path: 'assets/icons/fire.svg' }), /not in this project/);
});

test('keywords: names unique regardless of case, parameters, rule entry in the project', async () => {
  const { ipc, p, rule, foreignRule } = await setup();
  const lib = await ipc.call('saveKeyword', p.id, { name: 'Burn', params: [{ name: 'X', kind: 'number' }], reminder_template: '(Deal {{X}} damage.)', rule_ref: rule.id });
  assert.deepEqual(lib.keywords.map((k) => [k.name, k.params, k.rule_ref]), [['Burn', [{ name: 'X', kind: 'number' }], rule.id]]);
  await assert.rejects(() => ipc.call('saveKeyword', p.id, { name: 'burn' }), /already exists/);
  await assert.rejects(() => ipc.call('saveKeyword', p.id, { name: 'Ward', params: [{ name: 'x' }] }), /capital letter/);
  await assert.rejects(() => ipc.call('saveKeyword', p.id, { name: 'Ward', params: [{ name: 'X' }, { name: 'X' }] }), /twice/);
  await assert.rejects(() => ipc.call('saveKeyword', p.id, { name: 'Ward', rule_ref: foreignRule.id }), /rule entry/);
  await assert.rejects(() => ipc.call('saveKeyword', p.id, { name: '3 Burn' }), /starts with a letter/);
  // Deleting the rule entry clears the link, keeps the keyword
  await ipc.call('deleteDocument', rule.id);
  assert.equal((await ipc.call('getLibrary', p.id)).keywords[0].rule_ref, null);
});

test('variables and reminder settings', async () => {
  const { ipc, p } = await setup();
  let lib = await ipc.call('saveVariable', p.id, { key: 'HAND_SIZE', value: '7', description: 'Cards in hand' });
  assert.deepEqual(lib.variables.map((v) => [v.key, v.value]), [['HAND_SIZE', '7']]);
  await assert.rejects(() => ipc.call('saveVariable', p.id, { key: 'hand_size', value: '7' }), /UPPER_CASE/);
  await assert.rejects(() => ipc.call('saveVariable', p.id, { key: 'HAND_SIZE', value: '8' }), /already exists/);
  lib = await ipc.call('saveLibrarySettings', p.id, { reminders: { show: false, sets: { Core: true, Bad: 'x' } } });
  assert.deepEqual(lib.settings, { reminders: { show: false, sets: { Core: true } } });
  lib = await ipc.call('deleteLibraryItem', p.id, 'variable', lib.variables[0].id);
  assert.deepEqual(lib.variables, []);
});

test('a card\'s own reminder choice: stored as null / 1 / 0, kept by duplicate', async () => {
  const { ipc, p } = await setup();
  const c = await ipc.call('createCard', p.id, { name: 'A' });
  assert.equal(c.reminders, null);
  assert.equal((await ipc.call('updateCard', c.id, { reminders: 'hide' })).reminders, 0);
  assert.equal((await ipc.call('updateCard', c.id, { reminders: true })).reminders, 1);
  assert.equal((await ipc.call('duplicateCard', c.id)).reminders, 1);
  assert.equal((await ipc.call('updateCard', c.id, { reminders: null })).reminders, null);
});

test('rename everywhere: the item, card text and templates in one transaction, or nothing', async () => {
  const { ipc, p } = await setup();
  const lib = await ipc.call('saveKeyword', p.id, { name: 'Burn' });
  const card = await ipc.call('createCard', p.id, { name: 'A', rules_text: 'Burn 2.' });
  const tpl = database.insertTemplate(p.id, 'T', JSON.stringify({ schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 0 }, layers: [] }));
  const res = await ipc.call('renameLibraryItem', p.id, {
    change: { kind: 'keyword', id: lib.keywords[0].id, to: 'Scorch' },
    cards: [{ id: card.id, patch: { rules_text: 'Scorch 2.' } }],
    templates: [{ id: tpl.id, content: JSON.stringify({ schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 0 }, layers: [], name: 'renamed' }) }],
  });
  assert.equal(res.library.keywords[0].name, 'Scorch');
  assert.equal((await ipc.call('getCard', card.id)).rules_text, 'Scorch 2.');
  assert.equal(database.getTemplate(tpl.id).version, 2);
  // A bad part (a card of another project) changes nothing
  const otherCard = await ipc.call('createCard', (await ipc.call('createProject', { name: 'X' })).id, { name: 'Z' });
  await assert.rejects(() => ipc.call('renameLibraryItem', p.id, {
    change: { kind: 'keyword', id: lib.keywords[0].id, to: 'Ember' },
    cards: [{ id: card.id, patch: { rules_text: 'Ember 2.' } }, { id: otherCard.id, patch: { rules_text: 'x' } }],
  }), /not in this project/);
  assert.equal((await ipc.call('getLibrary', p.id)).keywords[0].name, 'Scorch');
  assert.equal((await ipc.call('getCard', card.id)).rules_text, 'Scorch 2.');
});

test('deleting a project removes its library; export and import carry it', async () => {
  const { ipc, p, rule } = await setup();
  await ipc.call('saveSymbol', p.id, { shortcode: 'fire', rel_path: 'assets/icons/fire.svg' });
  await ipc.call('saveKeyword', p.id, { name: 'Burn', params: [{ name: 'X', kind: 'number' }], reminder_template: '(Deal {{X}}.)', rule_ref: rule.id });
  await ipc.call('saveVariable', p.id, { key: 'HAND_SIZE', value: '7' });
  await ipc.call('saveLibrarySettings', p.id, { reminders: { show: false, sets: {} } });
  await ipc.call('updateCard', (await ipc.call('createCard', p.id, { name: 'A' })).id, { reminders: 0 });
  const json = await ipc.call('exportProject', p.id);
  const imported = await ipc.call('importProject', json);
  const lib = await ipc.call('getLibrary', imported.id);
  assert.deepEqual(lib.keywords.map((k) => k.name), ['Burn']);
  assert.notEqual(lib.keywords[0].rule_ref, rule.id, 'the link follows the copied rule entry');
  assert.equal((await ipc.call('getDocuments', imported.id)).find((d) => d.id === lib.keywords[0].rule_ref).title, 'Burn');
  assert.deepEqual(lib.variables.map((v) => v.key), ['HAND_SIZE']);
  assert.deepEqual(lib.symbols, [], 'the image file is not in the new project, so the symbol is skipped');
  assert.equal(lib.settings.reminders.show, false);
  assert.equal((await ipc.call('getCards', imported.id, {}))[0].reminders, 0);
  await ipc.call('deleteProject', p.id);
  for (const t of ['symbols', 'keywords', 'variables']) assert.equal(database.queryAll(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ?`, [p.id])[0].n, 0, t);
});

test('SVG images: size from the viewBox; imported into assets/icons', async () => {
  assert.deepEqual(imageSize(Buffer.from(SVG)), { width: 24, height: 16 });
  assert.deepEqual(imageSize(Buffer.from('<svg width="30px" height="10px"></svg>')), { width: 30, height: 10 });
  const dir = tempDir('svg');
  const src = path.join(dir, 'Bolt.svg');
  fs.writeFileSync(src, SVG);
  const rel = await art.importCardArt(dir, 1, src, { folder: 'icons' });
  assert.match(rel, /^assets\/icons\/bolt-[0-9a-f]{8}\.svg$/);
  fs.writeFileSync(src, '<html>not an svg</html>');
  await assert.rejects(() => art.importCardArt(dir, 1, src, { folder: 'icons' }), /not an SVG/);
});
