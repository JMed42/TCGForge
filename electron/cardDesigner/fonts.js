// Font resolution: bundled TTF/OTF files from {templateDir}/assets/fonts, then system fonts,
// then sans-serif. node-canvas registrations are process-global, so each file registers once.

const fs = require('fs');
const path = require('path');
const { registerFont, createCanvas } = require('canvas');

const WEIGHTS = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300,
  regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

const registeredFiles = new Set();
const availability = new Map();
let probeCtx = null;

// "Inter Bold Italic" → { family: 'Inter', weight: 700, style: 'italic' }
function parseFontName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  let weight = 400;
  let style = 'normal';
  while (words.length > 1) {
    const w = words[words.length - 1].toLowerCase();
    if (w === 'italic' || w === 'oblique') { style = 'italic'; words.pop(); }
    else if (WEIGHTS[w]) { weight = WEIGHTS[w]; words.pop(); }
    else break;
  }
  return { family: words.join(' ') || 'sans-serif', weight, style };
}

// Register every font file in dir. "Inter-Bold.ttf" → family "Inter", weight 700.
function registerFontDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.(ttf|otf)$/i.test(file)) continue;
    const full = path.join(dir, file);
    if (registeredFiles.has(full)) continue;
    const base = file.replace(/\.(ttf|otf)$/i, '');
    const [familyPart, stylePart = 'Regular'] = base.split('-');
    const parsed = parseFontName(`${familyPart} ${stylePart.replace(/([a-z])([A-Z])/g, '$1 $2')}`);
    try {
      registerFont(full, { family: familyPart, weight: String(parsed.weight), style: parsed.style });
      registeredFiles.add(full);
      availability.clear();
    } catch (err) {
      console.warn(`[cardDesigner] could not register font ${full}: ${err.message}`);
    }
  }
}

// Pango silently substitutes missing families, so detect "not installed" by comparing
// glyph metrics against a family that certainly does not exist.
function isFamilyAvailable(family) {
  if (/^(sans-serif|serif|monospace)$/i.test(family)) return true;
  if (availability.has(family)) return availability.get(family);
  if (!probeCtx) probeCtx = createCanvas(10, 10).getContext('2d');
  const probe = 'AaBbGgMmWwQq@#1234567890';
  const width = (fam) => {
    probeCtx.font = `400 40px "${fam}"`;
    return probeCtx.measureText(probe).width;
  };
  const missing = width('__tcg_missing_font__');
  const ok = Math.abs(width(family) - missing) > 0.01;
  availability.set(family, ok);
  return ok;
}

// CSS font shorthand for ctx.font plus whether we fell back.
function resolveFont(name, sizePx, warn) {
  const { family, weight, style } = parseFontName(name);
  let fam = family;
  let fellBack = false;
  if (!isFamilyAvailable(family)) {
    fellBack = true;
    fam = 'sans-serif';
    if (warn) warn(`font "${name}" not found, falling back to sans-serif`);
  }
  const quoted = /^(sans-serif|serif|monospace)$/i.test(fam) ? fam : `"${fam}"`;
  return { css: `${style} ${weight} ${sizePx}px ${quoted}`, fellBack };
}

module.exports = { parseFontName, registerFontDir, isFamilyAvailable, resolveFont };
