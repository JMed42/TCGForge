import test from 'node:test'
import assert from 'node:assert'
import { createHistory, pushHistory, undoHistory, redoHistory, HISTORY_LIMIT } from '../src/components/CardDesigner/editor/history.js'


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
