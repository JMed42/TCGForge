import test from 'node:test'
import assert from 'node:assert'
import { fitStack, fitText } from '../src/designer/render/fitText.ts'
import type { StackItem, StackState } from '../src/designer/render/fitText.ts'

// Fake layouts in which 1 pt is 1 px (so lines are size * line height), checked against the spec's
// order: shrink to the minimum, tighten the line height, hide (by priority), then overflow.
const PX_PER_MM = 72 / 25.4

test('a framed text: spare lines, fill, and how far an overflow sticks out', () => {
  const tall = (lines: number, room: number) => (pt: number, lh: number) => ({ needH: pt * lh * lines, roomH: room, needW: 100, roomW: 100 })
  const fits = fitText({ basePt: 10, baseLineHeight: 1.2, minPt: 6, strategy: ['shrink'] }, tall(2, 50), PX_PER_MM)
  assert.deepEqual([fits.status, fits.spareLines, fits.fill], ['fits', 2, 0.48]) // needs 24 of 50: 26 / 12 = 2 lines
  const over = fitText({ basePt: 10, baseLineHeight: 1.2, minPt: 6, strategy: ['shrink'] }, tall(50, 32), PX_PER_MM)
  // At 6 pt: 360 needed, 32 there: 328 px over, in lines of 7.2 px.
  assert.deepEqual([over.status, over.pt, over.overflowLines, over.overflowMm, over.fill], ['overflow', 6, 46, 115.71, 18.75])
  // A single line that is too long overflows sideways.
  const wide = fitText({ basePt: 10, baseLineHeight: 1.2, minPt: 6, strategy: [] }, () => ({ needH: 12, roomH: 20, needW: 150, roomW: 100 }), PX_PER_MM, false)
  assert.deepEqual([wide.status, wide.wide, wide.overflowMm, wide.overflowLines], ['overflow', true, 17.64, undefined])
  assert.equal(wide.fill, 1.5)
})

// A vertical stack in which each item is `lines` lines tall at its size, with a gap between
// visible items and `after` px of something that isn't text (an image) at the end.
function stack(lines: Record<string, number>, room: number, { gap = 0, after = 0 } = {}) {
  return (state: Record<string, StackState>) => {
    let pos = 0
    let first = true
    const items: Record<string, { pos: number; size: number }> = {}
    for (const id of Object.keys(lines)) {
      const s = state[id]
      if (s.hidden) continue
      if (!first) pos += gap
      first = false
      const size = s.pt * s.lineHeight * lines[id]
      items[id] = { pos, size }
      pos += size
    }
    return { room, need: pos + after, items }
  }
}

const rules = (over: Partial<StackItem> = {}): StackItem => ({ id: 'rules', basePt: 8.5, baseLineHeight: 1.2, minPt: 6.5, strategy: ['shrink'], priority: 1, ...over })
const flavor = (over: Partial<StackItem> = {}): StackItem => ({ id: 'flavor', basePt: 8, baseLineHeight: 1.2, minPt: 6, strategy: ['hide'], priority: 2, ...over })

test('a stack that fits: lines to spare, each layer\'s share of the stack', () => {
  // 40.8 + 2 + 9.6 = 52.4 of 81: 28.6 px left, in lines of 10.2 and 9.6 px.
  const r = fitStack([rules(), flavor()], stack({ rules: 4, flavor: 1 }, 81, { gap: 2 }), PX_PER_MM)
  assert.deepEqual([r.rules.status, r.rules.spareLines, r.flavor.status, r.flavor.spareLines], ['fits', 2, 'fits', 3])
  assert.deepEqual([r.rules.fill, r.flavor.fill, r.rules.stackFill], [0.5, 0.12, 0.65])
})

test('shrink first (the default): card text shrinks while the flavor line still fits', () => {
  // 61.2 + 2 + 9.6 = 72.8 > 70: card text must come down to 58.4 / 7.2 = 8.11 pt, so 8 pt.
  const r = fitStack([rules(), flavor()], stack({ rules: 6, flavor: 1 }, 70, { gap: 2 }), PX_PER_MM)
  assert.deepEqual([r.rules.status, r.rules.pt, r.flavor.status], ['shrunk', 8, 'fits'])
})

test('then the flavor line is hidden, and the card text grows back as far as it can', () => {
  // Card text at its 6.5 pt minimum: 78 + 2 + 9.6 = 89.6 > 85. Without the flavor line it fits
  // at 85 / 12 = 7.08 pt: 7 pt, larger than the minimum it had to reach before.
  const r = fitStack([rules(), flavor()], stack({ rules: 10, flavor: 1 }, 85, { gap: 2 }), PX_PER_MM)
  assert.deepEqual([r.rules.status, r.rules.pt, r.flavor.status], ['shrunk', 7, 'hidden'])
})

test('hide first: the flavor line goes before the card text shrinks at all', () => {
  const r = fitStack([rules(), flavor()], stack({ rules: 6, flavor: 1 }, 70, { gap: 2 }), PX_PER_MM, 'hideFirst')
  assert.deepEqual([r.rules.status, r.rules.pt, r.flavor.status], ['fits', 8.5, 'hidden'])
})

test('equal priorities shrink together; a higher number gives way first', () => {
  const a = { id: 'rules', basePt: 10, baseLineHeight: 1, minPt: 6, strategy: ['shrink'] as const, priority: 0 }
  const b = { id: 'flavor', basePt: 9, baseLineHeight: 1, minPt: 6, strategy: ['shrink'] as const, priority: 0 }
  const layout = stack({ rules: 4, flavor: 2 }, 50) // 40 + 18 = 58 at full size
  const together = fitStack([{ ...a, strategy: ['shrink'] }, { ...b, strategy: ['shrink'] }], layout, PX_PER_MM)
  // Both come down by the same 5 steps: 4 * 8.75 + 2 * 7.75 = 50.5.
  assert.deepEqual([together.rules.pt, together.flavor.pt], [8.75, 7.75])
  const yielding = fitStack([{ ...a, strategy: ['shrink'] }, { ...b, strategy: ['shrink'], priority: 2 }], layout, PX_PER_MM)
  // The flavor line goes all the way to 6 pt first (40 + 12 = 52, still too much), then the
  // card text: 4 * 9.5 + 12 = 50.
  assert.deepEqual([yielding.flavor.pt, yielding.rules.pt], [6, 9.5])
})

test('line height tightens after the size reaches its minimum', () => {
  // At 8 pt, 1.2: 48 > 45. 1.15: 46. 1.1: 44 fits.
  const r = fitStack([rules({ minPt: 8, strategy: ['shrink', 'tightenLeading'] })], stack({ rules: 5 }, 45), PX_PER_MM)
  assert.deepEqual([r.rules.status, r.rules.pt, r.rules.lineHeight], ['shrunk', 8, 1.1])
})

test('overflow is flagged on what is cut off, with how many lines', () => {
  const r = fitStack([rules(), flavor({ strategy: [] })], stack({ rules: 20, flavor: 1 }, 100, { gap: 2 }), PX_PER_MM)
  // Card text at 6.5 pt is 156 px in a 100 px stack: 56 px cut, 7.8 px lines.
  assert.deepEqual([r.rules.status, r.rules.pt, r.rules.overflowLines], ['overflow', 6.5, 8])
  assert.deepEqual([r.flavor.status, r.flavor.overflowLines], ['overflow', 1], 'the flavor line is entirely below the stack')
})

test('when text pushes something else out of the stack, the text is flagged', () => {
  // An image of 20 px below the card text: 38.4 + 20 = 58.4 > 50 even at the 8 pt minimum.
  const r = fitStack([rules({ minPt: 8 })], stack({ rules: 4 }, 50, { after: 20 }), PX_PER_MM)
  assert.equal(r.rules.status, 'overflow')
  assert.equal(r.rules.overflowMm, 2.96) // 8.4 px
  assert.equal(r.rules.spareLines, undefined)
})
