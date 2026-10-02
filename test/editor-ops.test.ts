import test from 'node:test'
import assert from 'node:assert'
import type { Template } from '../src/designer/schema/types.ts'
import { validateTemplate } from '../src/designer/schema/schema.ts'
import { absoluteBox } from '../src/designer/layout/tree.ts'
import { anchorsOf } from '../src/designer/layout/frame.ts'
import {
  addLayer, deleteLayers, duplicateLayers, getLayer, groupLayers, moveInParent, moveToParent, renameLayer, setLayerRect, setSize, ungroup,
} from '../src/designer/editor/ops.ts'
import { alignBoxes, distributeBoxes, moveBox, resizeBox, scaleInto, snapBox, snapTargets, bounds } from '../src/designer/editor/geometry.ts'

const tpl = (): Template => ({
  schemaVersion: 1,
  size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3 },
  layers: [
    { id: 'bg', type: 'shape', shape: 'rect', frame: { left: -3, right: -3, top: -3, bottom: -3 }, fill: '#000' },
    { id: 'name', type: 'text', text: '{{name}}', frame: { left: 5, right: 5, top: 4, height: 6 } },
    { id: 'cost', type: 'shape', shape: 'ellipse', frame: { right: 4, top: 3, width: 8, height: 8 } },
    { id: 'box', type: 'stack', frame: { left: 5, right: 5, bottom: 10, height: 26 }, children: [
      { id: 'rules', type: 'richText', text: '{{rules_text}}' },
    ] },
  ],
})
const card = { x: 0, y: 0, w: 63, h: 88 }
const valid = (t: Template) => { const r = validateTemplate(t); assert.ok(r.ok, JSON.stringify(!r.ok && r.errors)) }

test('ops never mutate their input and produce valid templates', () => {
  const t = tpl()
  const frozen = JSON.stringify(t)
  const results = [
    addLayer(t, 'text').template, addLayer(t, 'image', 'box').template, deleteLayers(t, ['cost']),
    duplicateLayers(t, ['cost', 'box']).template, moveInParent(t, 'name', 1), moveToParent(t, 'cost', 'box', 0),
    setLayerRect(t, 'cost', { x: 10, y: 10, w: 5, h: 5 }), setSize(t, { widthMm: 70 }),
  ]
  const g = groupLayers(t, ['name', 'cost'])
  assert.ok('template' in g)
  results.push(g.template)
  assert.equal(JSON.stringify(t), frozen)
  for (const r of results) valid(r)
})

test('setLayerRect keeps the anchoring mode', () => {
  const t = setLayerRect(tpl(), 'cost', { x: 40, y: 3, w: 8, h: 8 })
  const f = getLayer(t, 'cost')!.frame!
  assert.deepEqual(f, { right: 15, width: 8, top: 3, height: 8 })
  assert.deepEqual(anchorsOf(f), { h: 'right', v: 'top' })
})

test('add: centred on the card, or flowing inside a stack', () => {
  const a = addLayer(tpl(), 'rect')
  assert.deepEqual(absoluteBox(a.template, a.id), { x: 16.5, y: 36.5, w: 30, h: 15 })
  const s = addLayer(tpl(), 'image', 'box')
  const stack = getLayer(s.template, 'box') as any
  assert.equal(stack.children.at(-1).id, s.id)
  assert.deepEqual(stack.children.at(-1).frame, { height: 30 })
  assert.equal(addLayer(a.template, 'rect').id, 'shape-2')
})

test('duplicate sits above the original, offset 2 mm, with fresh ids for nested children', () => {
  const d = duplicateLayers(tpl(), ['cost', 'box'])
  assert.deepEqual(d.ids, ['cost-copy', 'box-copy'])
  assert.deepEqual(d.template.layers.map((l) => l.id), ['bg', 'name', 'cost', 'cost-copy', 'box', 'box-copy'])
  const a = absoluteBox(d.template, 'cost')!
  const b = absoluteBox(d.template, 'cost-copy')!
  assert.deepEqual([b.x - a.x, b.y - a.y], [2, 2])
  assert.equal((getLayer(d.template, 'box-copy') as any).children[0].id, 'rules-copy')
})

test('group and ungroup keep every layer where it was on the card', () => {
  const t = tpl()
  const before = { name: absoluteBox(t, 'name'), cost: absoluteBox(t, 'cost') }
  const g = groupLayers(t, ['cost', 'name'])
  assert.ok('template' in g)
  assert.deepEqual(g.template.layers.map((l) => l.id), ['bg', 'group', 'box'], 'group takes the top-most slot')
  assert.deepEqual((getLayer(g.template, 'group') as any).children.map((c: any) => c.id), ['name', 'cost'], 'paint order kept')
  assert.deepEqual(absoluteBox(g.template, 'name'), before.name)
  assert.deepEqual(absoluteBox(g.template, 'cost'), before.cost)
  const u = ungroup(g.template, 'group')
  assert.ok('template' in u)
  assert.deepEqual(absoluteBox(u.template, 'name'), before.name)
  assert.deepEqual(absoluteBox(u.template, 'cost'), before.cost)
  assert.ok('error' in groupLayers(t, ['rules']), 'stack children cannot be grouped')
  assert.ok('error' in groupLayers(t, ['name', 'rules']), 'must share a parent')
})

test('ungroup carries the group opacity and condition into its children', () => {
  const g = groupLayers(tpl(), ['name', 'cost'])
  assert.ok('template' in g)
  const withProps = { ...g.template, layers: g.template.layers.map((l) => (l.id === 'group' ? { ...l, opacity: 0.5, visibleIf: "type == 'Unit'" } : l)) }
  const u = ungroup(withProps, 'group')
  assert.ok('template' in u)
  const name = getLayer(u.template, 'name')!
  assert.equal(name.opacity, 0.5)
  assert.equal(name.visibleIf, "type == 'Unit'")
})

test('moving into and out of a container keeps the position (or flows in a stack)', () => {
  const t = groupLayers(tpl(), ['name'])
  assert.ok('template' in t)
  const before = absoluteBox(t.template, 'cost')
  const into = moveToParent(t.template, 'cost', 'group', 0)
  assert.deepEqual(absoluteBox(into, 'cost'), before)
  const out = moveToParent(into, 'cost', null, 99)
  assert.deepEqual(absoluteBox(out, 'cost'), before)
  const toStack = moveToParent(tpl(), 'cost', 'box', 1)
  assert.deepEqual(getLayer(toStack, 'cost')!.frame, { height: 8 })
  assert.equal(moveToParent(tpl(), 'box', 'box', 0).layers.length, 4, 'not into itself')
})

test('reorder and rename', () => {
  assert.deepEqual(moveInParent(tpl(), 'name', 1).layers.map((l) => l.id), ['bg', 'cost', 'name', 'box'])
  assert.equal(moveInParent(tpl(), 'box', 1).layers.at(-1)!.id, 'box', 'top stays top')
  assert.ok('error' in renameLayer(tpl(), 'cost', 'name'))
  assert.ok('error' in renameLayer(tpl(), 'cost', '1x'))
  const r = renameLayer(tpl(), 'rules', 'rules-text')
  assert.ok('template' in r && getLayer(r.template, 'rules-text'))
})

test('a size change reflows: stretched layers grow, pinned ones follow their edge', () => {
  const t = setSize(tpl(), { widthMm: 70, heightMm: 120 })
  assert.deepEqual(absoluteBox(t, 'name'), { x: 5, y: 4, w: 60, h: 6 })
  assert.deepEqual(absoluteBox(t, 'cost'), { x: 58, y: 3, w: 8, h: 8 })
  assert.deepEqual(absoluteBox(t, 'box'), { x: 5, y: 84, w: 60, h: 26 })
})

test('geometry: move, resize, multi-resize, snapping with guides and grid', () => {
  const b = { x: 10, y: 10, w: 20, h: 10 }
  assert.deepEqual(moveBox(b, 5, 1, true), { ...b, x: 15 })
  assert.deepEqual(resizeBox(b, 'se', 10, 0, true), { x: 10, y: 10, w: 30, h: 15 })
  assert.deepEqual(resizeBox(b, 'w', 50, 0), { x: 29.5, y: 10, w: 0.5, h: 10 })
  assert.deepEqual(scaleInto({ x: 20, y: 10, w: 10, h: 10 }, { x: 10, y: 10, w: 20, h: 20 }, { x: 0, y: 0, w: 40, h: 20 }), { x: 20, y: 0, w: 20, h: 10 })
  const targets = snapTargets({ card: { w: 63, h: 88, bleed: 3, safe: 3 }, others: [] })
  const s = snapBox({ x: 2.6, y: 50, w: 20, h: 10 }, targets, 0.5)
  assert.equal(s.box.x, 3, 'snaps to the safe line')
  assert.deepEqual(s.guides.x, [3])
  const centre = snapBox({ x: 21.6, y: 50, w: 20, h: 10 }, targets, 0.5)
  assert.equal(centre.box.x, 21.5, 'centre to card centre')
  const grid = snapBox({ x: 12.3, y: 50.6, w: 20, h: 10 }, targets, 0.1, null, 1)
  assert.deepEqual([grid.box.x, grid.box.y], [12, 51], 'grid when nothing else is close')
  const edge = snapBox({ x: 10, y: 10, w: 52.8, h: 5 }, targets, 0.5, 'e')
  assert.equal(edge.box.w, 53, 'right edge to the safe line (63 - 3 = 60)')
})

test('align and distribute', () => {
  const boxes = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 20 }, { x: 50, y: 30, w: 10, h: 5 }]
  const ref = bounds(boxes)!
  assert.deepEqual(alignBoxes(boxes, 'right', ref).map((b) => b.x), [50, 50, 50])
  assert.deepEqual(alignBoxes(boxes, 'vcenter', ref).map((b) => b.y), [12.5, 7.5, 15])
  assert.deepEqual(alignBoxes([boxes[0]], 'hcenter', card)[0].x, 26.5, 'single layer aligns to the card')
  const d = distributeBoxes(boxes, 'x')
  assert.deepEqual(d.map((b) => b.x), [0, 25, 50], 'equal 15 mm gaps')
  assert.deepEqual(distributeBoxes(boxes.slice(0, 2), 'x'), boxes.slice(0, 2), 'needs three boxes')
})
