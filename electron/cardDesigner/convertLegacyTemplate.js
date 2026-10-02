// Converts a pixel-based template (the format used before schema v1: meta.width/height/dpi,
// layers with x/y/width/height in pixels, zIndex, background) into template schema v1
// (docs/card-designer-spec.md: mm frames anchored to the card edges).
//
// Anchors are inferred so converted templates reflow sensibly when the card size changes:
//   wide element with (nearly) equal side margins  -> stretch (left + right)
//   element centred in the right third             -> right + width
//   otherwise                                      -> left + width
// and the same vertically (bottom third -> bottom + height).

const DEFAULT_BLEED_MM = 3;
const DEFAULT_SAFE_MM = 3;
const LEGACY_DEFAULT_CARD_RADIUS_PX = 24;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const WEIGHTS = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400,
  medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// "Georgia Bold Italic" -> { family: "Georgia", weight: 700, italic: true }
function parseFontName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  let weight = 400;
  let italic = false;
  while (words.length > 1) {
    const w = words[words.length - 1].toLowerCase();
    if (w === 'italic' || w === 'oblique') { italic = true; words.pop(); } else if (WEIGHTS[w]) { weight = WEIGHTS[w]; words.pop(); } else break;
  }
  return { family: words.join(' ') || 'sans-serif', weight, italic };
}

// 9-point align ("center top") -> CSS object-position ("50% 0%").
function objectPosition(align) {
  const words = String(align || 'center center').toLowerCase().split(/\s+/);
  let x = null;
  let y = null;
  const pending = [];
  for (const w of words) {
    if (w === 'left') x = '0%'; else if (w === 'right') x = '100%';
    else if (w === 'top') y = '0%'; else if (w === 'bottom') y = '100%';
    else if (w === 'center' || w === 'middle') pending.push('50%');
  }
  for (const p of pending) { if (x === null) x = p; else if (y === null) y = p; }
  return `${x || '50%'} ${y || '50%'}`;
}

function inferFrame(rect, cardW, cardH) {
  const L = rect.x;
  const R = cardW - (rect.x + rect.w);
  const T = rect.y;
  const B = cardH - (rect.y + rect.h);
  const frame = {};
  if (rect.w >= 0.6 * cardW && Math.abs(L - R) <= 1) { frame.left = round2(L); frame.right = round2(R); }
  else if (rect.x + rect.w / 2 > (2 * cardW) / 3) { frame.right = round2(R); frame.width = round2(rect.w); }
  else { frame.left = round2(L); frame.width = round2(rect.w); }
  if (rect.h >= 0.6 * cardH && Math.abs(T - B) <= 1) { frame.top = round2(T); frame.bottom = round2(B); }
  else if (rect.y + rect.h / 2 > (2 * cardH) / 3) { frame.bottom = round2(B); frame.height = round2(rect.h); }
  else { frame.top = round2(T); frame.height = round2(rect.h); }
  return frame;
}

function sortedLegacyLayers(layers) {
  return (Array.isArray(layers) ? layers : [])
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => (num(a.layer.zIndex) - num(b.layer.zIndex)) || (a.index - b.index))
    .map((e) => e.layer);
}

function isLegacyTemplate(t) {
  return Boolean(t && typeof t === 'object' && !('schemaVersion' in t) && t.meta && Number(t.meta.dpi) > 0);
}

/**
 * @returns {{ template: object, notes: string[] }}
 */
function convertLegacyTemplate(old) {
  if (!isLegacyTemplate(old)) throw new Error('not a legacy (pixel) template');
  const meta = old.meta;
  const dpi = num(meta.dpi, 300);
  const mm = (px) => round2((num(px) / dpi) * 25.4);
  const pt = (px) => Math.round(((num(px) / dpi) * 72) * 10) / 10;
  const cardW = mm(meta.width);
  const cardH = mm(meta.height);
  const notes = [];
  // Existing ids are kept where valid and unique; generated ids avoid every existing one.
  const reserved = new Set();
  const assigned = new Set();
  const uniqueId = (wanted, fallback) => {
    const base = ID_RE.test(String(wanted || '')) ? String(wanted) : fallback;
    let id = base;
    for (let n = 2; assigned.has(id) || reserved.has(id); n++) id = `${base}-${n}`;
    assigned.add(id);
    return id;
  };
  const keepId = (wanted, fallback) => {
    const id = String(wanted || '');
    if (ID_RE.test(id) && !assigned.has(id)) { assigned.add(id); return id; }
    return uniqueId(`${fallback}`, fallback);
  };

  const bleed = DEFAULT_BLEED_MM;
  const fullBleed = { left: -bleed, right: -bleed, top: -bleed, bottom: -bleed };
  const layers = [];
  // Reserve existing ids first so background layers never steal them.
  for (const l of old.layers || []) if (l && ID_RE.test(String(l.id))) reserved.add(String(l.id));

  const bg = old.background || {};
  if (bg.color) layers.push({ id: uniqueId('background', 'background'), type: 'shape', shape: 'rect', frame: { ...fullBleed }, fill: String(bg.color) });
  if (bg.image) {
    const fitMap = { cover: 'cover', contain: 'contain', stretch: 'fill', tile: 'tile' };
    layers.push({
      id: uniqueId('background-image', 'background-image'), type: 'image', frame: { ...fullBleed }, src: String(bg.image),
      objectFit: fitMap[bg.fit] || 'cover', placeholder: 'none',
    });
  }

  for (const l of sortedLegacyLayers(old.layers)) {
    if (!l || typeof l !== 'object') continue;
    const rect = { x: mm(l.x), y: mm(l.y), w: mm(l.width), h: mm(l.height) };
    const out = { id: keepId(l.id, ID_RE.test(String(l.id || '')) ? String(l.id) : 'layer') };
    let converted = true;

    if (l.type === 'text') {
      const font = parseFontName(l.font);
      const style = { font: font.family, sizePt: pt(num(l.fontSize, 16)) };
      if (font.weight !== 400) style.weight = font.weight;
      if (font.italic) style.italic = true;
      if (l.color) style.color = String(l.color);
      if (l.align && l.align !== 'left') style.align = l.align;
      style.valign = l.valign === 'middle' || l.valign === 'center' ? 'middle' : l.valign === 'bottom' ? 'bottom' : 'top';
      if (l.lineHeight) style.lineHeight = num(l.lineHeight, 1.2);
      Object.assign(out, { type: 'text', frame: inferFrame(rect, cardW, cardH), text: String(l.value ?? ''), style });
      if (l.overflow === 'shrink') {
        out.fit = { strategy: ['shrink'] };
        if (l.minFontSize !== undefined) out.fit.minPt = pt(l.minFontSize);
      } else if (l.overflow === 'clip') {
        style.wrap = false;
      }
    } else if (l.type === 'image' || l.type === 'icon') {
      const fitMap = { cover: 'cover', contain: 'contain', stretch: 'fill', tile: 'tile' };
      Object.assign(out, {
        type: 'image', frame: inferFrame(rect, cardW, cardH), src: String(l.source ?? ''),
        objectFit: fitMap[l.fit] || 'cover', objectPosition: objectPosition(l.align), placeholder: 'proxy',
      });
      if (num(l.cornerRadius) > 0) out.radiusMm = mm(l.cornerRadius);
    } else if (l.type === 'shape') {
      let r = rect;
      let shape = l.cornerRadius > 0 ? 'roundRect' : 'rect';
      if (l.shape === 'circle') {
        // The old renderer drew a circle inscribed in the box; keep that look with a square ellipse.
        const d = Math.min(rect.w, rect.h);
        r = { x: rect.x + (rect.w - d) / 2, y: rect.y + (rect.h - d) / 2, w: d, h: d };
        shape = 'ellipse';
      } else if (l.shape === 'ellipse') {
        shape = 'ellipse';
      }
      Object.assign(out, { type: 'shape', shape, frame: inferFrame(r, cardW, cardH) });
      if (l.fill) out.fill = String(l.fill);
      if (l.stroke && num(l.strokeWidth) > 0) { out.stroke = String(l.stroke); out.strokeMm = mm(l.strokeWidth); }
      if (shape === 'roundRect') out.radiusMm = mm(l.cornerRadius);
    } else {
      converted = false;
      notes.push(`layer "${l.id}": unknown type "${l.type}" dropped`);
    }
    if (!converted) continue;
    if (l.opacity !== undefined && num(l.opacity, 1) < 1) out.opacity = Math.max(0, num(l.opacity, 1));
    if (l.visible === false) out.hidden = true;
    if (l.locked) out.locked = true;
    layers.push(out);
  }

  const template = {
    schemaVersion: 1,
    name: String(meta.name || 'Untitled'),
    size: {
      widthMm: cardW,
      heightMm: cardH,
      bleedMm: bleed,
      safeMm: DEFAULT_SAFE_MM,
      cornerRadiusMm: mm(old.cornerRadius === undefined ? LEGACY_DEFAULT_CARD_RADIUS_PX : old.cornerRadius),
    },
    layers,
  };
  return { template, notes };
}

module.exports = { convertLegacyTemplate, isLegacyTemplate, inferFrame, parseFontName, objectPosition };
