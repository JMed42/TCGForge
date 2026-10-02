// Print-and-play sheets: many cards per Letter/A4 page at physical size, with optional bleed and
// crop marks. This module does the layout in millimetres; the pages are drawn by the renderer's
// #render route and printed to PDF (electron/renderWindow.js), so text stays vector.

const PAPER_MM = {
  letter: { width: 215.9, height: 279.4, label: 'Letter' },
  a4: { width: 210, height: 297, label: 'A4' },
};
const DEFAULT_MARGIN_MM = 6.35; // 1/4 in: inside the unprintable edge of most printers
const MM_TO_PT = 72 / 25.4;
const CROP_MARK_GAP_MM = 1;
const CROP_MARK_LENGTH_MM = 4;

function cardSizeMm(template) {
  return { width: template.size.widthMm, height: template.size.heightMm };
}

function fit(pageW, pageH, cellW, cellH, margin) {
  const cols = Math.floor((pageW - 2 * margin) / cellW + 1e-9);
  const rows = Math.floor((pageH - 2 * margin) / cellH + 1e-9);
  return { cols: Math.max(0, cols), rows: Math.max(0, rows) };
}

/**
 * Grid for one sheet. Picks the orientation that fits more cards (portrait on a tie) and
 * centres the grid on the page.
 */
function layoutSheet({ paper = 'letter', cardWidthMm, cardHeightMm, bleedMm = 0, marginMm = DEFAULT_MARGIN_MM }) {
  const size = PAPER_MM[paper];
  if (!size) throw new Error(`unknown paper "${paper}"`);
  const cellW = cardWidthMm + 2 * bleedMm;
  const cellH = cardHeightMm + 2 * bleedMm;
  const portrait = { orientation: 'portrait', w: size.width, h: size.height, ...fit(size.width, size.height, cellW, cellH, marginMm) };
  const landscape = { orientation: 'landscape', w: size.height, h: size.width, ...fit(size.height, size.width, cellW, cellH, marginMm) };
  const best = landscape.cols * landscape.rows > portrait.cols * portrait.rows ? landscape : portrait;
  return {
    paper,
    orientation: best.orientation,
    pageWidthMm: best.w,
    pageHeightMm: best.h,
    cols: best.cols,
    rows: best.rows,
    perPage: best.cols * best.rows,
    cardWidthMm,
    cardHeightMm,
    bleedMm,
    cellWidthMm: cellW,
    cellHeightMm: cellH,
    originXMm: (best.w - best.cols * cellW) / 2,
    originYMm: (best.h - best.rows * cellH) / 2,
  };
}

// Trim box (the cut line) of grid slot `index` on a page, in mm.
function slotTrimMm(layout, index) {
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  return {
    x: layout.originXMm + col * layout.cellWidthMm + layout.bleedMm,
    y: layout.originYMm + row * layout.cellHeightMm + layout.bleedMm,
    width: layout.cardWidthMm,
    height: layout.cardHeightMm,
  };
}

// Crop marks as line segments [x1, y1, x2, y2] in mm: every trim line extended into the margin.
function cropMarks(layout, usedSlots) {
  const cols = Math.min(layout.cols, usedSlots);
  const rows = Math.ceil(usedSlots / layout.cols);
  const gridLeft = layout.originXMm;
  const gridTop = layout.originYMm;
  const gridRight = gridLeft + cols * layout.cellWidthMm;
  const gridBottom = gridTop + rows * layout.cellHeightMm;
  const xs = new Set();
  const ys = new Set();
  for (let c = 0; c < cols; c++) {
    const t = slotTrimMm(layout, c);
    xs.add(+t.x.toFixed(4)); xs.add(+(t.x + t.width).toFixed(4));
  }
  for (let r = 0; r < rows; r++) {
    const t = slotTrimMm(layout, r * layout.cols);
    ys.add(+t.y.toFixed(4)); ys.add(+(t.y + t.height).toFixed(4));
  }
  const len = (space) => Math.max(0, Math.min(CROP_MARK_LENGTH_MM, space - CROP_MARK_GAP_MM));
  const topLen = len(gridTop);
  const bottomLen = len(layout.pageHeightMm - gridBottom);
  const leftLen = len(gridLeft);
  const rightLen = len(layout.pageWidthMm - gridRight);
  const marks = [];
  for (const x of xs) {
    if (topLen > 0) marks.push([x, gridTop - CROP_MARK_GAP_MM - topLen, x, gridTop - CROP_MARK_GAP_MM]);
    if (bottomLen > 0) marks.push([x, gridBottom + CROP_MARK_GAP_MM, x, gridBottom + CROP_MARK_GAP_MM + bottomLen]);
  }
  for (const y of ys) {
    if (leftLen > 0) marks.push([gridLeft - CROP_MARK_GAP_MM - leftLen, y, gridLeft - CROP_MARK_GAP_MM, y]);
    if (rightLen > 0) marks.push([gridRight + CROP_MARK_GAP_MM, y, gridRight + CROP_MARK_GAP_MM + rightLen, y]);
  }
  return marks;
}

/**
 * Pages for the render host: each page lists cards (top-left of their bleed box, in mm) and its
 * crop marks. cardAt(i) returns the card for slot i (copies are consecutive).
 */
function buildSheetPages(layout, count, cardAt, { cropMarks: withMarks = true } = {}) {
  if (layout.perPage < 1) throw new Error('the card does not fit on this paper size');
  const pages = [];
  for (let start = 0; start < count; start += layout.perPage) {
    const onPage = Math.min(layout.perPage, count - start);
    const items = [];
    for (let s = 0; s < onPage; s++) {
      const t = slotTrimMm(layout, s);
      items.push({ card: cardAt(start + s), xMm: t.x - layout.bleedMm, yMm: t.y - layout.bleedMm });
    }
    pages.push({ items, marks: withMarks ? cropMarks(layout, onPage) : [] });
  }
  return pages;
}

// A single card on its own page: trim size plus bleed, plus room for crop marks if wanted.
function singleCardPage(template, { bleedMm = template.size.bleedMm, cropMarks: withMarks = true } = {}) {
  const margin = withMarks ? CROP_MARK_GAP_MM + CROP_MARK_LENGTH_MM : 0;
  const w = template.size.widthMm + 2 * bleedMm + 2 * margin;
  const h = template.size.heightMm + 2 * bleedMm + 2 * margin;
  const layout = {
    pageWidthMm: w, pageHeightMm: h, cols: 1, rows: 1, perPage: 1,
    cardWidthMm: template.size.widthMm, cardHeightMm: template.size.heightMm, bleedMm,
    cellWidthMm: template.size.widthMm + 2 * bleedMm, cellHeightMm: template.size.heightMm + 2 * bleedMm,
    originXMm: margin, originYMm: margin,
  };
  return layout;
}

module.exports = {
  PAPER_MM, DEFAULT_MARGIN_MM, MM_TO_PT, cardSizeMm, layoutSheet, slotTrimMm, cropMarks, buildSheetPages, singleCardPage,
};
