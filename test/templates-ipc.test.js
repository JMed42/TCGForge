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
    render: null, // rendering runs in Electron; covered by the in-app checks
    dialog: {}, shell: {}, getWindow: () => null,
  });
  const p1 = await db.call('createProject', { name: 'One' });
  const p2 = await db.call('createProject', { name: 'Two' });
  const card = await db.call('createCard', p1.id, { name: 'Ember Drake', cost: '5' });
  return { dir, db, ipc, p1, p2, card };
}

test('create, save, list and delete templates by numeric id; version bumps on save', async () => {
  const { ipc, p1 } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'Hero Frame');
  assert.equal(typeof created.id, 'number');
  assert.equal(created.name, 'Hero Frame');
  assert.equal(created.version, 1);
  const tpl = JSON.parse(created.content);
  assert.equal(tpl.schemaVersion, 1);
  assert.deepEqual(tpl.size, { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3, cornerRadiusMm: 3 });

  tpl.name = 'Hero Frame v2';
  const saved = await ipc.call('saveTemplate', p1.id, tpl, created.id);
  assert.equal(saved.id, created.id);
  assert.equal(saved.name, 'Hero Frame v2');
  assert.equal(saved.version, 2);
  assert.equal(saved.error, null);
  assert.equal((await ipc.call('saveTemplate', p1.id, tpl, created.id)).version, 3);

  const list = await ipc.call('getTemplates', p1.id);
  assert.deepEqual(list.map((t) => t.name), ['Hero Frame v2']);

  await ipc.call('deleteTemplate', created.id);
  assert.equal((await ipc.call('getTemplates', p1.id)).length, 0);
});

test('saveTemplate rejects malformed templates and cross-project ids', async () => {
  const { ipc, p1, p2 } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'T');
  const good = JSON.parse(created.content);
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, '{ nope', created.id));
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { ...good, schemaVersion: 2 }, created.id), /schemaVersion/);
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { ...good, size: { ...good.size, widthMm: 0 } }, created.id), /widthMm/);
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { ...good, size: { ...good.size, heightMm: 9000 } }, created.id), /heightMm/);
  await assert.rejects(() => ipc.call('saveTemplate', p1.id, { ...good, layers: {} }, created.id), /layers/);
  await assert.rejects(() => ipc.call('saveTemplate', p2.id, good, created.id), /not found in project/);
});

test('sheet layout comes from the template size and the chosen bleed', async () => {
  const { ipc, p1 } = await setup();
  const created = await ipc.call('createTemplate', p1.id, 'T');
  const l = await ipc.call('getSheetLayout', created.id, { paper: 'a4', bleedMm: 3 });
  assert.equal(l.perPage, 8);
  const tarot = { ...JSON.parse(created.content), size: { widthMm: 70, heightMm: 120, bleedMm: 3, safeMm: 3 } };
  assert.equal((await ipc.call('getSheetLayout', created.id, { paper: 'a4', bleedMm: 0, draft: tarot })).perPage, 4);
});
