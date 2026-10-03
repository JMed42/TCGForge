// The `assets` table (spec data model: id, project_id, rel_path, kind, sha256, width, height)
// mirrors image and font files under {userData}/projects/{id}/assets (and the Phase 0
// templates/assets folder). Files stay on disk; rows are rebuilt from a scan and kept current by
// the file watcher. A file whose size and mtime are unchanged keeps its hash without re-reading.
//
// Also: the missing-art report (card image paths and template image sources that do not
// resolve to a file in the project).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { projectRoot, resolveProjectAsset } = require('./assets');
const { imageSize } = require('./imageSize');

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];
const INDEXED_ROOTS = ['assets', 'templates/assets'];
const MAX_FILES = 20000;

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const isIndexable = (rel) => [...IMAGE_EXT, ...FONT_EXT].includes(extOf(rel)) && INDEXED_ROOTS.some((r) => rel.startsWith(`${r}/`));

// Kind from the folder (assets/art, assets/icons, assets/fonts, assets/frames), else from the type.
function kindOf(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'templates') return FONT_EXT.includes(extOf(rel)) ? 'font' : 'frame';
  const folder = parts.length > 2 ? parts[1].toLowerCase() : '';
  if (folder === 'art') return 'art';
  if (folder === 'icons' || folder === 'icon' || folder === 'symbols') return 'icon';
  if (folder === 'fonts' || FONT_EXT.includes(extOf(rel))) return 'font';
  if (folder === 'frames' || folder === 'frame') return 'frame';
  return 'other';
}

function describeFile(abs, rel, previous) {
  const stat = fs.statSync(abs);
  const mtime = stat.mtimeMs;
  if (previous && previous.size === stat.size && previous.mtime === mtime && previous.sha256) {
    return { rel_path: rel, kind: kindOf(rel), sha256: previous.sha256, width: previous.width, height: previous.height, size: stat.size, mtime };
  }
  const data = fs.readFileSync(abs);
  const dims = IMAGE_EXT.includes(extOf(rel)) ? imageSize(data) : null;
  return {
    rel_path: rel, kind: kindOf(rel), sha256: crypto.createHash('sha256').update(data).digest('hex'),
    width: dims ? dims.width : null, height: dims ? dims.height : null, size: stat.size, mtime,
  };
}

function walkFiles(root, rel, out) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walkFiles(root, child, out);
    else if (e.isFile() && isIndexable(child)) out.push(child);
  }
}

const same = (a, b) => a.sha256 === b.sha256 && a.size === b.size && a.mtime === b.mtime && a.kind === b.kind
  && (a.width ?? null) === (b.width ?? null) && (a.height ?? null) === (b.height ?? null);

/**
 * Full scan of one project. db: { listAssets(projectId), applyAssetChanges(projectId, rows, removed) }
 * @returns {{ total: number, changed: number, removed: number }}
 */
function scanProjectAssets(userDataPath, projectId, db) {
  const root = projectRoot(userDataPath, projectId);
  if (!root) throw new Error('invalid project');
  const existing = new Map(db.listAssets(projectId).map((r) => [r.rel_path, r]));
  const files = [];
  for (const r of INDEXED_ROOTS) walkFiles(root, r, files);
  const rows = [];
  const seen = new Set();
  for (const rel of files) {
    seen.add(rel);
    let row;
    try { row = describeFile(path.join(root, ...rel.split('/')), rel, existing.get(rel)); } catch { continue; }
    const prev = existing.get(rel);
    if (!prev || !same(prev, row)) rows.push(row);
  }
  const removed = [...existing.keys()].filter((rel) => !seen.has(rel));
  db.applyAssetChanges(projectId, rows, removed);
  return { total: seen.size, changed: rows.length, removed: removed.length };
}

/** One path changed on disk (from the watcher): re-index it, or drop it (and anything under it). */
function updateAssetPath(userDataPath, projectId, relPath, db) {
  const root = projectRoot(userDataPath, projectId);
  if (!root) return false;
  const rel = relPath.replace(/\\/g, '/');
  if (rel.split('/').includes('..')) return false;
  const abs = path.join(root, ...rel.split('/'));
  let stat = null;
  try { stat = fs.statSync(abs); } catch { stat = null; }
  if (stat && stat.isDirectory()) { scanProjectAssets(userDataPath, projectId, db); return true; }
  const existing = db.listAssets(projectId);
  if (!stat) {
    const gone = existing.filter((r) => r.rel_path === rel || r.rel_path.startsWith(`${rel}/`)).map((r) => r.rel_path);
    db.applyAssetChanges(projectId, [], gone);
    return gone.length > 0;
  }
  if (!isIndexable(rel)) return false;
  const prev = existing.find((r) => r.rel_path === rel);
  const row = describeFile(abs, rel, prev);
  if (prev && same(prev, row)) return false;
  db.applyAssetChanges(projectId, [row], []);
  return true;
}

function walkLayers(layers, visit) {
  for (const l of layers || []) {
    visit(l);
    if (Array.isArray(l.children)) walkLayers(l.children, visit);
  }
}

/**
 * Card image paths and literal template image sources that don't resolve to a project file.
 * Empty image paths are not missing (they render the placeholder by design).
 */
function missingArt(userDataPath, projectId, cards, templates) {
  const resolves = (p) => Boolean(resolveProjectAsset(userDataPath, projectId, String(p).trim().replace(/\\/g, '/')));
  const missingCards = cards
    .filter((c) => c.image_path && String(c.image_path).trim() && !resolves(c.image_path))
    .map((c) => ({ id: c.id, name: c.name, image_path: c.image_path }));
  const missingTemplates = [];
  for (const t of templates) {
    let tpl;
    try { tpl = JSON.parse(t.content); } catch { continue; }
    walkLayers(tpl.layers, (l) => {
      if (l.type === 'image' && typeof l.src === 'string' && l.src.trim() && !l.src.includes('{{') && !resolves(l.src)) {
        missingTemplates.push({ id: t.id, name: t.name, layer: l.id, src: l.src });
      }
    });
  }
  return { cardIds: missingCards.map((c) => c.id), cards: missingCards, templates: missingTemplates };
}

/**
 * IPC: getAssets(projectId, kind?), getMissingArt(projectId). A project is fully scanned the first
 * time it is asked for; after that the watcher keeps it current through fileChanged().
 * db: { listAssets, applyAssetChanges, queryCards, listTemplates }
 */
function registerAssetIndexIpc(ipcMain, { userDataPath, db }) {
  const scanned = new Set();
  const ensureScanned = (projectId) => {
    if (scanned.has(projectId)) return;
    scanProjectAssets(userDataPath, projectId, db);
    scanned.add(projectId);
  };
  ipcMain.handle('getAssets', (_, projectId, kind) => {
    ensureScanned(projectId);
    return db.listAssets(projectId, kind || null);
  });
  ipcMain.handle('getMissingArt', (_, projectId) => {
    ensureScanned(projectId);
    return missingArt(userDataPath, projectId, db.queryCards(projectId, {}), db.listTemplates(projectId));
  });
  return {
    fileChanged({ projectId, relPath }) {
      if (!scanned.has(projectId)) return; // indexed on first use
      try { updateAssetPath(userDataPath, projectId, relPath, db); } catch (err) { console.warn(`[assets] index update failed: ${err.message}`); }
    },
  };
}

module.exports = { scanProjectAssets, updateAssetPath, missingArt, kindOf, isIndexable, registerAssetIndexIpc };
