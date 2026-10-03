import test from 'node:test'
import assert from 'node:assert'
import { fitText, STEP_PT } from '../src/designer/render/fitText.ts'
import { parseRichText, plainText } from '../src/designer/render/markup.ts'
import { assetUrl, checkSrc, assetKey } from '../src/designer/render/assetUrl.ts'

// A fake layout in which 1 pt is 1 px: text needs size * lineHeight * lines of height. More fit
// cases (stacks, priorities) are in fit-engine.test.ts.
const PX_PER_MM = 72 / 25.4
const layout = (lines: number, box: number) => (pt: number, lh: number) => ({ needH: pt * lh * lines, roomH: box, needW: 100, roomW: 100 })
const fit = (basePt: number, lh: number, minPt: number, strategy: Array<'shrink' | 'tightenLeading' | 'hide'>, measure: ReturnType<typeof layout>) =>
  fitText({ basePt, baseLineHeight: lh, minPt, strategy }, measure, PX_PER_MM)

test('fits as-is', () => {
  const r = fit(10, 1.2, 6, ['shrink'], layout(2, 100))
  assert.deepEqual([r.status, r.pt, r.lineHeight, r.basePt], ['fits', 10, 1.2, 10])
})

test('shrinks to the largest 0.25 pt step that fits', () => {
  const r = fit(10, 1.2, 6, ['shrink'], layout(4, 40)) // fits when pt <= 8.33
  assert.equal(r.status, 'shrunk')
  assert.equal(r.pt, 8.25)
  assert.equal((10 - r.pt) % STEP_PT, 0)
})

test('then tightens leading, then hides or flags overflow', () => {
  // At min size 6 with lh 1.2: 6*1.2*5 = 36 > 32. lh 1.05: 31.5 fits.
  const tight = fit(10, 1.2, 6, ['shrink', 'tightenLeading'], layout(5, 32))
  assert.deepEqual([tight.status, tight.pt, tight.lineHeight], ['shrunk', 6, 1.05])
  const hidden = fit(10, 1.2, 6, ['shrink', 'hide'], layout(50, 32))
  assert.equal(hidden.status, 'hidden')
  const over = fit(10, 1.2, 6, ['shrink'], layout(50, 32))
  assert.deepEqual([over.status, over.pt], ['overflow', 6])
  assert.equal(fit(10, 1.2, 6, [], layout(50, 32)).status, 'overflow', 'no strategy: flag only')
})

test('binary search matches a linear scan', () => {
  for (let box = 5; box < 200; box += 7) {
    const fn = layout(3, box)
    let expected = 6
    for (let pt = 12; pt >= 6; pt -= STEP_PT) { const m = fn(pt, 1.2); if (m.needH <= m.roomH + 0.5) { expected = pt; break } }
    const r = fit(12, 1.2, 6, ['shrink'], fn)
    if (r.status !== 'overflow') assert.equal(r.pt, expected, `box ${box}`)
  }
})

test('rich text markup', () => {
  assert.deepEqual(parseRichText('a **b** *c*'), [[
    { text: 'a ', bold: false, italic: false },
    { text: 'b', bold: true, italic: false },
    { text: ' ', bold: false, italic: false },
    { text: 'c', bold: false, italic: true },
  ]])
  assert.equal(parseRichText('one\ntwo').length, 2)
  assert.equal(plainText('5 \\* 3 = *fifteen*'), '5 * 3 = fifteen')
  assert.equal(plainText('<b>not html</b> {fire}'), '<b>not html</b> {fire}', 'markup never becomes HTML')
})

test('asset sources and URLs', () => {
  assert.deepEqual(checkSrc('assets/art/hero.png'), { ok: true, rel: 'assets/art/hero.png' })
  assert.deepEqual(checkSrc('frames\\ember.png'), { ok: true, rel: 'frames/ember.png' })
  for (const bad of ['https://example.com/x.png', 'data:image/png;base64,AA', 'C:\\art\\x.png', '/etc/x.png', '\\\\srv\\x.png', 'file:///c:/x.png']) {
    assert.equal(checkSrc(bad).ok, false, bad)
  }
  assert.equal(checkSrc('  ').ok, false)
  assert.equal(assetUrl(3, 'assets/art/My Hero #1.png'), 'tcg-asset://p/3/assets/art/My%20Hero%20%231.png')
  assert.equal(assetUrl(3, 'assets/a.png', { [assetKey(3, 'assets/a.png')]: 5 }), 'tcg-asset://p/3/assets/a.png?v=5')
})
