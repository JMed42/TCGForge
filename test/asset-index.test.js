const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { tempDir, fakeIpc } = require('./helpers');
const database = require('../electron/database');
const { imageSize } = require('../electron/imageSize');
const { scanProjectAssets, updateAssetPath, missingArt, kindOf, registerAssetIndexIpc } = require('../electron/assetIndex');

const png = (w, h) => createCanvas(w, h).toBuffer('image/png');
const jpeg = (w, h) => createCanvas(w, h).toBuffer('image/jpeg');

test('imageSize reads PNG, JPEG, GIF and WebP headers', () => {
  assert.deepEqual(imageSize(png(37, 21)), { width: 37, height: 21 });
  assert.deepEqual(imageSize(jpeg(64, 48)), { width: 64, height: 48 });
  const gif = Buffer.from('474946383961' + '0a00' + '0500' + '000000', 'hex');
  assert.deepEqual(imageSize(gif), { width: 10, height: 5 });
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'latin1'); vp8x.write('WEBP', 8, 'latin1'); vp8x.write('VP8X', 12, 'latin1');
  vp8x.writeUIntLE(799, 24, 3); vp8x.writeUIntLE(599, 27, 3);
  assert.deepEqual(imageSize(vp8x), { width: 800, height: 600 });
  const vp8l = Buffer.alloc(30);
  vp8l.write('RIFF', 0, 'latin1'); vp8l.write('WEBP', 8, 'latin1'); vp8l.write('VP8L', 12, 'latin1');
  vp8l.writeUInt32LE((99) | (49 << 14), 21);
  assert.deepEqual(imageSize(vp8l), { width: 100, height: 50 });
  assert.equal(imageSize(Buffer.from('<svg/>')), null);
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff])), null, 'truncated JPEG');
});

test('kind comes from the folder', () => {
  assert.equal(kindOf('assets/art/ember.png'), 'art');
  assert.equal(kindOf('assets/icons/fire.svg'), 'icon');
  assert.equal(kindOf('assets/fonts/Cinzel-Bold.ttf'), 'font');
  assert.equal(kindOf('assets/frames/unit.png'), 'frame');
  assert.equal(kindOf('assets/bg-tile.png'), 'other');
  assert.equal(kindOf('templates/assets/frame.png'), 'frame');
});

async function setup() {
  const dir = tempDir('assets');
  await database.initDatabase(dir);
  const ipc = fakeIpc();
  database.registerIpcHandlers(ipc.ipcMain);
  const p = await ipc.call('createProject', { name: 'P' });
  const root = path.join(dir, 'projects', String(p.id));
  const write = (rel, data) => {
    const f = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
    return f;
  };
  return { dir, ipc, p, root, write };
}

test('scan indexes images and fonts, keeps hashes for unchanged files, drops deleted ones', async () => {
  const { dir, p, write, root } = await setup();
  write('assets/art/ember.png', png(30, 40));
  write('assets/fonts/Scribe-Bold.ttf', 'FONT');
  write('assets/notes.txt', 'not indexed');
  write('templates/assets/frame.png', png(5, 5));
  write('art/legacy.png', png(2, 2)); // outside the indexed folders
  const first = scanProjectAssets(dir, p.id, database);
  assert.deepEqual(first, { total: 3, changed: 3, removed: 0 });
  const rows = database.listAssets(p.id);
  assert.deepEqual(rows.map((r) => [r.rel_path, r.kind, r.width, r.height]), [
    ['assets/art/ember.png', 'art', 30, 40],
    ['assets/fonts/Scribe-Bold.ttf', 'font', null, null],
    ['templates/assets/frame.png', 'frame', 5, 5],
  ]);
  assert.match(rows[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(scanProjectAssets(dir, p.id, database), { total: 3, changed: 0, removed: 0 }, 'nothing changed');
  fs.unlinkSync(path.join(root, 'assets', 'fonts', 'Scribe-Bold.ttf'));
  assert.deepEqual(scanProjectAssets(dir, p.id, database), { total: 2, changed: 0, removed: 1 });
  assert.deepEqual(database.listAssets(p.id, 'art').map((r) => r.rel_path), ['assets/art/ember.png']);
});

test('watcher updates: changed file re-hashed, new file added, deleted folder removed', async () => {
  const { dir, p, write, root } = await setup();
  write('assets/art/a.png', png(10, 10));
  write('assets/icons/x/b.png', png(3, 3));
  scanProjectAssets(dir, p.id, database);
  const before = database.listAssets(p.id).find((r) => r.rel_path === 'assets/art/a.png');
  const f = write('assets/art/a.png', png(20, 12));
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(updateAssetPath(dir, p.id, 'assets/art/a.png', database), true);
  const after = database.listAssets(p.id).find((r) => r.rel_path === 'assets/art/a.png');
  assert.notEqual(after.sha256, before.sha256);
  assert.deepEqual([after.width, after.height], [20, 12]);
  write('assets/art/new.jpg', jpeg(8, 6));
  assert.equal(updateAssetPath(dir, p.id, 'assets\\art\\new.jpg', database), true);
  fs.rmSync(path.join(root, 'assets', 'icons'), { recursive: true });
  assert.equal(updateAssetPath(dir, p.id, 'assets/icons', database), true);
  assert.deepEqual(database.listAssets(p.id).map((r) => r.rel_path), ['assets/art/a.png', 'assets/art/new.jpg']);
  assert.equal(updateAssetPath(dir, p.id, '../escape.png', database), false);
  assert.equal(updateAssetPath(dir, p.id, 'assets/readme.md', database), false);
});

test('missing art: unresolved card image paths and literal template sources', async () => {
  const { dir, ipc, p, write } = await setup();
  write('assets/art/ember.png', png(4, 4));
  write('assets/frames/unit.png', png(4, 4));
  await ipc.call('createCard', p.id, { name: 'Ember', image_path: 'assets/art/ember.png' });
  await ipc.call('createCard', p.id, { name: 'Short path', image_path: 'art/ember.png' }); // resolves via assets/
  await ipc.call('createCard', p.id, { name: 'Gone', image_path: 'assets/art/gone.png' });
  await ipc.call('createCard', p.id, { name: 'Absolute', image_path: 'C:\\pics\\x.png' });
  await ipc.call('createCard', p.id, { name: 'No art' });
  const layers = [
    { id: 'frame', type: 'image', src: 'frames/unit.png' },
    { id: 'badge', type: 'image', src: 'icons/missing.png' },
    { id: 'art', type: 'image', src: '{{image_path}}' },
    { id: 'g', type: 'group', children: [{ id: 'deep', type: 'image', src: 'nope.png' }] },
  ];
  database.insertTemplate(p.id, 'T', JSON.stringify({ schemaVersion: 1, name: 'T', layers }));
  const ipc2 = fakeIpc();
  registerAssetIndexIpc(ipc2.ipcMain, { userDataPath: dir, db: database });
  const res = await ipc2.call('getMissingArt', p.id);
  assert.deepEqual(res.cards.map((c) => c.name), ['Absolute', 'Gone']);
  assert.deepEqual(res.templates.map((t) => t.layer), ['badge', 'deep']);
  assert.equal(res.cardIds.length, 2);
  assert.equal((await ipc2.call('getAssets', p.id, 'frame')).length, 1, 'first request scans the project');
  assert.deepEqual(missingArt(dir, p.id, [], []), { cardIds: [], cards: [], templates: [] });
});
