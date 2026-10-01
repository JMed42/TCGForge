const test = require('node:test');
const assert = require('node:assert');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { registerCardDesignerIpc } = require('../electron/cardDesigner/ipc');

async function setup() {
  const dir = tempDir('tplipc');
  await database.initDatabase(dir);
  const db = fakeIpc();
  database.registerIpcHandlers(db.ipcMain);
  const ipc = fakeIpc();
  registerCardDesignerIpc(ipc.ipcMain, {
    userDataPath: dir,
    getCard: database.getCard,
    queryCards: database.queryCards,
    listTemplates: database.listTemplates,
    getTemplate: database.getTemplate,
    insertTemplate: database.insertTemplate,
    updateTemplate: database.updateTemplate,
    deleteTemplate: database.deleteTemplate,
    dialog: {}, shell: {}, getWindow: () => null,
  });
  const p1 = await db.call('createProject', { name: 'One' });
  const p2 = await db.call('createProject', { name: 'Two' });
  const card = await db.call('createCard', p1.id, { name: 'Ember Drake', cost: '5' });
  return { dir, db, ipc, p1, p2, card };
}

test('create, save, list and delete templates by numeric id', async () => {
  const { ipc, p1 } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'Hero Frame');
  assert.equal(typeof created.id, 'number');
  assert.equal(created.name, 'Hero Frame');

  const tpl = JSON.parse(created.content);
  tpl.meta.name = 'Hero Frame v2';
  const saved = await ipc.call('saveTemplate', p1.id, tpl, created.id);
  assert.equal(saved.id, created.id);
  assert.equal(saved.name, 'Hero Frame v2');
  assert.equal(saved.error, null);

  const list = await ipc.call('getTemplates', p1.id);
  assert.deepEqual(list.map((t) => t.name), ['Hero Frame v2']);

  await ipc.call('deleteTemplate', created.id);
  assert.equal((await ipc.call('getTemplates', p1.id)).length, 0);
});

test('saveTemplate rejects invalid templates and cross-project ids', async () => {
  const { ipc, p1, p2 } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'T');
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, '{ nope', created.id));
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { meta: { width: 0, height: 10, dpi: 300 } }, created.id), /width/);
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { meta: { width: 99999, height: 10, dpi: 300 } }, created.id), /limited/);
  await assert.rejects(() => ipc.call('saveTemplate', p2.id, JSON.parse(created.content), created.id), /not found in project/);
});

test('renderCard renders the stored template or an unsaved draft', async () => {
  const { ipc, p1, card } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'T');
  const stored = await ipc.call('renderCard', card.id, created.id, { dpi: 96 });
  assert.ok(stored.dataUrl.startsWith('data:image/png;base64,'));
  assert.deepEqual([stored.width, stored.height], [238, 332]);

  const draft = JSON.parse(created.content);
  draft.meta.width = 372; // half width: the draft, not the stored row, must be rendered
  const fromDraft = await ipc.call('renderCard', card.id, created.id, { dpi: 96, draft });
  assert.equal(fromDraft.width, 119);

  const unchanged = await ipc.call('getTemplates', p1.id);
  assert.equal(JSON.parse(unchanged[0].content).meta.width, 744, 'draft rendering does not save');
});

test('renderCard refuses a template from another project', async () => {
  const { ipc, p2, card } = await setup();
  const other = await ipc.call('createTemplate', p2.id, 'Other');
  await assert.rejects(() => ipc.call('renderCard', card.id, other.id, { dpi: 96 }), /different projects/);
});
