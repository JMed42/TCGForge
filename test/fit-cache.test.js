const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { LATEST_VERSION } = require('../electron/migrations');

async function setup() {
  const dir = tempDir('fit');
  await database.initDatabase(dir);
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const p = await ipc.call('createProject', { name: 'P' });
  const other = await ipc.call('createProject', { name: 'Other' });
  const a = await ipc.call('createCard', p.id, { name: 'A' });
  const b = await ipc.call('createCard', p.id, { name: 'B' });
  const c = await ipc.call('createCard', p.id, { name: 'C' });
  const foreign = await ipc.call('createCard', other.id, { name: 'Foreign' });
  return { dir, ipc, p, other, a, b, c, foreign };
}

const fits = (status, pt) => ({ rules: { status, pt, lineHeight: 1.2, basePt: 9, fill: 0.8 } });

test('migration v6 adds the fit_cache table', async () => {
  const { dir } = await setup();
  assert.ok(LATEST_VERSION >= 6);
  const SQL = await require('sql.js')();
  const db = new SQL.Database(fs.readFileSync(path.join(dir, 'tcgforge.db')));
  const cols = db.exec('PRAGMA table_info(fit_cache)')[0].values.map((r) => r[1]);
  assert.deepEqual(cols, ['card_id', 'project_id', 'template_id', 'template_version', 'data_hash', 'results_json', 'computed_at']);
});

test('results save, load and replace per card; other projects\' cards are skipped', async () => {
  const { ipc, p, a, b, foreign } = await setup();
  const res = await ipc.call('saveFitResults', p.id, [
    { cardId: a.id, templateId: 7, templateVersion: 3, hash: 'h-a1', results: fits('fits', 9) },
    { cardId: b.id, templateId: 7, templateVersion: 3, hash: 'h-b1', results: fits('shrunk', 7.5) },
    { cardId: foreign.id, templateId: 7, templateVersion: 3, hash: 'h-x', results: fits('fits', 9) },
    { cardId: 99999, templateId: 7, templateVersion: 3, hash: 'h-y', results: {} },
  ]);
  assert.deepEqual(res, { saved: 2, skipped: 2 });
  await ipc.call('saveFitResults', p.id, [{ cardId: a.id, templateId: 8, templateVersion: 1, hash: 'h-a2', results: fits('overflow', 6.5) }]);
  const rows = (await ipc.call('getFitCache', p.id)).sort((x, y) => x.cardId - y.cardId);
  assert.deepEqual(rows.map((r) => [r.cardId, r.templateId, r.templateVersion, r.hash, r.results.rules.status]), [
    [a.id, 8, 1, 'h-a2', 'overflow'],
    [b.id, 7, 3, 'h-b1', 'shrunk'],
  ]);
  assert.deepEqual(await ipc.call('getFitCache', (await ipc.call('getProjects')).find((x) => x.name === 'Other').id), []);
  await assert.rejects(() => ipc.call('saveFitResults', p.id, [{ cardId: a.id, results: {} }]), /hash/);
  await assert.rejects(() => ipc.call('saveFitResults', p.id, 'nope'), /list/);
});

test('deleting cards or the project removes their results; Re-check all clears the project', async () => {
  const { ipc, p, a, b, c } = await setup();
  const row = (card) => ({ cardId: card.id, templateId: 1, templateVersion: 1, hash: `h${card.id}`, results: fits('fits', 9) });
  await ipc.call('saveFitResults', p.id, [row(a), row(b), row(c)]);
  await ipc.call('deleteCard', a.id);
  await ipc.call('bulkDeleteCards', [b.id]);
  assert.deepEqual((await ipc.call('getFitCache', p.id)).map((r) => r.cardId), [c.id]);
  const left = database.queryAll('SELECT card_id FROM fit_cache').map((r) => r.card_id);
  assert.deepEqual(left, [c.id], 'the deleted cards\' rows are gone, not just hidden');
  await ipc.call('clearFitCache', p.id);
  assert.deepEqual(await ipc.call('getFitCache', p.id), []);
  await ipc.call('saveFitResults', p.id, [row(c)]);
  await ipc.call('deleteProject', p.id);
  assert.equal(database.queryAll('SELECT COUNT(*) AS n FROM fit_cache')[0].n, 0);
});
