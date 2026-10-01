// Procedural test art for the Phase 0 spike and dev seeding — no third-party images.
// Everything is deterministic so renders can be compared byte for byte.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

function landscape(width, height, { hue = 250, label = '' } = {}) {
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${hue}, 60%, 22%)`);
  sky.addColorStop(0.55, `hsl(${hue + 60}, 70%, 55%)`);
  sky.addColorStop(1, `hsl(${hue + 90}, 80%, 70%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'hsla(45, 100%, 75%, 0.95)';
  ctx.beginPath();
  ctx.arc(width * 0.7, height * 0.42, Math.min(width, height) * 0.12, 0, Math.PI * 2);
  ctx.fill();

  const ridges = [
    { base: 0.62, amp: 0.10, freq: 3.1, color: `hsl(${hue + 10}, 35%, 30%)` },
    { base: 0.72, amp: 0.08, freq: 5.3, color: `hsl(${hue - 10}, 40%, 20%)` },
    { base: 0.84, amp: 0.05, freq: 8.7, color: `hsl(${hue - 30}, 45%, 12%)` },
  ];
  for (const r of ridges) {
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 4) {
      const t = x / width;
      const y = height * (r.base - r.amp * (Math.sin(t * r.freq * Math.PI) * 0.6 + Math.sin(t * r.freq * 2.3 * Math.PI + 1) * 0.4));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }

  // Corner markers make crops and anchors obvious.
  const m = Math.round(Math.min(width, height) * 0.09);
  ctx.font = `bold ${Math.round(m * 0.45)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const corners = [['TL', 0, 0], ['TR', width - m, 0], ['BL', 0, height - m], ['BR', width - m, height - m]];
  for (const [txt, x, y] of corners) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x, y, m, m);
    ctx.fillStyle = '#e5484d';
    ctx.fillText(txt, x + m / 2, y + m / 2);
  }
  if (label) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold ${Math.round(m * 0.6)}px sans-serif`;
    ctx.fillText(label, width / 2, height * 0.2);
  }
  return c;
}

function tile(size, a, b) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = b;
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.1);
  ctx.lineTo(size * 0.9, size / 2);
  ctx.lineTo(size / 2, size * 0.9);
  ctx.lineTo(size * 0.1, size / 2);
  ctx.closePath();
  ctx.fill();
  return c;
}

function subtleTile(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(201,169,110,0.08)';
  ctx.lineWidth = 1;
  for (let i = -size; i < size * 2; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  return c;
}

// Writes template assets into {templatesDir}/assets and card art into artDir.
// Returns absolute paths of the card-art files.
function generateAssets(templatesDir, artDir = path.join(templatesDir, 'card-art')) {
  const assets = path.join(templatesDir, 'assets');
  fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
  fs.mkdirSync(artDir, { recursive: true });
  const write = (file, canvas) => { fs.writeFileSync(file, canvas.toBuffer('image/png')); return file; };

  write(path.join(assets, 'art-wide.png'), landscape(1600, 900, { hue: 220, label: 'WIDE 16:9' }));
  write(path.join(assets, 'art-tall.png'), landscape(600, 900, { hue: 300, label: 'TALL 2:3' }));
  write(path.join(assets, 'tile.png'), tile(48, '#2b2d42', '#7c6ef0'));
  write(path.join(assets, 'bg-tile.png'), subtleTile(64));

  return {
    ember: write(path.join(artDir, 'ember-drake.png'), landscape(1200, 900, { hue: 350 })),
    tide: write(path.join(artDir, 'tide-caller.png'), landscape(900, 1200, { hue: 190 })),
  };
}

module.exports = { generateAssets };
