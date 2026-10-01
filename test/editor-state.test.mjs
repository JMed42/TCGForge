import test from 'node:test'
import assert from 'node:assert'
import { createHistory, pushHistory, undoHistory, redoHistory, HISTORY_LIMIT } from '../src/components/CardDesigner/editor/history.js'
import {
  addLayer, deleteLayer, duplicateLayer, moveLayer, reorderLayers, renameLayer, sortedLayers, updateLayer, uniqueLayerId,
} from '../src/components/CardDesigner/editor/templateOps.js'

const tpl = () => ({
  meta: { name: 'T', width: 744, height: 1039, dpi: 300 },
  layers: [
    { id: 'bg', type: 'shape', zIndex: 1, x: 0, y: 0, width: 10, height: 10 },
    { id: 'name', type: 'text', zIndex: 10, x: 5, y: 5, width: 10, height: 10 },
    { id: 'art', type: 'image', zIndex: 5, x: 1, y: 1, width: 10, height: 10 },
  ],
})

test('undo/redo walks snapshots and clears redo after a new edit', () => {
  let h = createHistory()
  const s0 = { v: 0 }, s1 = { v: 1 }, s2 = { v: 2 }
  h = pushHistory(h, s0, { now: 0 })
  h = pushHistory(h, s1, { now: 1000 })
  let r = undoHistory(h, s2)
  assert.equal(r.snapshot, s1)
  r = undoHistory(r.history, s1)
  assert.equal(r.snapshot, s0)
  assert.equal(undoHistory(r.history, s0), null)
  const again = redoHistory(r.history, s0)
  assert.equal(again.snapshot, s1)
  const branched = pushHistory(again.history, s1, { now: 5000 })
  assert.equal(branched.future.length, 0)
})

test('edits with the same key within 500 ms share one undo step', () => {
  let h = createHistory()
  h = pushHistory(h, 'a', { key: 'name.x', now: 0 })
  h = pushHistory(h, 'b', { key: 'name.x', now: 300 })
  h = pushHistory(h, 'c', { key: 'name.x', now: 700 }) // 400 ms after the last one: still merged
  assert.deepEqual(h.past, ['a'])
  h = pushHistory(h, 'd', { key: 'name.x', now: 1300 })
  assert.deepEqual(h.past, ['a', 'd'])
  h = pushHistory(h, 'e', { key: 'name.y', now: 1350 })
  assert.deepEqual(h.past, ['a', 'd', 'e'])
})

test('history is capped', () => {
  let h = createHistory()
  for (let i = 0; i < HISTORY_LIMIT + 50; i++) h = pushHistory(h, i, { now: i * 1000 })
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.equal(h.past[0], 50)
})

test('template ops never mutate their input', () => {
  const t = tpl()
  const frozen = JSON.stringify(t)
  updateLayer(t, 'name', { x: 99 })
  addLayer(t, 'text')
  deleteLayer(t, 'art')
  duplicateLayer(t, 'art')
  moveLayer(t, 'bg', 1)
  reorderLayers(t, ['bg', 'art', 'name'])
  renameLayer(t, 'art', 'hero')
  assert.equal(JSON.stringify(t), frozen)
})

test('add puts a centred layer on top with a unique id', () => {
  const { template, id } = addLayer(tpl(), 'text')
  assert.equal(id, 'text')
  const top = sortedLayers(template).at(-1)
  assert.equal(top.id, 'text')
  assert.deepEqual([top.x, top.y], [(744 - 300) / 2, Math.round((1039 - 60) / 2)])
  assert.deepEqual(sortedLayers(template).map((l) => l.zIndex), [10, 20, 30, 40])
  assert.equal(uniqueLayerId(template, 'text'), 'text-2')
})

test('duplicate sits directly above the original', () => {
  const { template, id } = duplicateLayer(tpl(), 'bg')
  assert.equal(id, 'bg-copy')
  assert.deepEqual(sortedLayers(template).map((l) => l.id), ['bg', 'bg-copy', 'art', 'name'])
  const copy = template.layers.find((l) => l.id === 'bg-copy')
  assert.deepEqual([copy.x, copy.y], [16, 16])
})

test('reorder and move renumber zIndex in paint order', () => {
  const r = reorderLayers(tpl(), ['art', 'name', 'bg']) // top-most first
  assert.deepEqual(sortedLayers(r).map((l) => [l.id, l.zIndex]), [['bg', 10], ['name', 20], ['art', 30]])
  const up = moveLayer(tpl(), 'bg', 1)
  assert.deepEqual(sortedLayers(up).map((l) => l.id), ['art', 'bg', 'name'])
  assert.equal(moveLayer(tpl(), 'name', 1).layers.length, 3, 'moving the top layer up is a no-op')
})

test('rename validates ids', () => {
  assert.ok(renameLayer(tpl(), 'art', 'name').error)
  assert.ok(renameLayer(tpl(), 'art', '9lives').error)
  assert.ok(renameLayer(tpl(), 'art', '').error)
  assert.equal(renameLayer(tpl(), 'art', 'hero-art').template.layers.find((l) => l.id === 'hero-art').type, 'image')
})
