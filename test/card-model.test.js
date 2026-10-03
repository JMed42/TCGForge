const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { LATEST_VERSION } = require('../electron/migrations');
const { keyFromLabel, inferKind } = require('../electron/cardModel');

async function setup({ starter } = {}) {
  const dir = tempDir('model');
  await database.initDatabase(dir);
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const p = await ipc.call('createProject', { name: 'Arsenal', starter });
  return { dir, ipc, p };
}

test('helpers: keys from labels and kinds from values', () => {
  assert.equal(keyFromLabel('Action Rating'), 'action_rating');
  assert.equal(keyFromLabel('2nd Cost!'), 'f_2nd_cost');
  assert.equal(keyFromLabel('Attunement   cost'), 'attunement_cost');
  assert.equal(inferKind(['1', '2', '']), 'number');
  assert.equal(inferKind(['a\nb']), 'longText');
  assert.equal(inferKind([true, false]), 'yesNo');
  assert.equal(inferKind(['Fire', '2']), 'text');
});

test('new projects start with a type: classic (standard fields) or blank (cost, card text, art)', async () => {
  const { ipc, p } = await setup();
  const m = await ipc.call('getCardModel', p.id);
  assert.deepEqual(m.types.map((t) => t.name), ['Card']);
  assert.ok(m.types[0].field_keys.includes('power') && m.types[0].field_keys.includes('rules_text'));
  assert.equal(m.fields.find((f) => f.key === 'rules_text').label, 'Card text');
  const blank = await ipc.call('createProject', { name: 'B', starter: 'blank' });
  const mb = await ipc.call('getCardModel', blank.id);
  assert.deepEqual(mb.types[0].field_keys, ['cost', 'rules_text', 'image_path']);
  assert.equal(mb.fields.find((f) => f.key === 'cost').kind, 'number');
});

test('fields and types: create, validate, defaults on new cards, joined card rows', async () => {
  const { ipc, p } = await setup({ starter: 'blank' });
  let r = await ipc.call('saveCardField', p.id, { label: 'ATK', kind: 'number', create: true });
  assert.equal(r.key, 'atk');
  await ipc.call('saveCardField', p.id, { label: 'Action Rating', kind: 'choice', options: ['A', 'B', 'B', ' '], default_value: 'B', create: true });
  await ipc.call('saveCardField', p.id, { label: 'Flying', kind: 'yesNo', default_value: 'true', create: true });
  await assert.rejects(() => ipc.call('saveCardField', p.id, { label: 'ATK', create: true }), /already exists/);
  await assert.rejects(() => ipc.call('saveCardField', p.id, { label: 'Name', create: true }), /reserved/);
  await assert.rejects(() => ipc.call('saveCardField', p.id, { key: 'tags', label: 'Tags', kind: 'number', create: true }), /can't be number/);
  r = await ipc.call('saveCardField', p.id, { key: 'image_path', label: 'Art', kind: 'yesNo' }).catch((e) => e);
  assert.match(String(r), /can't be yesNo/);
  const m = await ipc.call('getCardModel', p.id);
  assert.deepEqual(m.fields.find((f) => f.key === 'action_rating').options, ['A', 'B']);

  const unit = await ipc.call('saveCardType', p.id, { name: 'Unit', color: '#e0794a', field_keys: ['cost', 'atk', 'action_rating', 'flying', 'rules_text'] });
  await assert.rejects(() => ipc.call('saveCardType', p.id, { name: 'unit', field_keys: [] }), /already a type/);
  await assert.rejects(() => ipc.call('saveCardType', p.id, { name: 'X', field_keys: ['hp'] }), /unknown field/);
  await assert.rejects(() => ipc.call('saveCardType', p.id, { name: 'X', field_keys: ['atk', 'atk'] }), /twice/);

  const card = await ipc.call('createCard', p.id, { name: 'Knight', card_type_id: unit.id });
  assert.equal(card.card_type, 'Unit');
  assert.deepEqual(JSON.parse(card.custom_fields), { action_rating: 'B', flying: true }, 'type defaults filled in');
  const plain = await ipc.call('createCard', p.id, { name: 'Plain' });
  assert.equal(plain.card_type, 'Card', 'no type given: the first type');
  await assert.rejects(() => ipc.call('createCard', p.id, { name: '  ' }), /needs a name/);
  const moved = await ipc.call('updateCard', plain.id, { card_type_id: unit.id });
  assert.equal(moved.card_type, 'Unit');
  const other = await ipc.call('createProject', { name: 'Other' });
  const otherType = (await ipc.call('getCardModel', other.id)).types[0];
  await assert.rejects(() => ipc.call('updateCard', plain.id, { card_type_id: otherType.id }), /not in this project/);
});

test('types: reorder, delete moves cards, the last type stays', async () => {
  const { ipc, p } = await setup();
  const first = (await ipc.call('getCardModel', p.id)).types[0];
  const spell = await ipc.call('saveCardType', p.id, { name: 'Spell', field_keys: ['rules_text'] });
  const c = await ipc.call('createCard', p.id, { name: 'Bolt', card_type_id: spell.id });
  let m = await ipc.call('reorderCardTypes', p.id, [spell.id, first.id]);
  assert.deepEqual(m.types.map((t) => t.name), ['Spell', 'Card']);
  assert.equal(m.types[0].card_count, 1);
  await assert.rejects(() => ipc.call('deleteCardType', p.id, spell.id, {}), /move its 1 card/);
  m = (await ipc.call('deleteCardType', p.id, spell.id, { moveTo: first.id })).model;
  assert.deepEqual(m.types.map((t) => t.name), ['Card']);
  assert.equal((await ipc.call('getCard', c.id)).card_type, 'Card');
  await assert.rejects(() => ipc.call('deleteCardType', p.id, first.id, {}), /at least one/);
});

test('removing a field from a type keeps values; deleting it from the library can purge them', async () => {
  const { ipc, p } = await setup({ starter: 'blank' });
  await ipc.call('saveCardField', p.id, { label: 'DEF', kind: 'number', create: true });
  const type = (await ipc.call('getCardModel', p.id)).types[0];
  await ipc.call('saveCardType', p.id, { ...type, field_keys: [...type.field_keys, 'def'] });
  const c = await ipc.call('createCard', p.id, { name: 'Wall', custom_fields: { def: '5' } });
  await assert.rejects(() => ipc.call('deleteCardField', p.id, 'def', {}), /remove it from Card first/);
  await ipc.call('saveCardType', p.id, { ...type, field_keys: type.field_keys });
  assert.equal(JSON.parse((await ipc.call('getCard', c.id)).custom_fields).def, '5', 'value kept');
  assert.equal(await ipc.call('cardFieldValueCount', p.id, 'def'), 1);
  const r = await ipc.call('deleteCardField', p.id, 'def', { purgeValues: true });
  assert.equal(r.purged, 1);
  assert.deepEqual(JSON.parse((await ipc.call('getCard', c.id)).custom_fields), {});
});

test('renaming a key moves values, follows types and applies template/exception rewrites in one go', async () => {
  const { ipc, p } = await setup({ starter: 'blank' });
  await ipc.call('saveCardField', p.id, { label: 'ATK', kind: 'number', create: true });
  const type = (await ipc.call('getCardModel', p.id)).types[0];
  await ipc.call('saveCardType', p.id, { ...type, field_keys: [...type.field_keys, 'atk'] });
  const c = await ipc.call('createCard', p.id, { name: 'K', custom_fields: { atk: '3', other: 'x' } });
  const tpl = database.insertTemplate(p.id, 'T', JSON.stringify({ schemaVersion: 1, layers: [{ id: 'a', type: 'text', text: '{{atk}}' }] }));
  const [rule] = database.saveTemplateRules(p.id, [{ condition_expr: 'atk > 2', template_id: tpl.id }]);
  await assert.rejects(() => ipc.call('renameCardField', p.id, 'cost', 'price', {}), /standard fields keep their key/);
  await assert.rejects(() => ipc.call('renameCardField', p.id, 'atk', 'cost', {}), /standard field/);
  await assert.rejects(() => ipc.call('renameCardField', p.id, 'atk', 'Bad Key', {}), /lower-case/);
  const res = await ipc.call('renameCardField', p.id, 'atk', 'attack', {
    templates: [{ id: tpl.id, content: JSON.stringify({ schemaVersion: 1, layers: [{ id: 'a', type: 'text', text: '{{attack}}' }] }) }],
    rules: [{ id: rule.id, condition_expr: 'attack > 2' }],
  });
  assert.equal(res.moved, 1);
  assert.deepEqual(JSON.parse((await ipc.call('getCard', c.id)).custom_fields), { attack: '3', other: 'x' }, 'key order and other values kept');
  assert.ok(res.model.types[0].field_keys.includes('attack') && !res.model.types[0].field_keys.includes('atk'));
  const t = database.getTemplate(tpl.id);
  assert.match(t.content, /\{\{attack\}\}/);
  assert.equal(t.version, 2, 'template version bumped');
  assert.equal(database.listTemplateRules(p.id)[0].condition_expr, 'attack > 2');
});

test('bulkUpdateCards is all-or-nothing and stays inside the project', async () => {
  const { ipc, p } = await setup();
  const a = await ipc.call('createCard', p.id, { name: 'A', cost: '1' });
  const b = await ipc.call('createCard', p.id, { name: 'B', cost: '2' });
  const rows = await ipc.call('bulkUpdateCards', p.id, [{ id: a.id, patch: { cost: '5' } }, { id: b.id, patch: { cost: '6', tags: ['x', 'y'] } }]);
  assert.deepEqual(rows.map((r) => [r.cost, r.tags]), [['5', ''], ['6', 'x,y']]);
  await assert.rejects(() => ipc.call('bulkUpdateCards', p.id, [{ id: a.id, patch: { cost: '9' } }, { id: b.id, patch: { name: '' } }]), /needs a name/);
  assert.equal((await ipc.call('getCard', a.id)).cost, '5', 'nothing applied when one change is invalid');
  const other = await ipc.call('createProject', { name: 'O' });
  const o = await ipc.call('createCard', other.id, { name: 'O' });
  await assert.rejects(() => ipc.call('bulkUpdateCards', p.id, [{ id: o.id, patch: { cost: '1' } }]), /not in this project/);
});

test('project export/import carries the card model and maps card types', async () => {
  const { ipc, p } = await setup({ starter: 'blank' });
  await ipc.call('saveCardField', p.id, { label: 'ATK', kind: 'number', create: true });
  const unit = await ipc.call('saveCardType', p.id, { name: 'Unit', field_keys: ['cost', 'atk'] });
  await ipc.call('createCard', p.id, { name: 'K', card_type_id: unit.id, custom_fields: { atk: '2' } });
  const json = await ipc.call('exportProject', p.id);
  const copy = await ipc.call('importProject', json);
  const m = await ipc.call('getCardModel', copy.id);
  assert.deepEqual(m.types.map((t) => [t.name, t.field_keys]), [['Card', ['cost', 'rules_text', 'image_path']], ['Unit', ['cost', 'atk']]]);
  const cards = database.queryCards(copy.id);
  assert.deepEqual(cards.map((c) => [c.name, c.card_type, JSON.parse(c.custom_fields).atk]), [['K', 'Unit', '2']]);
});

test('migration v5 gives existing projects a "Card" type with their custom fields and assigns every card', async () => {
  const dir = tempDir('v4to5');
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  db.run(`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
    card_schema TEXT DEFAULT '[]', created_at TEXT, updated_at TEXT)`);
  db.run(`CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT DEFAULT '',
    set_name TEXT DEFAULT '', rarity TEXT DEFAULT '', cost TEXT DEFAULT '', power TEXT DEFAULT '', toughness TEXT DEFAULT '',
    rules_text TEXT DEFAULT '', flavor_text TEXT DEFAULT '', tags TEXT DEFAULT '', custom_fields TEXT DEFAULT '{}', notes TEXT DEFAULT '',
    image_path TEXT DEFAULT '', created_at TEXT, updated_at TEXT, template_override_id INTEGER)`);
  db.run(`CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '{}', created_at TEXT, updated_at TEXT, version INTEGER NOT NULL DEFAULT 1, legacy_content TEXT)`);
  db.run(`CREATE TABLE template_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
    condition_expr TEXT NOT NULL DEFAULT '', template_id INTEGER NOT NULL, created_at TEXT)`);
  db.run(`CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, rel_path TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
    sha256 TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER, size INTEGER NOT NULL DEFAULT 0, mtime REAL NOT NULL DEFAULT 0, UNIQUE (project_id, rel_path))`);
  db.run("INSERT INTO projects (name) VALUES ('Old'), ('Empty')");
  db.run(`INSERT INTO cards (project_id, name, custom_fields) VALUES
    (1, 'A', '{"element":"Fire","hp":"3","Bad Key":"x","flying":true}'), (1, 'B', '{"hp":"5","lore":"line 1\\nline 2"}')`);
  db.run('PRAGMA user_version = 4');
  fs.writeFileSync(path.join(dir, 'tcgforge.db'), Buffer.from(db.export()));

  const result = await database.initDatabase(dir);
  assert.deepEqual([result.from, result.to], [4, LATEST_VERSION]);
  assert.ok(fs.existsSync(path.join(dir, 'tcgforge.db.bak-v4')));
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const m = await ipc.call('getCardModel', 1);
  assert.deepEqual(m.types.map((t) => t.name), ['Card']);
  const keys = m.types[0].field_keys;
  assert.deepEqual(keys.slice(-4), ['element', 'hp', 'flying', 'lore'], 'custom keys in use, after the standard fields');
  const kinds = Object.fromEntries(m.fields.map((f) => [f.key, f.kind]));
  assert.deepEqual([kinds.element, kinds.hp, kinds.flying, kinds.lore], ['text', 'number', 'yesNo', 'longText']);
  assert.ok(!keys.includes('Bad Key'), 'non-identifier keys stay as stored values only');
  assert.deepEqual(database.queryCards(1).map((c) => c.card_type), ['Card', 'Card']);
  assert.deepEqual((await ipc.call('getCardModel', 2)).types.map((t) => t.name), ['Card'], 'empty projects get the type too');
});
