import test from 'node:test'
import assert from 'node:assert'
import { validateTemplate } from '../src/designer/schema/schema.ts'
import { resolveFrame, frameFromRect, anchorsOf, setAnchors, setUnits } from '../src/designer/layout/frame.ts'
import { absoluteBox, parentBoxOf, mapLayer, uniqueId } from '../src/designer/layout/tree.ts'
import type { Template } from '../src/designer/schema/types.ts'

// The example from the spec, verbatim apart from formatting.
const specExample = {
  schemaVersion: 1,
  size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3 },
  layers: [
    { id: 'frame', type: 'image', frame: { left: 0, right: 0, top: 0, bottom: 0 }, src: 'frames/{{lower(faction)}}.png' },
    { id: 'art', type: 'image', frame: { left: 4, right: 4, top: 10, height: 38 }, src: '{{art}}', objectFit: 'cover', placeholder: 'proxy' },
    { id: 'name', type: 'text', frame: { left: 5, right: 14, top: 4, height: 5 }, text: '{{name}}',
      style: { font: 'Cinzel', sizePt: 10, weight: 700, color: '#1b1b1b' }, fit: { minPt: 7, strategy: ['shrink'] } },
    { id: 'cost', type: 'iconRepeat', frame: { right: 4, top: 3.5, width: 10, height: 6 }, count: 'cost', icon: 'energy', direction: 'rtl' },
    { id: 'textBox', type: 'stack', direction: 'vertical', gapMm: 1.5, frame: { left: 5, right: 5, bottom: 10, height: 26 },
      children: [
        { id: 'rules', type: 'richText', text: '{{rules}}', priority: 1, style: { font: 'Crimson Pro', sizePt: 8.5 }, fit: { minPt: 6.5, strategy: ['shrink', 'tightenLeading'] } },
        { id: 'flavor', type: 'richText', text: '*{{flavor}}*', priority: 2, visibleIf: "flavor != ''", fit: { strategy: ['hide'] } },
      ] },
    { id: 'stats', type: 'text', visibleIf: "type == 'Unit'", frame: { right: 4, bottom: 3, width: 12, height: 6 }, text: '{{power}}/{{health}}' },
  ],
}

test("the spec's example template validates", () => {
  const r = validateTemplate(specExample)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors))
})

test('validation errors are readable', () => {
  const bad = structuredClone(specExample) as any
  bad.layers[2].frame.width = 10 // left + right + width
  bad.layers[1].id = 'frame' // duplicate
  bad.layers[5].visibleIf = "type == 'Unit"
  bad.layers.push({ id: 'x', type: 'video' })
  const r = validateTemplate(bad)
  assert.ok(!r.ok)
  const text = r.errors.join('\n')
  assert.match(text, /at most two of left/)
  assert.match(text, /duplicate layer id "frame"/)
  assert.match(text, /expression: unterminated string/)
  assert.ok(!validateTemplate({ ...specExample, size: { ...specExample.size, widthMm: 9000 } }).ok)
  assert.ok(!validateTemplate({ ...specExample, extra: 1 }).ok, 'unknown keys rejected')
})

const card = { x: 0, y: 0, w: 63, h: 88 }

test('frames resolve against the parent box', () => {
  assert.deepEqual(resolveFrame({ left: 4, right: 4, top: 10, height: 38 }, card), { x: 4, y: 10, w: 55, h: 38 })
  assert.deepEqual(resolveFrame({ right: 4, top: 3.5, width: 10, height: 6 }, card), { x: 49, y: 3.5, w: 10, h: 6 })
  assert.deepEqual(resolveFrame({ left: '50%', width: '25%', bottom: 0, height: '10%' }, card), { x: 31.5, y: 79.2, w: 15.75, h: 8.8 })
  assert.deepEqual(resolveFrame(undefined, card), card)
})

test('a size change reflows: stretched layers grow, right-anchored ones stay pinned', () => {
  const tarot = { x: 0, y: 0, w: 70, h: 120 }
  assert.deepEqual(resolveFrame({ left: 4, right: 4, top: 10, height: 38 }, tarot), { x: 4, y: 10, w: 62, h: 38 })
  assert.deepEqual(resolveFrame({ right: 4, bottom: 3, width: 12, height: 6 }, tarot), { x: 54, y: 111, w: 12, h: 6 })
})

test('frameFromRect is the inverse of resolveFrame and keeps anchors and units', () => {
  const frames = [
    { left: 4, right: 4, top: 10, height: 38 },
    { right: 4, top: 3.5, width: 10, height: 6 },
    { left: '10%', width: '50%', bottom: '5%', height: 20 },
  ]
  for (const f of frames) {
    const rect = resolveFrame(f, card)
    assert.deepEqual(frameFromRect(rect, card, f), f, JSON.stringify(f))
  }
  // Moving a right-anchored layer 2 mm left keeps it right-anchored.
  const moved = frameFromRect({ x: 47, y: 3.5, w: 10, h: 6 }, card, frames[1])
  assert.deepEqual(moved, { right: 6, width: 10, top: 3.5, height: 6 })
  assert.deepEqual(anchorsOf(moved), { h: 'right', v: 'top' })
})

test('changing anchors or units never moves the layer', () => {
  const f = { left: 5, width: 20, top: 10, height: 30 }
  for (const anchors of [{ h: 'right', v: 'bottom' }, { h: 'stretch', v: 'stretch' }] as const) {
    const g = setAnchors(f, card, anchors)
    assert.deepEqual(anchorsOf(g), anchors)
    assert.deepEqual(resolveFrame(g, card), resolveFrame(f, card))
  }
  const pct = setUnits(f, card, '%')
  assert.equal(typeof pct.left, 'string')
  const back = resolveFrame(pct, card)
  for (const k of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(back[k] - resolveFrame(f, card)[k]) < 0.01)
})

test('tree helpers: group children resolve inside the group; stack children have no frame box', () => {
  const t = {
    schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 3 },
    layers: [
      { id: 'g', type: 'group', frame: { left: 10, top: 20, width: 40, height: 30 }, children: [
        { id: 'inner', type: 'shape', shape: 'rect', frame: { right: 0, bottom: 0, width: 10, height: 10 } },
      ] },
      { id: 's', type: 'stack', frame: { left: 0, right: 0, bottom: 0, height: 20 }, children: [{ id: 'line', type: 'text', text: 'x' }] },
    ],
  } as Template
  assert.deepEqual(absoluteBox(t, 'inner'), { x: 40, y: 40, w: 10, h: 10 })
  assert.equal(parentBoxOf(t, 'line'), null)
  const moved = mapLayer(t, 'inner', (l) => ({ ...l, opacity: 0.5 }))
  assert.equal((moved.layers[0] as any).children[0].opacity, 0.5)
  assert.equal(t.layers[0] === moved.layers[0], false)
  assert.equal(t.layers[1] === moved.layers[1], true, 'untouched branches are shared')
  assert.equal(uniqueId(t, 'inner'), 'inner-2')
})
