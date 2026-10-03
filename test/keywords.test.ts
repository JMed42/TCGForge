import test from 'node:test'
import assert from 'node:assert'
import { applyKeywords, compileKeywords, usesKeyword } from '../src/designer/library/keywords.ts'
import { cardScope } from '../src/designer/expr/scope.ts'
import { expandVariables } from '../src/designer/library/variables.ts'

const keywords = compileKeywords([
  { name: 'Guard', params: [], reminder_template: '(Units must attack this first.)' },
  { name: 'Burn', params: [{ name: 'X', kind: 'number' }], reminder_template: '(Deal {{X}} damage{{if(X > 1, " split as you choose", "")}}.)' },
  { name: 'Burn Bright', params: [], reminder_template: 'Burns twice' },
  { name: 'Rally', params: [], reminder_template: '' },
  { name: 'Bond', params: [{ name: 'Type', kind: 'word' }], reminder_template: '(Works with {{Type}}.)' },
])
const run = (text: string, opts = {}) => applyKeywords(text, keywords, cardScope({ name: 'Card' }), opts).text

test('found as whole words regardless of case; reminder after the keyword, in italics', () => {
  assert.equal(run('Guard. Draw a card.'), 'Guard. *(Units must attack this first.)* Draw a card.')
  assert.equal(run('This unit has guard'), 'This unit has guard *(Units must attack this first.)*')
  assert.equal(run('Guardian of the gate'), 'Guardian of the gate', 'not part of a longer word')
  assert.equal(run('Pay {guard} to block'), 'Pay {guard} to block', 'not inside a symbol')
})

test('after the punctuation and bold it closes; first occurrence only', () => {
  assert.equal(run('**Guard.** Other units guard too.'), '**Guard.** *(Units must attack this first.)* Other units guard too.')
})

test('reminder text already written on the card is not added again', () => {
  assert.equal(run('*Guard* (Units must attack this first.) Draw.'), '*Guard* (Units must attack this first.) Draw.')
  assert.equal(run('Guard *(Old wording.)*'), 'Guard *(Old wording.)*')
  assert.equal(run('Burn 2 (two damage). Guard.'), 'Burn 2 (two damage). Guard. *(Units must attack this first.)*')
  assert.deepEqual(applyKeywords('*Guard* (Units must attack this first.)', keywords, cardScope({})).found, ['Guard'], 'still found, for where-used')
})

test('parameters, and conditional reminder text', () => {
  assert.equal(run('Burn 1.'), 'Burn 1. *(Deal 1 damage.)*')
  assert.equal(run('Burn 3 and draw.'), 'Burn 3 *(Deal 3 damage split as you choose.)* and draw.')
  // A letter standing for a number is matched; comparisons with it are text comparisons.
  assert.equal(run('Burn X'), 'Burn X *(Deal X damage split as you choose.)*')
  assert.equal(run('Burn the deck'), 'Burn the deck', 'a number parameter needs a number')
  assert.equal(run('Bond Dragon'), 'Bond Dragon *(Works with Dragon.)*')
})

test('a longer keyword wins over the one it starts with; empty reminders add nothing', () => {
  assert.equal(run('Burn Bright.'), 'Burn Bright. *(Burns twice)*')
  assert.equal(run('**Rally.** Other units get +1 ATK.'), '**Rally.** Other units get +1 ATK.')
})

test('plain text gets plain reminders; markup characters in reminders are escaped', () => {
  assert.equal(run('Guard', { markup: false }), 'Guard (Units must attack this first.)')
  const star = compileKeywords([{ name: 'Star', params: [], reminder_template: '(a * b)' }])
  assert.equal(applyKeywords('Star', star, cardScope(null)).text, 'Star *(a \\* b)*')
})

test('a broken reminder becomes a warning, not a crash', () => {
  const broken = compileKeywords([{ name: 'Oops', params: [], reminder_template: '({{if(}})' }])
  const r = applyKeywords('Oops', broken, cardScope(null))
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /keyword Oops/)
})

test('where used', () => {
  assert.equal(usesKeyword('This unit has Burn 2.', keywords.find((k) => k.name === 'Burn')!), true)
  assert.equal(usesKeyword('Burned out', keywords.find((k) => k.name === 'Burn')!), false)
})

test('variables: identifiers in scope and {{KEY}} in card text, once, no nesting', () => {
  const vars = { HAND_SIZE: '7', LOOP: '{{HAND_SIZE}}' }
  const scope = cardScope({ name: 'A', rules_text: 'Draw up to {{HAND_SIZE}} cards. {{LOOP}} {{MISSING}}' }, vars)
  assert.equal(scope.rules_text, 'Draw up to 7 cards. {{HAND_SIZE}} {{MISSING}}')
  assert.equal(scope.HAND_SIZE, '7')
  assert.equal(cardScope(null, vars).HAND_SIZE, '7', 'templates can use them with no card')
  assert.deepEqual(expandVariables('{{ HAND_SIZE }} {{lower}}', vars), { text: '7 {{lower}}', unknown: [] })
  const legacy = cardScope({ name: 'A', custom_fields: '{"HAND_SIZE":"3"}' }, vars)
  assert.equal(legacy.HAND_SIZE, '3', 'a card field of the same name wins')
})
