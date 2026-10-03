import test from 'node:test'
import assert from 'node:assert'
import { parseTsv, toTsv, rangeOf, inRange, parseCellValue, planPaste, planFillDown, planClear, filterCards } from '../src/components/Cards/grid/gridOps.js'

test('TSV from Excel: tabs, CRLF, quoted cells with tabs, newlines and quotes; round trip', () => {
  const text = 'Name\tATK\r\n"Ember, Drake"\t4\r\n"Line 1\nLine 2"\t"say ""hi"""\r\n'
  const rows = parseTsv(text)
  assert.deepEqual(rows, [['Name', 'ATK'], ['Ember, Drake', '4'], ['Line 1\nLine 2', 'say "hi"']])
  assert.deepEqual(parseTsv(toTsv(rows)), rows)
  assert.deepEqual(parseTsv('a\t\tc'), [['a', '', 'c']], 'empty cells kept')
  assert.deepEqual(parseTsv('single'), [['single']])
  assert.equal(toTsv([['a\tb', 'x']]), '"a\tb"\tx')
})

test('ranges', () => {
  const r = rangeOf({ row: 4, col: 1 }, { row: 2, col: 3 })
  assert.deepEqual(r, { r0: 2, r1: 4, c0: 1, c1: 3 })
  assert.ok(inRange(r, 3, 2) && !inRange(r, 5, 2))
})

const types = [{ id: 1, name: 'Unit' }, { id: 2, name: 'Spell' }]
const columns = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'card_type_id', label: 'Card type', kind: 'choice' },
  { key: 'custom:atk', label: 'ATK', kind: 'number', fieldKey: 'atk' },
  { key: 'custom:flying', label: 'Flying', kind: 'yesNo', fieldKey: 'flying' },
]
const rows = [
  { id: 10, name: 'A', card_type_id: 1, card_type: 'Unit' },
  { id: 11, name: 'B', card_type_id: 2, card_type: 'Spell' },
  { id: 12, name: 'C', card_type_id: 1, card_type: 'Unit' },
]
// Spells don't have ATK or Flying.
const applicable = (card, col) => !col.fieldKey || card.card_type_id === 1

test('cell values per kind', () => {
  assert.deepEqual(parseCellValue(columns[3], 'TRUE', types), { value: true })
  assert.deepEqual(parseCellValue(columns[3], 'no', types), { value: false })
  assert.ok('skip' in parseCellValue(columns[3], 'maybe', types))
  assert.deepEqual(parseCellValue(columns[1], 'spell', types), { value: '2' })
  assert.ok('skip' in parseCellValue(columns[1], 'Relic', types))
  assert.ok('skip' in parseCellValue(columns[0], ' ', types))
})

test('paste a block: skips cells the type does not use, reports overflow', () => {
  const plan = planPaste({ grid: [['4', 'TRUE'], ['5', 'FALSE'], ['6', 'yes'], ['7', 'no']], range: rangeOf({ row: 0, col: 2 }, { row: 0, col: 2 }), rows, columns, applicable, types })
  assert.deepEqual(plan.writes, [
    { cardId: 10, key: 'custom:atk', value: '4' }, { cardId: 10, key: 'custom:flying', value: true },
    { cardId: 12, key: 'custom:atk', value: '6' }, { cardId: 12, key: 'custom:flying', value: true },
  ])
  assert.equal(plan.skipped, 2)
  assert.equal(plan.overflowRows, 1)
  assert.match(plan.reasons[0], /ATK isn't used by Spell/)
})

test('one value pasted on a larger selection fills it', () => {
  const plan = planPaste({ grid: [['9']], range: rangeOf({ row: 0, col: 2 }, { row: 2, col: 2 }), rows, columns, applicable, types })
  assert.deepEqual(plan.writes.map((w) => [w.cardId, w.value]), [[10, '9'], [12, '9']])
})

test('fill down from the top row, or from the row above a single row', () => {
  const raw = (card, key) => ({ 10: { 'custom:atk': '3', name: 'A' }, 11: {}, 12: {} })[card.id][key] ?? ''
  const plan = planFillDown({ range: rangeOf({ row: 0, col: 2 }, { row: 2, col: 2 }), rows, columns, applicable, raw })
  assert.deepEqual(plan.writes, [{ cardId: 12, key: 'custom:atk', value: '3' }])
  assert.equal(plan.skipped, 1, 'the Spell row is skipped')
  const one = planFillDown({ range: rangeOf({ row: 2, col: 2 }, { row: 2, col: 2 }), rows, columns, applicable, raw: (c, k) => (c.id === 11 ? '' : raw(c, k)) })
  assert.deepEqual(one.writes, [], 'row above is a Spell without ATK: nothing to copy')
})

test('clear a range keeps names and types', () => {
  const plan = planClear({ range: rangeOf({ row: 0, col: 0 }, { row: 1, col: 3 }), rows, columns, applicable })
  assert.deepEqual(plan.writes, [{ cardId: 10, key: 'custom:atk', value: '' }, { cardId: 10, key: 'custom:flying', value: false }])
})

test('filters: search across fields, card type, field conditions, missing art', () => {
  const cards = [
    { id: 1, name: 'Ember Drake', card_type_id: 1, rules_text: 'Flying', custom_fields: { faction: 'Ember' } },
    { id: 2, name: 'Tide', card_type_id: 2, rules_text: '', custom_fields: { faction: 'Tide' } },
    { id: 3, name: 'Blank', card_type_id: 1, rules_text: '', custom_fields: {} },
  ]
  const text = (c, k) => String(k in c ? c[k] : c.custom_fields[k] ?? '')
  const ids = (f, o) => filterCards(cards, f, text, o).map((c) => c.id)
  assert.deepEqual(ids({ search: 'ember' }), [1], 'custom field values are searched')
  assert.deepEqual(ids({ cardTypeId: '1' }), [1, 3])
  assert.deepEqual(ids({ fieldKey: 'faction', fieldOp: 'is', fieldValue: 'tide' }), [2])
  assert.deepEqual(ids({ fieldKey: 'faction', fieldOp: 'empty' }), [3])
  assert.deepEqual(ids({ fieldKey: 'rules_text', fieldOp: 'notEmpty' }), [1])
  assert.deepEqual(ids({}, { missingIds: new Set([2]) }), [2])
})

test('the Fit column is worked out, not typed: paste, fill-down and clear skip it', () => {
  const withFit = [columns[0], { key: 'fit', label: 'Fit', kind: 'fit', readOnly: true }, ...columns.slice(1)]
  const paste = planPaste({ grid: [['Fits', 'Spell']], range: rangeOf({ row: 0, col: 1 }, { row: 0, col: 1 }), rows, columns: withFit, applicable, types })
  assert.deepEqual(paste.writes, [{ cardId: 10, key: 'card_type_id', value: '2' }])
  assert.match(paste.reasons[0], /Fit is worked out/)
  const fill = planFillDown({ range: rangeOf({ row: 0, col: 1 }, { row: 2, col: 1 }), rows, columns: withFit, applicable, raw: () => 'x' })
  assert.deepEqual(fill.writes, [])
  assert.deepEqual(planClear({ range: rangeOf({ row: 0, col: 1 }, { row: 2, col: 1 }), rows, columns: withFit, applicable }).writes, [])
})

test('the Fit filter reads each card\'s fit summary', () => {
  const cards = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
  const r = (status, pt) => ({ status, pt, lineHeight: 1.2, basePt: 9, minPt: 6.5, fill: 1 })
  const summaries = {
    1: { status: 'overflow', worst: null, items: [{ layerId: 'rules', label: 'rules', result: r('overflow', 6.5) }] },
    2: { status: 'shrunk', worst: null, items: [{ layerId: 'rules', label: 'rules', result: r('shrunk', 7.5) }] },
  }
  const fitOf = (c) => summaries[c.id] || null
  const ids = (f) => filterCards(cards, f, () => '', { fitOf }).map((c) => c.id)
  assert.deepEqual(ids({ fit: 'overflow' }), [1])
  assert.deepEqual(ids({ fit: 'shrunk' }), [2])
  assert.deepEqual(ids({ fit: 'below', fitBelowPt: 7 }), [1])
  assert.deepEqual(ids({ fit: 'below', fitBelowPt: '8' }), [1, 2])
  assert.deepEqual(ids({ fit: 'unchecked' }), [3])
  assert.deepEqual(ids({ fit: '' }), [1, 2, 3])
})
