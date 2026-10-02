const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./helpers');
const assets = require('../electron/assets');

function setup() {
  const userData = tempDir('assets');
  const project = path.join(userData, 'projects', '1');
  const write = (rel, data = 'x') => {
    const f = path.join(project, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
    return f;
  };
  write('assets/art/hero.png');
  write('assets/frames/ember.png');
  write('art/old.png');
  write('templates/assets/bg-tile.png');
  fs.writeFileSync(path.join(userData, 'secret.txt'), 'nope');
  fs.mkdirSync(path.join(userData, 'projects', '2'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'projects', '2', 'other.png'), 'x');
  return { userData, project };
}

test('relative paths resolve inside the project, with assets/ and templates/ fallbacks', () => {
  const { userData, project } = setup();
  const r = (p) => assets.resolveProjectAsset(userData, 1, p);
  assert.equal(r('assets/art/hero.png'), path.join(project, 'assets', 'art', 'hero.png'));
  assert.equal(r('frames/ember.png'), path.join(project, 'assets', 'frames', 'ember.png'));
  assert.equal(r('art/old.png'), path.join(project, 'art', 'old.png'));
  assert.equal(r('assets/bg-tile.png'), path.join(project, 'templates', 'assets', 'bg-tile.png'));
  assert.equal(r('assets/missing.png'), null);
  assert.equal(r('assets/art'), null, 'directories are not served');
});

test('nothing outside the project folder is ever served', () => {
  const { userData } = setup();
  const attempts = [
    '../secret.txt', '../../secret.txt', 'assets/../../secret.txt', '..\\..\\secret.txt',
    '../2/other.png', path.join(userData, 'secret.txt'), 'C:/Windows/win.ini', 'C:\\Windows\\win.ini',
    '\\\\server\\share\\x.png', '/etc/passwd', 'assets/\0.png', '', '.',
  ];
  for (const p of attempts) assert.equal(assets.resolveProjectAsset(userData, 1, p), null, p);
  for (const bad of [0, -1, 'abc', 1.5, '../1']) assert.equal(assets.resolveProjectAsset(userData, bad, 'assets/art/hero.png'), null);
});

test('asset URLs parse, including encoded names; traversal stays blocked after decoding', () => {
  assert.deepEqual(assets.parseAssetUrl('tcg-asset://p/1/assets/art/My%20Hero.png?v=3'), { projectId: 1, relPath: 'assets/art/My Hero.png' });
  assert.equal(assets.parseAssetUrl('https://p/1/x.png'), null);
  assert.equal(assets.parseAssetUrl('tcg-asset://q/1/x.png'), null);
  assert.equal(assets.parseAssetUrl('tcg-asset://p/1'), null);
  const { userData } = setup();
  const parsed = assets.parseAssetUrl('tcg-asset://p/1/assets/%2e%2e/%2e%2e/%2e%2e/secret.txt');
  assert.ok(!parsed || assets.resolveProjectAsset(userData, parsed.projectId, parsed.relPath) === null);
  const enc = assets.parseAssetUrl('tcg-asset://p/1/%2E%2E%2F%2E%2E%2Fsecret.txt');
  assert.equal(enc && assets.resolveProjectAsset(userData, enc.projectId, enc.relPath), null);
});

test('the watcher reports changed files per project', async () => {
  const { userData, project } = setup();
  const seen = [];
  const stop = assets.watchProjectAssets(userData, (e) => seen.push(e), { debounceMs: 30 });
  await new Promise((r) => setTimeout(r, 100));
  fs.writeFileSync(path.join(project, 'assets', 'art', 'hero.png'), 'changed');
  fs.writeFileSync(path.join(project, 'assets', 'art', 'hero.png'), 'changed again'); // debounced into one event
  await new Promise((r) => setTimeout(r, 400));
  stop();
  const hero = seen.filter((e) => e.relPath === 'assets/art/hero.png');
  assert.equal(hero.length, 1);
  assert.equal(hero[0].projectId, 1);
});
