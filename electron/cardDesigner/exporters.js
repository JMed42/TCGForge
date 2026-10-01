// Encoders for a rendered card canvas (spec §P0.4). All take the canvas from render.renderCard.

const fs = require('fs');
const { createCanvas } = require('canvas');
const PDFDocument = require('pdfkit');

// PNG keeps alpha; pHYs chunk records the DPI so print tools size it correctly.
function toPng(canvas, dpi) {
  return canvas.toBuffer('image/png', dpi ? { resolution: Math.round(dpi) } : undefined);
}

// JPEG has no alpha: composite onto white first.
function toJpeg(canvas, quality = 0.92) {
  const flat = createCanvas(canvas.width, canvas.height);
  const ctx = flat.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toBuffer('image/jpeg', { quality });
}

// One-page PDF at the card's physical size with the raster placed edge to edge.
// RGB only — true CMYK needs a pre-press tool (spec §P0.4).
function writePdf(canvas, template, outPath, dpi) {
  const meta = template.meta;
  const widthPt = (meta.width / meta.dpi) * 72;
  const heightPt = (meta.height / meta.dpi) * 72;
  const png = toPng(canvas, dpi);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [widthPt, heightPt],
      margin: 0,
      autoFirstPage: true,
      info: { Title: meta.name || 'Card', Creator: 'TCGForge', Producer: 'TCGForge (pdfkit)' },
    });
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    doc.image(png, 0, 0, { width: widthPt, height: heightPt });
    doc.end();
  });
}

module.exports = { toPng, toJpeg, writePdf };
