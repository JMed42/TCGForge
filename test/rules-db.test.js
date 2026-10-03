const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');

async function setup() {
  const dir = tempDir('rules');
  await database.initDatabase(dir);
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const p = await ipc.call('createProject', { name: 'P' });
  const other = await ipc.call('createProject', { name: 'Other' });
  const unit = database.insertTemplate(p.id, 'Unit', '{}');
  const spell = database.insertTemplate(p.id, 'Spell', '{}');
  const foreign = database.insertTemplate(other.id, 'Foreign', '{}');
  const card = await ipc.call('createCard', p.id, { name: 'Ember Drake', type: 'Unit' });
  return { dir, ipc, p, other, unit, spell, foreign, card };
}

test('migration v4 adds template_rules, assets and cards.template_override_id', async () => {
  const { dir } = await setup();
  const SQL = await require('sql.js')();
  const db = new SQL.Database(fs.readFileSync(path.join(dir, 'tcgforge.db')));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map((r) => r[0]);
  assert.ok(tables.includes('template_rules') && tables.includes('assets'));
  const cols = db.exec('PRAGMA table_info(cards)')[0].values.map((r) => r[1]);
  assert.ok(cols.includes('template_override_id'));
});

test('rules save in order, replace the list, and refuse templates of other projects', async () => {
  const { ipc, p, unit, spell, foreign } = await setup();
  const saved = await ipc.call('saveTemplateRules', p.id, [
    { condition_expr: ' type == "Unit" ', template_id: unit.id },
    { condition_expr: 'true', template_id: spell.id },
  ]);
  assert.deepEqual(saved.map((r) => [r.priority, r.condition_expr, r.template_id]), [[0, 'type == "Unit"', unit.id], [1, 'true', spell.id]]);
  await assert.rejects(() => ipc.call('saveTemplateRules', p.id, [{ condition_expr: 'true', template_id: foreign.id }]), /not in this project/);
  assert.equal((await ipc.call('getTemplateRules', p.id)).length, 2, 'a refused save changes nothing');
  assert.deepEqual(await ipc.call('saveTemplateRules', p.id, []), []);
});

test('template override is stored, validated, and cleared when its template is deleted', async () => {
  const { ipc, p, unit, spell, foreign, card } = await setup();
  let row = await ipc.call('updateCard', card.id, { template_override_id: spell.id });
  assert.equal(row.template_override_id, spell.id);
  await assert.rejects(() => ipc.call('updateCard', card.id, { template_override_id: foreign.id }), /same project/);
  await ipc.call('saveTemplateRules', p.id, [{ condition_expr: 'true', template_id: spell.id }, { condition_expr: 'true', template_id: unit.id }]);
  database.deleteTemplate(spell.id);
  row = await ipc.call('getCard', card.id);
  assert.equal(row.template_override_id, null);
  assert.deepEqual((await ipc.call('getTemplateRules', p.id)).map((r) => r.template_id), [unit.id]);
  row = await ipc.call('updateCard', card.id, { template_override_id: '' });
  assert.equal(row.template_override_id, null);
});

test('deleting a project removes its rules and asset rows', async () => {
  const { ipc, p, unit } = await setup();
  await ipc.call('saveTemplateRules', p.id, [{ condition_expr: 'true', template_id: unit.id }]);
  database.applyAssetChanges(p.id, [{ rel_path: 'assets/art/a.png', kind: 'art', sha256: 'x', width: 1, height: 1, size: 3, mtime: 1 }]);
  await ipc.call('deleteProject', p.id);
  assert.equal(database.listTemplateRules(p.id).length, 0);
  assert.equal(database.listAssets(p.id).length, 0);
});
