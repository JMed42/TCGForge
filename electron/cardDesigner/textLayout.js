// Text measurement and line breaking for text layers (spec §P0.2 "Text overflow").
//   wrap   — word-wrap inside the box, clip whatever still overflows vertically
//   clip   — no wrapping (explicit \n only), hard clip at the box
//   shrink — largest size (step 0.5) whose wrapped text fits the box, floor at minSize

const LINE_HEIGHT = 1.2;

function breakWord(ctx, word, maxWidth) {
  const parts = [];
  let current = '';
  for (const ch of word) {
    if (current && ctx.measureText(current + ch).width > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (ctx.measureText(word).width > maxWidth) {
        const pieces = breakWord(ctx, word, maxWidth);
        current = pieces.pop();
        lines.push(...pieces);
      } else {
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

// fontFor(sizePx) → css font string. Returns { font, fontSize, lines, lineHeight, overflows }.
function layoutText(ctx, text, box, { fontSize, overflow, lineHeight = LINE_HEIGHT, minSize }, fontFor) {
  const fit = (size) => {
    const font = fontFor(size);
    ctx.font = font;
    const lh = size * lineHeight;
    const lines = overflow === 'clip' ? String(text).split('\n') : wrapLines(ctx, text, box.width);
    const tooWide = lines.some((l) => ctx.measureText(l).width > box.width + 0.01);
    const tooTall = lines.length * lh > box.height + 0.01;
    return { font, fontSize: size, lines, lineHeight: lh, overflows: tooWide || tooTall };
  };

  if (overflow !== 'shrink') return fit(fontSize);

  const floor = Math.min(minSize, fontSize);
  for (let size = fontSize; size > floor; size -= 0.5) {
    const result = fit(size);
    if (!result.overflows) return result;
  }
  return fit(floor);
}

module.exports = { layoutText, wrapLines, LINE_HEIGHT };
