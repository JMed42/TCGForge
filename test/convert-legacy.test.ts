import test from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { validateTemplate } from '../src/designer/schema/schema.ts'
import { anchorsOf, resolveFrame } from '../src/designer/layout/frame.ts'

const require = createRequire(import.meta.url)
const { convertLegacyTemplate, isLegacyTemplate, objectPosition, parseFontName } = require('../electron/cardDesigner/convertLegacyTemplate.js')
const standard = require('../electron/cardDesigner/fixtures/standard.json')
const fitMatrix = require('../electron/cardDesigner/fixtures/fit-matrix.json')

const layer = (t: any, id: string) => t.layers.find((l: any) => l.id === id)

test('both Phase 0 fixtures convert to valid schema v1', () => {
  for (const legacy of [standard, fitMatrix]) {
    const { template, notes } = convertLegacyTemplate(legacy)
    const r = validateTemplate(template)
    assert.ok(r.ok, `${legacy.meta.name}: ${!r.ok && r.errors.join('; ')}`)
    assert.deepEqual(notes, [])
  }
})

test('size, bleed and units', () => {
  const { template } = convertLegacyTemplate(standard)
  assert.deepEqual(template.size, { widthMm: 62.99, heightMm: 87.97, bleedMm: 3, safeMm: 3, cornerRadiusMm: 2.71 })
  assert.equal(template.name, 'Standard Card')
  // Background becomes full-bleed layers at the bottom of the stack.
  assert.deepEqual(template.layers.slice(0, 2).map((l: any) => l.id), ['background', 'background-image'])
  assert.deepEqual(layer(template, 'background').frame, { left: -3, right: -3, top: -3, bottom: -3 })
  assert.equal(layer(template, 'background-image').objectFit, 'tile')
})

test('anchors are inferred so the layout reflows', () => {
  const { template } = convertLegacyTemplate(standard)
  assert.deepEqual(anchorsOf(layer(template, 'frame').frame), { h: 'stretch', v: 'stretch' })
  assert.deepEqual(anchorsOf(layer(template, 'name-bar').frame), { h: 'stretch', v: 'top' })
  assert.deepEqual(anchorsOf(layer(template, 'cost-badge').frame), { h: 'right', v: 'top' })
  assert.deepEqual(anchorsOf(layer(template, 'pt-badge').frame), { h: 'right', v: 'bottom' })
  assert.deepEqual(anchorsOf(layer(template, 'footer').frame), { h: 'left', v: 'bottom' })
  // Centred below the middle: travels with the bottom edge on taller cards.
  assert.deepEqual(anchorsOf(layer(template, 'type-bar').frame), { h: 'stretch', v: 'bottom' })
  assert.deepEqual(anchorsOf(layer(template, 'card-art').frame), { h: 'stretch', v: 'top' })
  // Positions are preserved at the original size (within rounding).
  const card = { x: 0, y: 0, w: template.size.widthMm, h: template.size.heightMm }
  const pt = resolveFrame(layer(template, 'pt-badge').frame, card)
  const mm = (px: number) => (px / 300) * 25.4
  assert.ok(Math.abs(pt.x - mm(572)) < 0.02 && Math.abs(pt.y - mm(930)) < 0.02 && Math.abs(pt.w - mm(140)) < 0.02)
})

test('text, image and shape properties carry over', () => {
  const { template } = convertLegacyTemplate(standard)
  const name = layer(template, 'card-name')
  assert.deepEqual(name.style, { font: 'Georgia', sizePt: 9.6, weight: 700, color: '#f3e9d2', valign: 'middle' })
  assert.deepEqual(name.fit, { strategy: ['shrink'] })
  assert.equal(name.text, '{{name}}')
  assert.equal(layer(template, 'footer').style.wrap, false, 'clip -> single line')
  assert.equal(layer(template, 'flavor').style.italic, true)
  const art = layer(template, 'card-art')
  assert.equal(art.src, '{{image_path}}')
  assert.equal(art.objectPosition, '50% 0%')
  assert.equal(art.radiusMm, 0.68)
  assert.equal(layer(template, 'cost-badge').shape, 'ellipse')
  assert.equal(layer(template, 'name-bar').shape, 'roundRect')
  // Paint order follows the old zIndex.
  const ids = template.layers.map((l: any) => l.id)
  assert.ok(ids.indexOf('art-frame') < ids.indexOf('card-art') && ids.indexOf('cost-badge') < ids.indexOf('cost-text'))
})

test('awkward inputs', () => {
  const legacy = {
    meta: { name: 'Odd', width: 300, height: 300, dpi: 300 },
    background: { color: '#000' },
    layers: [
      { id: 'background', type: 'shape', shape: 'circle', x: 0, y: 0, width: 300, height: 100, fill: '#f00' },
      { id: 'dup', type: 'text', value: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'dup', type: 'text', value: 'b', x: 0, y: 0, width: 10, height: 10, visible: false, locked: true },
      { id: '9bad', type: 'image', source: 'x.png', x: 0, y: 0, width: 10, height: 10 },
      { id: 'what', type: 'sparkle', x: 0, y: 0, width: 1, height: 1 },
    ],
  }
  const { template, notes } = convertLegacyTemplate(legacy)
  assert.ok(validateTemplate(template).ok)
  assert.deepEqual(template.layers.map((l: any) => l.id), ['background-2', 'background', 'dup', 'dup-2', 'layer'])
  const circle = layer(template, 'background')
  assert.deepEqual([circle.shape, circle.frame.width ?? null], ['ellipse', 8.47], 'circle keeps its inscribed square')
  assert.equal(layer(template, 'dup-2').hidden, true)
  assert.equal(layer(template, 'dup-2').locked, true)
  assert.deepEqual(notes, ['layer "what": unknown type "sparkle" dropped'])
  assert.equal(isLegacyTemplate(template), false)
  assert.throws(() => convertLegacyTemplate(template))
})

test('helpers', () => {
  assert.deepEqual(parseFontName('Segoe UI Semibold Italic'), { family: 'Segoe UI', weight: 600, italic: true })
  assert.equal(objectPosition('right bottom'), '100% 100%')
  assert.equal(objectPosition('center'), '50% 50%')
})
