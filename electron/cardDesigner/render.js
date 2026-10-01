// Off-screen card renderer (spec §P0.2). One code path for preview, PNG, JPEG and PDF output:
// every layer is drawn in template units and the context is scaled by outputDpi / meta.dpi.

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { buildFieldMap, bindString } = require('./bind');
const { computeFit } = require('./fit');
const { registerFontDir, resolveFont } = require('./fonts');
const { layoutText } = require('./textLayout');

const DEFAULT_CARD_RADIUS = 24;
const PLACEHOLDER_FILL = '#3a3d52';
const PLACEHOLDER_LINE = '#5c6078';
const KNOWN_TYPES = new Set(['image', 'icon', 'text', 'shape']);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boxOf(layer) {
  return { x: num(layer.x), y: num(layer.y), width: num(layer.width), height: num(layer.height) };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius === 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function validateTemplate(template) {
  const meta = template && template.meta;
  if (!meta) throw new Error('template.meta is required');
  const width = num(meta.width);
  const height = num(meta.height);
  const dpi = num(meta.dpi);
  if (width <= 0 || height <= 0) throw new Error('template.meta.width/height must be positive');
  if (dpi <= 0) throw new Error('template.meta.dpi must be positive');
  return { width, height, dpi };
}

// Output pixel size for a template at a given DPI.
function outputSize(template, dpi) {
  const meta = validateTemplate(template);
  const scale = dpi / meta.dpi;
  return { width: Math.round(meta.width * scale), height: Math.round(meta.height * scale), scale };
}

function resolveAssetPath(src, templateDir) {
  if (!src) return null;
  if (path.isAbsolute(src)) return src;
  return templateDir ? path.resolve(templateDir, src) : null;
}

async function loadImageCached(cache, filePath) {
  if (!filePath) return null;
  if (cache.has(filePath)) return cache.get(filePath);
  let img = null;
  if (fs.existsSync(filePath)) {
    try { img = await loadImage(filePath); } catch { img = null; }
  }
  cache.set(filePath, img);
  return img;
}

function drawPlaceholder(ctx, box) {
  ctx.fillStyle = PLACEHOLDER_FILL;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeStyle = PLACEHOLDER_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y);
  ctx.lineTo(box.x + box.width, box.y + box.height);
  ctx.moveTo(box.x + box.width, box.y);
  ctx.lineTo(box.x, box.y + box.height);
  ctx.stroke();
}

// Paint img into box with a fit mode. Caller has already clipped to box when needed.
function drawFitted(ctx, img, box, mode, align) {
  if (mode === 'tile') {
    const pattern = ctx.createPattern(img, 'repeat');
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, box.width, box.height);
    ctx.restore();
    return;
  }
  const r = computeFit(img.width, img.height, box, mode, align);
  if (r.clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
  }
}

async function drawImageLayer(ctx, layer, env) {
  const box = boxOf(layer);
  const { value, unresolved } = bindString(layer.source || '', env.fields);
  const filePath = resolveAssetPath(value, env.templateDir);
  const img = await loadImageCached(env.images, filePath);
  if (!img) {
    if (value) env.warn(`layer "${layer.id}": image not found (${value})`);
    else if (unresolved.length) env.info(`layer "${layer.id}": no value for {{${unresolved.join('}}, {{')}}}, drawing placeholder`);
    drawPlaceholder(ctx, box);
    return;
  }
  drawFitted(ctx, img, box, layer.fit || 'cover', layer.align || 'center center');
}

function drawTextLayer(ctx, layer, env) {
  const box = boxOf(layer);
  const { value } = bindString(layer.value == null ? '' : String(layer.value), env.fields);
  if (!value) return;

  const fontName = layer.font || 'sans-serif';
  let warned = false;
  const fontFor = (size) => resolveFont(fontName, size, (msg) => {
    if (!warned) { warned = true; env.warn(`layer "${layer.id}": ${msg}`); }
  }).css;

  // Spec: "min 8pt". Read literally in template units (8 template px) because 8 physical pt
  // (33 px at 300 dpi) is larger than most sizes in the spec's own example. Per-layer override.
  const minSize = num(layer.minFontSize, 8);
  const result = layoutText(ctx, value, box, {
    fontSize: num(layer.fontSize, 16),
    overflow: layer.overflow || 'wrap',
    lineHeight: layer.lineHeight ? num(layer.lineHeight, 1.2) : undefined,
    minSize,
  }, fontFor);

  const align = layer.align || 'left';
  const valign = layer.valign || 'top';
  const blockHeight = result.lines.length * result.lineHeight;
  let top = box.y;
  if (valign === 'middle' || valign === 'center') top = box.y + (box.height - blockHeight) / 2;
  else if (valign === 'bottom') top = box.y + box.height - blockHeight;

  let x = box.x;
  if (align === 'center') x = box.x + box.width / 2;
  else if (align === 'right') x = box.x + box.width;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.font = result.font;
  ctx.fillStyle = layer.color || '#000000';
  ctx.textAlign = align === 'center' || align === 'right' ? align : 'left';
  ctx.textBaseline = 'middle';
  result.lines.forEach((line, i) => {
    ctx.fillText(line, x, top + i * result.lineHeight + result.lineHeight / 2);
  });
  ctx.restore();
}

function drawShapeLayer(ctx, layer) {
  const box = boxOf(layer);
  const shape = layer.shape || 'rect';
  ctx.beginPath();
  if (shape === 'circle') {
    const r = Math.min(box.width, box.height) / 2;
    ctx.arc(box.x + box.width / 2, box.y + box.height / 2, r, 0, Math.PI * 2);
  } else if (shape === 'ellipse') {
    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, box.x, box.y, box.width, box.height, num(layer.cornerRadius));
  }
  if (layer.fill) {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  const strokeWidth = num(layer.strokeWidth);
  if (layer.stroke && strokeWidth > 0) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

// Stable sort by zIndex, ties keep document order.
function orderedLayers(layers) {
  return (Array.isArray(layers) ? layers : [])
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => (num(a.layer.zIndex) - num(b.layer.zIndex)) || (a.index - b.index))
    .map((e) => e.layer);
}

/**
 * Render one card.
 * @param {object} card      row from the cards table
 * @param {object} template  parsed template JSON
 * @param {object} options   { dpi, templateDir }
 * @returns {Promise<{canvas, width, height, warnings: string[]}>}
 */
async function renderCard(card, template, { dpi, templateDir } = {}) {
  const meta = validateTemplate(template);
  const outDpi = num(dpi, meta.dpi);
  const warnings = [];
  const env = {
    meta,
    templateDir,
    fields: buildFieldMap(card || {}),
    images: new Map(),
    warn: (msg) => { warnings.push(msg); console.warn(`[cardDesigner] ${msg}`); },
    info: () => {},
  };

  // Must happen before createCanvas so Pango sees the fonts.
  if (templateDir) registerFontDir(path.join(templateDir, 'assets', 'fonts'));

  const { width, height, scale } = outputSize(template, outDpi);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.patternQuality = 'best';
  ctx.quality = 'best';
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);

  const cardRadius = template.cornerRadius === undefined ? DEFAULT_CARD_RADIUS : num(template.cornerRadius);
  roundRectPath(ctx, 0, 0, meta.width, meta.height, cardRadius);
  ctx.clip();

  const bg = template.background || {};
  if (bg.color) {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, meta.width, meta.height);
  }
  if (bg.image) {
    const { value } = bindString(bg.image, env.fields);
    const img = await loadImageCached(env.images, resolveAssetPath(value, templateDir));
    if (img) drawFitted(ctx, img, { x: 0, y: 0, width: meta.width, height: meta.height }, bg.fit || 'cover', bg.align);
    else env.warn(`background image not found (${value})`);
  }

  for (const layer of orderedLayers(template.layers)) {
    if (!layer || layer.visible === false) continue;
    if (!KNOWN_TYPES.has(layer.type)) {
      env.warn(`layer "${layer.id}": unknown type "${layer.type}", skipped`);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, num(layer.opacity, 1)));
    const radius = num(layer.cornerRadius);
    if (radius > 0 && layer.type !== 'shape') {
      const b = boxOf(layer);
      roundRectPath(ctx, b.x, b.y, b.width, b.height, radius);
      ctx.clip();
    }
    try {
      if (layer.type === 'image' || layer.type === 'icon') await drawImageLayer(ctx, layer, env);
      else if (layer.type === 'text') drawTextLayer(ctx, layer, env);
      else if (layer.type === 'shape') drawShapeLayer(ctx, layer);
    } catch (err) {
      env.warn(`layer "${layer.id}": ${err.message}`);
    }
    ctx.restore();
  }

  return { canvas, width, height, warnings };
}

// node-canvas frees native surfaces in N-API finalizers, which only run when the event loop
// turns. Loops that render many cards must await this between cards or memory grows ~3 MB
// per 300-dpi card until the loop ends.
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Pays Pango/fontconfig start-up cost (~0.5 s) ahead of the first real render.
function warmUp() {
  const ctx = createCanvas(8, 8).getContext('2d');
  ctx.font = '400 12px sans-serif';
  ctx.fillText('warm', 0, 8);
}

module.exports = { renderCard, outputSize, validateTemplate, orderedLayers, yieldToEventLoop, warmUp };
