// .tcgtemplate files (spec: "Templates: JSON in SQLite, exportable as .tcgtemplate files"):
// one JSON document holding the template plus the project files it references (frames, icons,
// fonts), so a template can move between games. Card art is not included: it belongs to cards.
//
//   { format: "tcgtemplate", formatVersion: 1, app, exportedAt, template,
//     assets: [{ path, sha256, size, base64 }] }
//
// Import is defensive: every asset path must stay inside the target project, file types are
// whitelisted, hashes are verified, nothing existing is overwritten.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveProjectAsset, projectRoot } = require('../assets');
const { listProjectFonts } = require('./projectFonts');
const { validateTemplateObject } = require('./templates');

const FORMAT = 'tcgtemplate';
const FORMAT_VERSION = 1;
const ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'otf', 'woff', 'woff2'];
const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_ASSETS = 500;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const extOf = (p) => path.extname(p).slice(1).toLowerCase();

function walkLayers(layers, visit) {
  for (const l of layers || []) {
    visit(l);
    if (Array.isArray(l.children)) walkLayers(l.children, visit);
  }
}

// Files under the project matching a templated path like "frames/{{lower(faction)}}.png".
function expandPattern(projectDir, src) {
  const parts = src.replace(/\\/g, '/').split('/');
  const fileGlob = parts.pop();
  if (parts.some((p) => p.includes('{{')) || !fileGlob.includes('{{')) return [];
  // A source that is nothing but a binding ({{image_path}}) is card data, not a template file.
  const literal = fileGlob.replace(/\{\{[\s\S]*?\}\}/g, '')
  if (!parts.length && !literal) return [];
  const re = new RegExp(`^${fileGlob.split(/\{\{[\s\S]*?\}\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`, 'i');
  const out = [];
  for (const prefix of ['', 'assets', 'templates']) {
    const dir = path.join(projectDir, prefix, ...parts);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) if (re.test(f)) out.push([prefix, ...parts, f].filter(Boolean).join('/'));
  }
  return out;
}

/**
 * Project-relative paths of the files a template uses: literal image sources, files matching
 * templated image sources, and font files whose family the template names.
 */
function collectAssetPaths(userDataPath, projectId, template) {
  const projectDir = projectRoot(userDataPath, projectId);
  const found = new Set();
  const families = new Set();
  const addRel = (rel) => {
    const abs = resolveProjectAsset(userDataPath, projectId, rel);
    if (abs) found.add(path.relative(projectDir, abs).split(path.sep).join('/'));
  };
  walkLayers(template.layers, (l) => {
    if (l.type === 'image' && typeof l.src === 'string' && l.src.trim()) {
      if (!l.src.includes('{{')) addRel(l.src.trim());
      else for (const rel of expandPattern(projectDir, l.src.trim())) found.add(rel);
    }
    if ((l.type === 'text' || l.type === 'richText') && l.style && l.style.font) families.add(String(l.style.font).toLowerCase());
  });
  for (const f of listProjectFonts(projectDir)) if (families.has(f.family.toLowerCase())) found.add(f.relPath);
  return [...found].filter((rel) => ASSET_EXTENSIONS.includes(extOf(rel))).sort();
}

function buildPackage(userDataPath, projectId, template) {
  validateTemplateObject(template);
  const projectDir = projectRoot(userDataPath, projectId);
  let total = 0;
  const assets = collectAssetPaths(userDataPath, projectId, template).map((rel) => {
    const data = fs.readFileSync(path.join(projectDir, ...rel.split('/')));
    if (data.length > MAX_ASSET_BYTES) throw new Error(`${rel} is larger than 50 MB`);
    total += data.length;
    return { path: rel, sha256: sha256(data), size: data.length, base64: data.toString('base64') };
  });
  if (total > MAX_TOTAL_BYTES) throw new Error('template assets are larger than 150 MB in total');
  return { format: FORMAT, formatVersion: FORMAT_VERSION, app: 'TCGForge', exportedAt: new Date().toISOString(), template, assets };
}

// Parse and check a package. Throws with a readable message on anything unexpected.
function parsePackage(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw new Error('not a .tcgtemplate file (invalid JSON)'); }
  if (!pkg || pkg.format !== FORMAT) throw new Error('not a .tcgtemplate file');
  if (pkg.formatVersion !== FORMAT_VERSION) throw new Error(`unsupported .tcgtemplate version ${pkg.formatVersion}`);
  validateTemplateObject(pkg.template);
  const assets = Array.isArray(pkg.assets) ? pkg.assets : [];
  if (assets.length > MAX_ASSETS) throw new Error('too many assets in the file');
  let total = 0;
  const seen = new Set();
  const checked = assets.map((a) => {
    const rel = String(a && a.path || '').replace(/\\/g, '/');
    const parts = rel.split('/');
    if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || parts.some((p) => p === '..' || p === '' || p === '.') || rel.includes('\0')) {
      throw new Error(`unsafe asset path "${rel}"`);
    }
    if (!ASSET_EXTENSIONS.includes(extOf(rel))) throw new Error(`asset type not allowed: "${rel}"`);
    if (seen.has(rel.toLowerCase())) throw new Error(`duplicate asset "${rel}"`);
    seen.add(rel.toLowerCase());
    const data = Buffer.from(String(a.base64 || ''), 'base64');
    if (data.length > MAX_ASSET_BYTES) throw new Error(`${rel} is larger than 50 MB`);
    total += data.length;
    if (sha256(data) !== a.sha256) throw new Error(`${rel} is damaged (checksum mismatch)`);
    return { path: rel, data, sha256: a.sha256 };
  });
  if (total > MAX_TOTAL_BYTES) throw new Error('assets are larger than 150 MB in total');
  return { template: pkg.template, assets: checked };
}

// Replace exact string values (image sources) throughout the template.
function rewriteSources(template, mapping) {
  if (!mapping.size) return template;
  const copy = JSON.parse(JSON.stringify(template));
  walkLayers(copy.layers, (l) => {
    if (l.type === 'image' && typeof l.src === 'string' && mapping.has(l.src.trim())) l.src = mapping.get(l.src.trim());
  });
  return copy;
}

/**
 * Write a parsed package's assets into the project. Same file already there: reused. Different
 * file at the same path: written with a -2 suffix and literal references rewritten.
 * @returns {{ template, written: string[], reused: string[], renamed: Array<[string, string]>, warnings: string[] }}
 */
function installAssets(userDataPath, projectId, parsed) {
  const projectDir = projectRoot(userDataPath, projectId);
  if (!projectDir) throw new Error('invalid project');
  const written = [];
  const reused = [];
  const renamed = [];
  const warnings = [];
  const refMap = new Map();
  for (const a of parsed.assets) {
    let rel = a.path;
    let dest = path.resolve(projectDir, ...rel.split('/'));
    const inside = (p) => { const r = path.relative(projectDir, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
    if (!inside(dest)) throw new Error(`unsafe asset path "${rel}"`);
    if (fs.existsSync(dest)) {
      if (sha256(fs.readFileSync(dest)) === a.sha256) { reused.push(rel); continue; }
      const ext = path.extname(rel);
      const base = rel.slice(0, -ext.length);
      let n = 2;
      while (fs.existsSync(path.resolve(projectDir, ...`${base}-${n}${ext}`.split('/')))) n++;
      const next = `${base}-${n}${ext}`;
      renamed.push([rel, next]);
      rel = next;
      dest = path.resolve(projectDir, ...rel.split('/'));
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, a.data, { flag: 'wx' });
    written.push(rel);
  }
  // Point literal references at renamed files. A reference may omit the assets/ or templates/
  // prefix ("frames/x.png" for "assets/frames/x.png"), so map every form that resolved to it.
  for (const [from, to] of renamed) {
    for (const prefix of ['', 'assets/', 'templates/']) {
      if (from.startsWith(prefix)) refMap.set(from.slice(prefix.length), to);
    }
  }
  walkLayers(parsed.template.layers, (l) => {
    if (l.type === 'image' && typeof l.src === 'string' && l.src.includes('{{')) {
      for (const [from] of renamed) if (from.includes('/')) warnings.push(`"${l.id}" uses a templated path; the existing file kept its name and "${from}" was imported beside it`);
    }
  });
  return { template: rewriteSources(parsed.template, refMap), written, reused, renamed, warnings: [...new Set(warnings)] };
}

module.exports = { FORMAT, FORMAT_VERSION, collectAssetPaths, buildPackage, parsePackage, installAssets, ASSET_EXTENSIONS };
