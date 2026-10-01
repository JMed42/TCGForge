// Pure fit math, CSS object-fit semantics (spec §P0.3). No canvas access here.

const H_ANCHOR = { left: 0, center: 0.5, right: 1 };
const V_ANCHOR = { top: 0, middle: 0.5, center: 0.5, bottom: 1 };

// "center top", "left bottom", "middle", "right" … → { ax, ay } in [0,1].
// Horizontal words: left/right, vertical words: top/bottom, center/middle fill whichever axis is left.
function parseAlign(align) {
  let ax = null;
  let ay = null;
  const words = String(align || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ambiguous = [];
  for (const w of words) {
    if (w === 'left' || w === 'right') ax = H_ANCHOR[w];
    else if (w === 'top' || w === 'bottom') ay = V_ANCHOR[w];
    else if (w === 'center' || w === 'middle') ambiguous.push(0.5);
  }
  for (const a of ambiguous) {
    if (ax === null) ax = a;
    else if (ay === null) ay = a;
  }
  return { ax: ax === null ? 0.5 : ax, ay: ay === null ? 0.5 : ay };
}

// Destination rect for drawing a srcW×srcH image into box using mode.
// Returns { dx, dy, dw, dh, clip } — clip means the draw overflows the box and must be clipped.
function computeFit(srcW, srcH, box, mode, align) {
  const { ax, ay } = parseAlign(align);
  if (mode === 'stretch' || !srcW || !srcH) {
    return { dx: box.x, dy: box.y, dw: box.width, dh: box.height, clip: false };
  }
  const scale = mode === 'contain'
    ? Math.min(box.width / srcW, box.height / srcH)
    : Math.max(box.width / srcW, box.height / srcH); // cover (default)
  const dw = srcW * scale;
  const dh = srcH * scale;
  return {
    dx: box.x + (box.width - dw) * ax,
    dy: box.y + (box.height - dh) * ay,
    dw,
    dh,
    clip: mode !== 'contain',
  };
}

module.exports = { parseAlign, computeFit };
