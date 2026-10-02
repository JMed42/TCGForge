// Card art: images chosen in the card editor are copied into {userData}/projects/{id}/assets/art/
// and the card stores the project-relative path ("assets/art/ember-drake-1a2b3c4d.png"). Copies
// mean the original file can move or be deleted; relative paths survive the data folder moving.
//
// Image decoding uses Electron's nativeImage in the app. Outside Electron (unit tests) it falls
// back to node-canvas, which is a dev dependency only.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const templates = require('./templates');
const { resolveProjectAsset } = require('../assets');

const ART_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif'];
const MAX_ART_BYTES = 50 * 1024 * 1024;

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

const inElectron = Boolean(process.versions.electron) && process.type === 'browser';

// { width, height, thumbnailPng(maxSize) } or throws if the data isn't a decodable image.
async function decode(data) {
  if (inElectron) {
    // nativeImage reads PNG and JPEG; GIFs are accepted by signature (Chromium renders them).
    if (data.subarray(0, 6).toString('ascii').startsWith('GIF8')) {
      const width = data.readUInt16LE(6);
      const height = data.readUInt16LE(8);
      if (!width || !height) throw new Error('not a valid GIF');
      return { width, height, thumbnailPng: null };
    }
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(data);
    if (img.isEmpty()) throw new Error('not a valid PNG or JPEG image');
    const { width, height } = img.getSize();
    return {
      width,
      height,
      thumbnailPng: (max) => {
        const scale = Math.min(1, max / Math.max(width, height));
        return img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toPNG();
      },
    };
  }
  const { createCanvas, loadImage } = require('canvas');
  const img = await loadImage(data);
  return {
    width: img.width,
    height: img.height,
    thumbnailPng: (max) => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toBuffer('image/png');
    },
  };
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
  await decode(data); // throws if it isn't a decodable image

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

// Small PNG data URL for the card editor. Only image files inside the project are read.
async function thumbnail(userDataPath, projectId, imagePath, maxSize = 160) {
  if (!imagePath || !ART_EXTENSIONS.includes(extOf(imagePath))) return null;
  const abs = resolveProjectAsset(userDataPath, projectId, imagePath);
  if (!abs) return null;
  const info = await decode(fs.readFileSync(abs));
  const png = info.thumbnailPng ? info.thumbnailPng(maxSize) : null;
  return { dataUrl: png ? `data:image/png;base64,${png.toString('base64')}` : null, width: info.width, height: info.height };
}

module.exports = { importCardArt, thumbnail, ART_EXTENSIONS };
