// Card art: images chosen in the card editor are copied into {userData}/projects/{id}/assets/art/
// and the card stores the project-relative path ("assets/art/ember-drake-1a2b3c4d.png"). Copies mean the
// original file can move or be deleted; relative paths survive the data folder moving.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const templates = require('./templates');

const ART_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif'];
const MAX_ART_BYTES = 50 * 1024 * 1024;

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

/**
 * Copy an image into the project's art folder (deduplicated by content hash).
 * @returns {Promise<string>} project-relative path, e.g. "assets/art/hero-1a2b3c4d.png"
 */
async function importCardArt(userDataPath, projectId, sourcePath) {
  const ext = extOf(sourcePath);
  if (!ART_EXTENSIONS.includes(ext)) throw new Error(`unsupported image type ".${ext}" (use ${ART_EXTENSIONS.join(', ')})`);
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > MAX_ART_BYTES) throw new Error('image is larger than 50 MB');
  const data = fs.readFileSync(sourcePath);
  await loadImage(data); // throws if it isn't a decodable image

  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
  const base = templates.slugify(path.basename(sourcePath, path.extname(sourcePath))).slice(0, 48) || 'art';
  const rel = `assets/art/${base}-${hash}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const dest = path.join(templates.projectDir(userDataPath, projectId), ...rel.split('/'));
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return rel;
}

// Card image_path → absolute file: relative paths are inside the project folder.
function resolveArtPath(userDataPath, projectId, imagePath) {
  if (!imagePath) return null;
  const projectRoot = templates.projectDir(userDataPath, projectId);
  const abs = path.isAbsolute(imagePath) ? imagePath : path.resolve(projectRoot, imagePath);
  if (!ART_EXTENSIONS.includes(extOf(abs))) return null;
  return abs;
}

// Small PNG data URL for the card editor (the renderer can't load file:// from the dev origin).
async function thumbnail(userDataPath, projectId, imagePath, maxSize = 160) {
  const abs = resolveArtPath(userDataPath, projectId, imagePath);
  if (!abs || !fs.existsSync(abs)) return null;
  const img = await loadImage(abs);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { dataUrl: `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`, width: img.width, height: img.height };
}

module.exports = { importCardArt, resolveArtPath, thumbnail, ART_EXTENSIONS };
