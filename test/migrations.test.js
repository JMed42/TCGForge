const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./helpers');
const database = require('../electron/database');
const { LATEST_VERSION } = require('../electron/migrations');

// sql.js database file with the original v0 schema (no user_version, no templates table).
async function writeV0Database(dir, { projects = [] } = {}) {
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  db.run(`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    description TEXT DEFAULT '', card_schema TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  for (const name of projects) db.run('INSERT INTO projects (name) VALUES (?)', [name]);
  fs.writeFileSync(path.join(dir, 'tcgforge.db'), Buffer.from(db.export()));
}

function tableNames(dir) {
  return require('sql.js')().then((SQL) => {
    const db = new SQL.Database(fs.readFileSync(path.join(dir, 'tcgforge.db')));
    const names = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map((r) => r[0]);
    const version = db.exec('PRAGMA user_version')[0].values[0][0];
    return { names, version };
  });
}

test('fresh database is created at the latest version with a templates table', async () => {
  const dir = tempDir('fresh');
  const result = await database.initDatabase(dir);
  assert.equal(result.to, LATEST_VERSION);
  assert.equal(result.backup, null, 'no backup for a brand-new file');
  const { names, version } = await tableNames(dir);
  assert.ok(names.includes('templates'));
  assert.equal(version, LATEST_VERSION);
});

test('v0 database migrates, imports Phase 0 template files, and writes a backup', async () => {
  const dir = tempDir('v0');
  await writeV0Database(dir, { projects: ['Alpha', 'Beta'] });
  const tdir = path.join(dir, 'projects', '1', 'templates');
  fs.mkdirSync(tdir, { recursive: true });
  const tpl = { meta: { name: 'Standard Card', width: 744, height: 1039, dpi: 300 }, layers: [] };
  fs.writeFileSync(path.join(tdir, 'standard.json'), JSON.stringify(tpl));
  fs.writeFileSync(path.join(tdir, 'broken.json'), '{ not json');

  const result = await database.initDatabase(dir);
  assert.equal(result.from, 0);
  assert.equal(result.to, LATEST_VERSION);
  assert.ok(fs.existsSync(path.join(dir, 'tcgforge.db.bak-v0')), 'backup written');

  const rows = database.listTemplates(1);
  assert.deepEqual(rows.map((r) => r.name), ['Standard Card']);
  // v3 converted it to schema v1, keeping the original JSON.
  const converted = JSON.parse(rows[0].content);
  assert.equal(converted.schemaVersion, 1);
  assert.equal(converted.name, 'Standard Card');
  assert.equal(JSON.parse(rows[0].legacy_content).meta.name, 'Standard Card');
  assert.equal(rows[0].version, 1);
  assert.equal(database.listTemplates(2).length, 0);
  assert.ok(fs.existsSync(path.join(tdir, 'standard.json')), 'template file left in place');

  // Re-opening is a no-op: no new backup, no duplicate import.
  fs.rmSync(path.join(dir, 'tcgforge.db.bak-v0'));
  const again = await database.initDatabase(dir);
  assert.equal(again.applied.length, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'tcgforge.db.bak-v0')));
  assert.equal(database.listTemplates(1).length, 1);
});

test('deleting a project removes its templates', async () => {
  const dir = tempDir('cascade');
  await database.initDatabase(dir);
  const handlers = {};
  database.registerIpcHandlers({ handle: (n, f) => { handlers[n] = f; } });
  const p = handlers.createProject(null, { name: 'P' });
  database.insertTemplate(p.id, 'T', '{}');
  handlers.deleteProject(null, p.id);
  assert.equal(database.listTemplates(p.id).length, 0);
});

test('a v2 database (Phase 1 templates table) converts to schema v1 with a .bak-v2 backup', async () => {
  const dir = tempDir('v2');
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  db.run(`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
    card_schema TEXT DEFAULT '[]', created_at TEXT, updated_at TEXT)`);
  db.run(`CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '{}', created_at TEXT, updated_at TEXT)`);
  db.run("INSERT INTO projects (name) VALUES ('P')");
  const legacy = { meta: { name: 'Old', width: 744, height: 1039, dpi: 300 }, layers: [{ id: 'title', type: 'text', value: '{{name}}', x: 40, y: 40, width: 664, height: 60 }] };
  db.run('INSERT INTO templates (project_id, name, content) VALUES (1, ?, ?)', ['Renamed in DB', JSON.stringify(legacy)]);
  db.run("INSERT INTO templates (project_id, name, content) VALUES (1, 'Broken', '{ not json')");
  db.run('PRAGMA user_version = 2');
  fs.writeFileSync(path.join(dir, 'tcgforge.db'), Buffer.from(db.export()));

  const result = await database.initDatabase(dir);
  assert.deepEqual([result.from, result.to], [2, LATEST_VERSION]);
  assert.ok(fs.existsSync(path.join(dir, 'tcgforge.db.bak-v2')));
  const [old, broken] = database.listTemplates(1).sort((a, b) => a.id - b.id);
  const v1 = JSON.parse(old.content);
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.name, 'Renamed in DB', 'the DB name wins over meta.name');
  assert.ok(v1.layers.some((l) => l.id === 'title' && l.type === 'text'));
  assert.equal(broken.content, '{ not json', 'unparseable content is left alone');
  assert.equal(broken.legacy_content, null);
});
