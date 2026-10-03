import test from 'node:test'
import assert from 'node:assert'
import {
  cardTexts, keepCase, keywordRename, keywordWhereUsed, symbolRename, symbolWhereUsed, usesCount, variableRename, variableWhereUsed,
} from '../src/components/Library/whereUsed.js'

const cards = [
  { id: 1, name: 'Ember', rules_text: 'Burn 2. Pay {fire}.', flavor_text: '', custom_fields: { lore: 'It burns.' } },
  { id: 2, name: 'Tide', rules_text: 'Draw {{HAND_SIZE}} cards. \\{fire} is not a symbol.', custom_fields: {} },
  { id: 3, name: 'Burnout', rules_text: 'Nothing here', custom_fields: {} },
]
const documents = [
  { id: 10, type: 'rule', title: 'Burn', content: '<p>A unit with <b>burn</b> deals damage.</p>' },
  { id: 11, type: 'folder', title: 'Burn folder', content: '' },
  { id: 12, type: 'document', title: 'Lore', content: '<p>Nothing</p>' },
]
const tpl = (layers) => ({ schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 0 }, layers })
const templates = new Map([
  [1, { row: { id: 1, name: 'Unit Frame' }, template: tpl([{ id: 'pips', type: 'iconRepeat', count: 'cost', icon: 'fire' }, { id: 't', type: 'text', text: 'Max {{HAND_SIZE}} {fire}' }]) }],
  [2, { row: { id: 2, name: 'Spell Frame' }, template: tpl([{ id: 't', type: 'text', text: '{{name}}' }]) }],
])
const rules = [{ id: 7, condition_expr: 'number(cost) > HAND_SIZE', template_id: 1 }, { id: 8, condition_expr: 'true', template_id: 2 }]

test('a card\'s text values, custom fields included', () => {
  assert.deepEqual(cardTexts(cards[0]).map((f) => f.key), ['name', 'rules_text', 'custom:lore'])
})

test('keyword: cards and Game Docs that use the name as a word; rename keeps case', () => {
  const uses = keywordWhereUsed({ cards, documents }, 'Burn')
  assert.deepEqual(uses.cards.map((u) => u.card.id), [1], '"burns" and "Burnout" are other words')
  assert.deepEqual(uses.docs.map((d) => d.id), [10])
  const r = keywordRename(uses, 'Burn', 'Scorch')
  assert.deepEqual(r.cards, [{ id: 1, patch: { rules_text: 'Scorch 2. Pay {fire}.' } }])
  assert.equal(keepCase('burn', 'Scorch'), 'scorch')
  assert.equal(keepCase('BURN', 'Scorch'), 'SCORCH')
  assert.equal(keepCase('Burn', 'scorch'), 'Scorch')
})

test('symbol: cards (not escaped braces) and templates (text and icon repeaters); rename rewrites both', () => {
  const uses = symbolWhereUsed({ cards, documents, templates }, 'fire')
  assert.deepEqual(uses.cards.map((u) => u.card.id), [1])
  assert.deepEqual(uses.templates.map((t) => t.name), ['Unit Frame'])
  const r = symbolRename(uses, templates, 'fire', 'flame')
  assert.equal(r.cards[0].patch.rules_text, 'Burn 2. Pay {flame}.')
  const layers = JSON.parse(r.templates[0].content).layers
  assert.equal(layers[0].icon, 'flame')
  assert.equal(layers[1].text, 'Max {{HAND_SIZE}} {flame}')
})

test('variable: cards, templates and exceptions; rename is token-aware', () => {
  const uses = variableWhereUsed({ cards, documents, templates, rules }, 'HAND_SIZE')
  assert.deepEqual(uses.cards.map((u) => u.card.id), [2])
  assert.deepEqual(uses.templates.map((t) => t.name), ['Unit Frame'])
  assert.deepEqual(uses.rules.map((r) => r.id), [7])
  assert.equal(usesCount(uses), 3)
  const r = variableRename(uses, templates, 'HAND_SIZE', 'MAX_HAND')
  assert.match(r.cards[0].patch.rules_text, /^Draw \{\{MAX_HAND\}\} cards\./)
  assert.equal(JSON.parse(r.templates[0].content).layers[1].text, 'Max {{MAX_HAND}} {fire}')
  assert.deepEqual(r.rules, [{ id: 7, condition_expr: 'number(cost) > MAX_HAND' }])
})
