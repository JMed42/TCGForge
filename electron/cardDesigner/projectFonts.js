// Font files a project brings: {project}/assets/fonts/*.ttf|otf|woff|woff2 (and the Phase 0
// location templates/assets/fonts). The renderer registers each as a FontFace loaded through
// tcg-asset://. "Cinzel-Bold.ttf" -> family "Cinzel", weight 700; "Inter-SemiBoldItalic.otf" ->
// family "Inter", weight 600, italic.

const fs = require('fs');
const path = require('path');

const WEIGHTS = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400,
  medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;

function describeFontFile(file) {
  const base = file.replace(FONT_EXT, '');
  const [family, styleRaw = 'Regular'] = base.split('-');
  let rest = styleRaw.toLowerCase();
  let italic = false;
  if (rest.endsWith('italic')) { italic = true; rest = rest.slice(0, -'italic'.length); }
  const weight = WEIGHTS[rest] || (rest === '' ? 400 : 400);
  return { family: family.trim(), weight, style: italic ? 'italic' : 'normal' };
}

function listProjectFonts(projectDir) {
  const out = [];
  for (const rel of ['assets/fonts', 'templates/assets/fonts']) {
    const dir = path.join(projectDir, ...rel.split('/'));
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files.sort()) {
      if (!FONT_EXT.test(f)) continue;
      out.push({ ...describeFontFile(f), relPath: `${rel}/${f}` });
    }
  }
  return out;
}

module.exports = { listProjectFonts, describeFontFile };
