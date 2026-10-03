const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { tempDir, fakeIpc } = require('./helpers');
const { registerClipboardIpc } = require('../electron/clipboard');

const png = (w, h, color = '#c33') => {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  return c.toBuffer('image/png');
};

// A stand-in for Electron's clipboard module.
function fakeClipboard({ image = null, file = null, text = '' } = {}) {
  let written = null;
  return {
    readText: () => text,
    writeText: (t) => { written = t; },
    readImage: () => ({ isEmpty: () => !image, toPNG: () => image }),
    availableFormats: () => (file ? ['FileNameW'] : []),
    readBuffer: (fmt) => (fmt === 'FileNameW' && file ? Buffer.from(`${file}\0`, 'utf16le') : Buffer.alloc(0)),
    get written() { return written; },
  };
}

function setup(clip) {
  const dir = tempDir('clip');
  const ipc = fakeIpc();
  registerClipboardIpc(ipc.ipcMain, { clipboard: clip, userDataPath: dir });
  return { dir, ipc };
}

test('a bitmap on the clipboard becomes a PNG in assets/art (deduplicated), or assets/images', async () => {
  const clip = fakeClipboard({ image: png(20, 10) });
  const { dir, ipc } = setup(clip);
  assert.deepEqual(await ipc.call('readClipboard'), { text: '', hasImage: true });
  const a = await ipc.call('pasteImageFromClipboard', 1, { name: 'Ember Drake' });
  assert.match(a.path, /^assets\/art\/ember_drake-[0-9a-f]{8}\.png$/);
  assert.equal(a.source, 'image');
  assert.deepEqual([a.thumbnail.width, a.thumbnail.height], [20, 10]);
  assert.ok(fs.existsSync(path.join(dir, 'projects', '1', ...a.path.split('/'))));
  const again = await ipc.call('pasteImageFromClipboard', 1, { name: 'Ember Drake' });
  assert.equal(again.path, a.path, 'same image, same file');
  const frame = await ipc.call('pasteImageFromClipboard', 1, { folder: 'images', name: 'unit frame' });
  assert.match(frame.path, /^assets\/images\/unit_frame-/);
  await assert.rejects(() => ipc.call('pasteImageFromClipboard', 1, { folder: '../../etc' }), /unknown asset folder/);
});

test('a copied image file is copied into the project; other files are ignored', async () => {
  const src = tempDir('clipsrc');
  const file = path.join(src, 'Knight Art.png');
  fs.writeFileSync(file, png(8, 8, '#33c'));
  const { ipc } = setup(fakeClipboard({ file }));
  assert.equal((await ipc.call('readClipboard')).hasImage, true);
  const r = await ipc.call('pasteImageFromClipboard', 1, {});
  assert.equal(r.source, 'file');
  assert.match(r.path, /^assets\/art\/knight_art-[0-9a-f]{8}\.png$/);
  const txt = path.join(src, 'notes.txt');
  fs.writeFileSync(txt, 'hello');
  const other = setup(fakeClipboard({ file: txt }));
  assert.deepEqual(await other.ipc.call('pasteImageFromClipboard', 1, {}), { empty: true });
});

test('empty clipboard, text round trip', async () => {
  const clip = fakeClipboard({ text: 'a\tb' });
  const { ipc } = setup(clip);
  assert.deepEqual(await ipc.call('readClipboard'), { text: 'a\tb', hasImage: false });
  assert.deepEqual(await ipc.call('pasteImageFromClipboard', 1, {}), { empty: true });
  await ipc.call('writeClipboardText', 'x\ty');
  assert.equal(clip.written, 'x\ty');
});
