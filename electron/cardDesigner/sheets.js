// Print-and-play sheets (spec §P0.4 stretch goal): many cards per Letter/A4 PDF page, placed
// at exact physical size, with optional bleed and crop marks.
//
// Units: millimetres for layout, PDF points (1/72 in) when drawing.

const PDFDocument = require('pdfkit');
const fs = require('fs');

const PAPER_MM = {
  letter: { width: 215.9, height: 279.4, label: 'Letter' },
  a4: { width: 210, height: 297, label: 'A4' },
};
const DEFAULT_MARGIN_MM = 6.35; // 1/4 in: inside the unprintable edge of most printers
const MM_TO_PT = 72 / 25.4;
const CROP_MARK_GAP_MM = 1;
const CROP_MARK_LENGTH_MM = 4;

function cardSizeMm(template) {
  const { width, height, dpi } = template.meta;
  return { width: (width / dpi) * 25.4, height: (height / dpi) * 25.4 };
}

function fit(pageW, pageH, cellW, cellH, margin) {
  const cols = Math.floor((pageW - 2 * margin) / cellW + 1e-9);
  const rows = Math.floor((pageH - 2 * margin) / cellH + 1e-9);
  return { cols: Math.max(0, cols), rows: Math.max(0, rows) };
}

/**
 * Grid for one sheet. Picks the orientation that fits more cards (portrait on a tie) and
 * centres the grid on the page.
 * @returns {{ paper, orientation, pageWidthMm, pageHeightMm, cols, rows, perPage,
 *             cardWidthMm, cardHeightMm, bleedMm, cellWidthMm, cellHeightMm, originXMm, originYMm }}
 */
function layoutSheet({ paper = 'letter', cardWidthMm, cardHeightMm, bleedMm = 0, marginMm = DEFAULT_MARGIN_MM }) {
  const size = PAPER_MM[paper];
  if (!size) throw new Error(`unknown paper "${paper}"`);
  const cellW = cardWidthMm + 2 * bleedMm;
  const cellH = cardHeightMm + 2 * bleedMm;
  const portrait = { orientation: 'portrait', w: size.width, h: size.height, ...fit(size.width, size.height, cellW, cellH, marginMm) };
  const landscape = { orientation: 'landscape', w: size.height, h: size.width, ...fit(size.height, size.width, cellW, cellH, marginMm) };
  const best = landscape.cols * landscape.rows > portrait.cols * portrait.rows ? landscape : portrait;
  const perPage = best.cols * best.rows;
  return {
    paper,
    orientation: best.orientation,
    pageWidthMm: best.w,
    pageHeightMm: best.h,
    cols: best.cols,
    rows: best.rows,
    perPage,
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

// Crop marks in the page margin, extending every trim line outward from the grid edge.
function drawCropMarks(doc, layout, usedSlots) {
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
    xs.add(t.x.toFixed(4)); xs.add((t.x + t.width).toFixed(4));
  }
  for (let r = 0; r < rows; r++) {
    const t = slotTrimMm(layout, r * layout.cols);
    ys.add(t.y.toFixed(4)); ys.add((t.y + t.height).toFixed(4));
  }
  const pt = (mm) => mm * MM_TO_PT;
  const line = (x1, y1, x2, y2) => doc.moveTo(pt(x1), pt(y1)).lineTo(pt(x2), pt(y2)).stroke();
  doc.save().lineWidth(0.25).strokeColor('#000000');
  const len = (space) => Math.max(0, Math.min(CROP_MARK_LENGTH_MM, space - CROP_MARK_GAP_MM));
  const topLen = len(gridTop);
  const bottomLen = len(layout.pageHeightMm - gridBottom);
  const leftLen = len(gridLeft);
  const rightLen = len(layout.pageWidthMm - gridRight);
  for (const s of xs) {
    const x = Number(s);
    if (topLen > 0) line(x, gridTop - CROP_MARK_GAP_MM - topLen, x, gridTop - CROP_MARK_GAP_MM);
    if (bottomLen > 0) line(x, gridBottom + CROP_MARK_GAP_MM, x, gridBottom + CROP_MARK_GAP_MM + bottomLen);
  }
  for (const s of ys) {
    const y = Number(s);
    if (leftLen > 0) line(gridLeft - CROP_MARK_GAP_MM - leftLen, y, gridLeft - CROP_MARK_GAP_MM, y);
    if (rightLen > 0) line(gridRight + CROP_MARK_GAP_MM, y, gridRight + CROP_MARK_GAP_MM + rightLen, y);
  }
  doc.restore();
}

/**
 * Write a multi-page sheet PDF.
 * @param {object} layout       from layoutSheet
 * @param {number} count        number of card images to place
 * @param {(i:number) => Promise<Buffer|null>} imageAt  JPEG/PNG for item i (bleed included), or null to leave the slot empty
 * @param {object} opts         { outPath, cropMarks, title, onProgress(i, count) }
 */
async function writeSheetsPdf(layout, count, imageAt, { outPath, cropMarks = true, title = 'Print sheets', onProgress } = {}) {
  if (layout.perPage < 1) throw new Error('the card does not fit on this paper size');
  const pageSize = [layout.pageWidthMm * MM_TO_PT, layout.pageHeightMm * MM_TO_PT];
  const doc = new PDFDocument({ size: pageSize, margin: 0, autoFirstPage: false, info: { Title: title, Creator: 'TCGForge', Producer: 'TCGForge (pdfkit)' } });
  const stream = fs.createWriteStream(outPath);
  const done = new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); });
  doc.pipe(stream);

  // Copies of one card come back as the same Buffer: embed it once and reuse the PDF image.
  let lastBuffer = null;
  let lastImage = null;
  const pages = Math.ceil(count / layout.perPage);
  for (let p = 0; p < pages; p++) {
    doc.addPage({ size: pageSize, margin: 0 });
    const onPage = Math.min(layout.perPage, count - p * layout.perPage);
    for (let s = 0; s < onPage; s++) {
      const i = p * layout.perPage + s;
      if (onProgress) onProgress(i, count);
      const img = await imageAt(i);
      if (!img) continue;
      if (img !== lastBuffer) {
        lastBuffer = img;
        lastImage = doc.openImage(img);
      }
      const t = slotTrimMm(layout, s);
      doc.image(lastImage, (t.x - layout.bleedMm) * MM_TO_PT, (t.y - layout.bleedMm) * MM_TO_PT, {
        width: layout.cellWidthMm * MM_TO_PT,
        height: layout.cellHeightMm * MM_TO_PT,
      });
    }
    if (cropMarks) drawCropMarks(doc, layout, onPage);
  }
  doc.end();
  await done;
  return { pages };
}

module.exports = { PAPER_MM, DEFAULT_MARGIN_MM, MM_TO_PT, cardSizeMm, layoutSheet, slotTrimMm, writeSheetsPdf };
