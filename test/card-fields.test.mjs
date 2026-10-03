import test from 'node:test'
import assert from 'node:assert'
import {
  getFieldValue, withField, applyLive, customFieldNames, columnsFor, customKey,
  createCellHistory, recordCellEdit, undoCell, redoCell,
} from '../src/components/Cards/grid/cardFields.js'

const card = { id: 1, name: 'Ember Drake', cost: '5', tags: ['dragon', 'fire'], custom_fields: { element: 'Fire' } }

test('cells read built-in columns, tags and custom fields as text', () => {
  assert.equal(getFieldValue(card, 'cost'), '5')
  assert.equal(getFieldValue(card, 'tags'), 'dragon, fire')
  assert.equal(getFieldValue(card, customKey('element')), 'Fire')
  assert.equal(getFieldValue(card, customKey('missing')), '')
  assert.equal(getFieldValue(card, 'rules_text'), '')
})

test('withField returns the new card and the patch for updateCard', () => {
  assert.deepEqual(withField(card, 'cost', '6').patch, { cost: '6' })
  assert.deepEqual(withField(card, 'tags', 'a, b,,c ').card.tags, ['a', 'b', 'c'])
  const custom = withField(card, customKey('faction'), 'Ember')
  assert.deepEqual(custom.patch, { custom_fields: { element: 'Fire', faction: 'Ember' } })
  assert.deepEqual(withField(card, customKey('element'), '').card.custom_fields, {}, 'clearing removes the key')
  assert.throws(() => withField(card, 'name', '  '), /needs a name/)
  assert.equal(card.cost, '5', 'input not mutated')
})

test('applyLive only touches the card being edited', () => {
  const live = { cardId: 1, key: 'rules_text', value: 'Flying.' }
  assert.equal(applyLive(card, live).rules_text, 'Flying.')
  assert.equal(applyLive({ ...card, id: 2 }, live).rules_text, undefined)
  assert.equal(applyLive(card, { cardId: 1, key: 'name', value: '' }).name, '', 'a half-typed empty name still previews')
})

test('custom columns come from the card schema, then from cards; built-ins are skipped', () => {
  const schema = { fields: [{ name: 'name' }, { name: 'element' }, { name: 'health' }, { name: 'cost' }] }
  const names = customFieldNames([card, { custom_fields: { artist: 'x', element: 'y' } }], schema)
  assert.deepEqual(names, ['element', 'health', 'artist'])
  assert.deepEqual(columnsFor(['artist']).slice(-1)[0], { key: 'custom:artist', label: 'artist', width: 130, custom: true })
})

test('cell history undoes and redoes in order', () => {
  let h = createCellHistory()
  h = recordCellEdit(h, { cardId: 1, key: 'cost', before: '5', after: '6' })
  h = recordCellEdit(h, { cardId: 1, key: 'cost', before: '6', after: '7' })
  const u1 = undoCell(h)
  assert.equal(u1.value, '6')
  const u2 = undoCell(u1.history)
  assert.equal(u2.value, '5')
  assert.equal(undoCell(u2.history), null)
  const r = redoCell(u2.history)
  assert.equal(r.value, '6')
  assert.equal(recordCellEdit(r.history, { cardId: 1, key: 'x', before: '', after: '1' }).future.length, 0, 'a new edit clears redo')
})
