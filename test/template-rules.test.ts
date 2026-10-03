import test from 'node:test'
import assert from 'node:assert'
import { resolveTemplate, resolveAll, orderRules, ruleStats, describeResolution } from '../src/designer/rules/resolveTemplate.ts'

const IDS = [7, 3, 9] // default = lowest id = 3
const rules = orderRules([
  { priority: 1, condition_expr: 'type == "Spell"', template_id: 9 },
  { priority: 0, condition_expr: 'type == "Unit" && number(cost) >= 5', template_id: 7 },
  { priority: 2, condition_expr: 'contains(lower(tags), "token")', template_id: 7 },
])

test('first matching rule by priority wins', () => {
  assert.deepEqual(resolveTemplate({ type: 'Unit', cost: '6' }, rules, IDS), { templateId: 7, reason: 'rule', ruleIndex: 0, errors: [] })
  assert.equal(resolveTemplate({ type: 'Spell', cost: '6' }, rules, IDS).ruleIndex, 1)
  assert.equal(resolveTemplate({ type: 'Unit', tags: 'Token,small' }, rules, IDS).ruleIndex, 2)
})

test('no match falls back to the lowest template id; no templates gives none', () => {
  assert.deepEqual(resolveTemplate({ type: 'Land' }, rules, IDS), { templateId: 3, reason: 'default', errors: [] })
  assert.deepEqual(resolveTemplate({ type: 'Land' }, rules, []), { templateId: null, reason: 'none', errors: [] })
})

test('override beats rules unless its template is gone', () => {
  assert.equal(resolveTemplate({ type: 'Spell', template_override_id: 3 }, rules, IDS).reason, 'override')
  assert.equal(resolveTemplate({ type: 'Spell', template_override_id: 99 }, rules, IDS).templateId, 9)
  assert.equal(resolveTemplate({ type: 'Spell', template_override_id: null }, rules, IDS).templateId, 9)
})

test('rules pointing at deleted templates are skipped; empty condition always matches', () => {
  const r = orderRules([{ condition_expr: 'true', template_id: 42 }, { condition_expr: '', template_id: 9 }])
  assert.deepEqual(resolveTemplate({}, r, IDS), { templateId: 9, reason: 'rule', ruleIndex: 1, errors: [] })
})

test('a broken condition counts as false and is reported', () => {
  const r = orderRules([{ condition_expr: 'nosuchfn(name)', template_id: 9 }, { condition_expr: 'type == ', template_id: 7 }])
  const res = resolveTemplate({ name: 'X' }, r, IDS)
  assert.equal(res.templateId, 3)
  assert.equal(res.errors.length, 2)
  assert.match(res.errors[0], /^rule 1: /)
})

test('custom fields are visible to conditions', () => {
  const r = orderRules([{ condition_expr: 'faction == "Ember"', template_id: 9 }])
  assert.equal(resolveTemplate({ custom_fields: '{"faction":"Ember"}' }, r, IDS).templateId, 9)
})

test('resolveAll, stats and descriptions', () => {
  const cards = [
    { id: 1, type: 'Unit', cost: '5' }, { id: 2, type: 'Spell' }, { id: 3, type: 'Land' },
    { id: 4, type: 'Land', template_override_id: 9 },
  ]
  const all = resolveAll(cards, rules, IDS)
  assert.deepEqual([...all.values()].map((r) => r.templateId), [7, 9, 3, 9])
  assert.deepEqual(ruleStats(cards, rules, IDS), { perRule: [1, 1, 0], overrides: 1, defaults: 1, withErrors: 0 })
  const name = (id: number) => `T${id}`
  assert.equal(describeResolution(all.get(2)!, name), 'T9 (rule 2)')
  assert.equal(describeResolution(all.get(3)!, name), 'T3 (default)')
  assert.equal(describeResolution(all.get(4)!, name), 'T9 (chosen for this card)')
})
