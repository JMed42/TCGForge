import test from 'node:test'
import assert from 'node:assert'
import { hitTest, moveRect, resizeRect, snapRect, snapTargets } from '../src/components/CardDesigner/editor/geometry.js'

const start = { x: 100, y: 100, width: 200, height: 100 }

test('hitTest returns the top-most visible, unlocked layer', () => {
  const layers = [
    { id: 'top', x: 0, y: 0, width: 50, height: 50, visible: false },
    { id: 'locked', x: 0, y: 0, width: 50, height: 50, locked: true },
    { id: 'mid', x: 10, y: 10, width: 50, height: 50 },
    { id: 'bottom', x: 0, y: 0, width: 500, height: 500 },
  ]
  assert.equal(hitTest(layers, { x: 20, y: 20 }), 'mid')
  assert.equal(hitTest(layers, { x: 5, y: 5 }), 'bottom')
  assert.equal(hitTest(layers, { x: 900, y: 5 }), null)
})

test('move, with Shift axis lock', () => {
  assert.deepEqual(moveRect(start, 30, -10), { ...start, x: 130, y: 90 })
  assert.deepEqual(moveRect(start, 30, -10, { axisLock: true }), { ...start, x: 130, y: 100 })
  assert.deepEqual(moveRect(start, 3, -10, { axisLock: true }), { ...start, x: 100, y: 90 })
})

test('resize from each kind of handle', () => {
  assert.deepEqual(resizeRect(start, 'se', 20, 10), { x: 100, y: 100, width: 220, height: 110 })
  assert.deepEqual(resizeRect(start, 'nw', 20, 10), { x: 120, y: 110, width: 180, height: 90 })
  assert.deepEqual(resizeRect(start, 'e', 50, 999), { x: 100, y: 100, width: 250, height: 100 })
  assert.deepEqual(resizeRect(start, 'n', 999, -40), { x: 100, y: 60, width: 200, height: 140 })
})

test('resizing past the opposite edge clamps instead of flipping', () => {
  assert.deepEqual(resizeRect(start, 'w', 500, 0), { x: 296, y: 100, width: 4, height: 100 })
  assert.deepEqual(resizeRect(start, 's', 0, -500), { x: 100, y: 100, width: 200, height: 4 })
})

test('Shift keeps the aspect ratio', () => {
  const corner = resizeRect(start, 'se', 100, 0, { keepAspect: true })
  assert.deepEqual(corner, { x: 100, y: 100, width: 300, height: 150 })
  const nw = resizeRect(start, 'nw', -100, 0, { keepAspect: true })
  assert.deepEqual(nw, { x: 0, y: 50, width: 300, height: 150 })
  const edge = resizeRect(start, 'e', 100, 0, { keepAspect: true })
  assert.deepEqual(edge, { x: 100, y: 75, width: 300, height: 150 }, 'edge handle scales around the centre')
})

test('snapping a move to card centre and other layers', () => {
  const template = { meta: { width: 744, height: 1039 }, layers: [{ id: 'other', x: 400, y: 600, width: 100, height: 50 }, { id: 'me', ...start }] }
  const targets = snapTargets(template, 'me')
  // Centre x of a 200-wide rect at x=270 is 370: the card centre (372) is 2 away.
  const { rect, guides } = snapRect({ ...start, x: 270, y: 597 }, targets, 4)
  assert.equal(rect.x, 272)
  assert.deepEqual(guides.x, [372])
  assert.equal(rect.y, 600, 'top edge snaps to the other layer top')
  assert.deepEqual(guides.y, [600])
  const far = snapRect({ ...start, x: 230, y: 300 }, targets, 4)
  assert.deepEqual(far.guides, { x: [], y: [] })
})

test('snapping a resize only moves the dragged edges', () => {
  const targets = { xs: [0, 372, 744], ys: [0, 519.5, 1039] }
  const { rect, guides } = snapRect({ x: 100, y: 100, width: 643, height: 100 }, targets, 4, 'e')
  assert.deepEqual(rect, { x: 100, y: 100, width: 644, height: 100 })
  assert.deepEqual(guides.x, [744])
  const left = snapRect({ x: 3, y: 100, width: 300, height: 100 }, targets, 4, 'w')
  assert.deepEqual(left.rect, { x: 0, y: 100, width: 303, height: 100 })
})
