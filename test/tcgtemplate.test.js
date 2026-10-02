const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { registerCardDesignerIpc } = require('../electron/cardDesigner/ipc');
const tcg = require('../electron/cardDesigner/tcgtemplate');

const TEMPLATE = {
  schemaVersion: 1,
  name: 'Faction Frame',
  size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3 },
  layers: [
    { id: 'frame', type: 'image', src: 'frames/{{lower(faction)}}.png', frame: { left: 0, right: 0, top: 0, bottom: 0 } },
    { id: 'badge', type: 'image', src: 'assets/icons/star.png', frame: { right: 2, top: 2, width: 5, height: 5 } },
    { id: 'art', type: 'image', src: '{{image_path}}', frame: { left: 4, right: 4, top: 10, height: 38 } },
    { id: 'name', type: 'text', text: '{{name}}', style: { font: 'Cinzel', sizePt: 10 } },
  ],
};

async function setup() {
  const dir = tempDir('tcgtpl');
  await database.initDatabase(dir);
  const db = fakeIpc();
  database.registerIpcHandlers(db.ipcMain);
  const ipc = fakeIpc();
  registerCardDesignerIpc(ipc.ipcMain, {
    userDataPath: dir, getCard: database.getCard, queryCards: database.queryCards,
    listTemplates: database.listTemplates, getTemplate: database.getTemplate, insertTemplate: database.insertTemplate,
    updateTemplate: database.updateTemplate, deleteTemplate: database.deleteTemplate,
    render: null, dialog: {}, shell: {}, getWindow: () => null,
  });
  const projects = [];
  for (const name of ['Source', 'Target', 'Clash']) projects.push(await db.call('createProject', { name }));
  const write = (pid, rel, data) => {
    const f = path.join(dir, 'projects', String(pid), ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };
  const src = projects[0].id;
  write(src, 'assets/frames/ember.png', 'EMBER');
  write(src, 'assets/frames/tide.png', 'TIDE');
  write(src, 'assets/frames/notes.txt', 'not an asset');
  write(src, 'assets/icons/star.png', 'STAR');
  write(src, 'assets/fonts/Cinzel-Bold.ttf', 'FONT');
  write(src, 'assets/fonts/Other-Regular.ttf', 'UNUSED FONT');
  write(src, 'assets/art/hero.png', 'CARD ART');
  write(projects[2].id, 'assets/icons/star.png', 'A DIFFERENT STAR');
  const row = await ipc.call('saveTemplate', src, TEMPLATE);
  return { dir, ipc, projects, row, write };
}

test('export bundles referenced files: literal paths, templated-path matches and fonts by family', async () => {
  const { dir, ipc, row } = await setup();
  const out = path.join(dir, 'frame.tcgtemplate');
  const res = await ipc.call('exportTemplateFile', row.id, { outputPath: out });
  assert.deepEqual(res.assets, ['assets/fonts/Cinzel-Bold.ttf', 'assets/frames/ember.png', 'assets/frames/tide.png', 'assets/icons/star.png']);
  const pkg = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(pkg.format, 'tcgtemplate');
  assert.equal(pkg.formatVersion, 1);
  assert.equal(pkg.template.name, 'Faction Frame');
  assert.ok(!pkg.assets.some((a) => a.path.includes('art/')), 'card art is not part of a template');
});

test('import into another project writes the files and the template; re-import reuses files', async () => {
  const { dir, ipc, row, projects } = await setup();
  const out = path.join(dir, 'frame.tcgtemplate');
  await ipc.call('exportTemplateFile', row.id, { outputPath: out });
  const target = projects[1].id;
  const read = await ipc.call('readTemplateFile', target, { inputPath: out });
  assert.equal(read.template.name, 'Faction Frame');
  assert.equal(read.assets.length, 4);
  const imp = await ipc.call('importTemplateFile', read.token);
  assert.equal(imp.written.length, 4);
  assert.equal(imp.template.name, 'Faction Frame');
  assert.equal(fs.readFileSync(path.join(dir, 'projects', String(target), 'assets', 'frames', 'tide.png'), 'utf8'), 'TIDE');
  assert.deepEqual(JSON.parse(imp.template.content).layers, TEMPLATE.layers, 'template unchanged');
  await assert.rejects(() => ipc.call('importTemplateFile', read.token), /expired/, 'a token works once');

  const again = await ipc.call('importTemplateFile', (await ipc.call('readTemplateFile', target, { inputPath: out })).token);
  assert.equal(again.written.length, 0);
  assert.equal(again.reused.length, 4);
  assert.equal(again.template.name, 'Faction Frame (imported)');
});

test('a different file at the same path is imported beside it and the reference rewritten', async () => {
  const { dir, ipc, row, projects } = await setup();
  const out = path.join(dir, 'frame.tcgtemplate');
  await ipc.call('exportTemplateFile', row.id, { outputPath: out });
  const clash = projects[2].id;
  const imp = await ipc.call('importTemplateFile', (await ipc.call('readTemplateFile', clash, { inputPath: out })).token);
  assert.deepEqual(imp.renamed, [['assets/icons/star.png', 'assets/icons/star-2.png']]);
  const base = path.join(dir, 'projects', String(clash), 'assets', 'icons');
  assert.equal(fs.readFileSync(path.join(base, 'star.png'), 'utf8'), 'A DIFFERENT STAR', 'existing file untouched');
  assert.equal(fs.readFileSync(path.join(base, 'star-2.png'), 'utf8'), 'STAR');
  const badge = JSON.parse(imp.template.content).layers.find((l) => l.id === 'badge');
  assert.equal(badge.src, 'assets/icons/star-2.png');
});

test('hostile or broken files are rejected before anything is written', async () => {
  const { dir, ipc, projects } = await setup();
  const target = projects[1].id;
  const asset = (p, data = 'x') => ({ path: p, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, base64: Buffer.from(data).toString('base64') });
  const pkg = (assets, extra = {}) => JSON.stringify({ format: 'tcgtemplate', formatVersion: 1, template: TEMPLATE, assets, ...extra });
  const cases = [
    [pkg([asset('../../escape.png')]), /unsafe asset path/],
    [pkg([asset('assets/../../escape.png')]), /unsafe asset path/],
    [pkg([asset('C:/Windows/evil.png')]), /unsafe asset path/],
    [pkg([asset('assets/run.exe')]), /not allowed/],
    [pkg([{ ...asset('assets/a.png'), sha256: '0'.repeat(64) }]), /checksum/],
    [pkg([asset('assets/a.png'), asset('ASSETS/A.png')]), /duplicate/],
    [pkg([], { format: 'zip' }), /not a .tcgtemplate/],
    [pkg([], { formatVersion: 9 }), /unsupported/],
    [JSON.stringify({ format: 'tcgtemplate', formatVersion: 1, template: { schemaVersion: 2 }, assets: [] }), /schemaVersion/],
    ['{ not json', /invalid JSON/],
  ];
  for (const [text, re] of cases) {
    const f = path.join(dir, 'bad.tcgtemplate');
    fs.writeFileSync(f, text);
    await assert.rejects(() => ipc.call('readTemplateFile', target, { inputPath: f }), re, String(re));
  }
  assert.ok(!fs.existsSync(path.join(dir, 'escape.png')) && !fs.existsSync(path.join(dir, 'projects', String(target), 'assets')));
});

test('collectAssetPaths ignores dynamic card fields', async () => {
  const { dir, projects } = await setup();
  const only = { ...TEMPLATE, layers: [TEMPLATE.layers[2]] };
  assert.deepEqual(tcg.collectAssetPaths(dir, projects[0].id, only), []);
});
