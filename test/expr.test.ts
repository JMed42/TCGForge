import test from 'node:test'
import assert from 'node:assert'
import { compile, evaluate, interpolate, condition, splitTemplate, LIMITS } from '../src/designer/expr/expr.ts'
import { cardScope, bindableFields } from '../src/designer/expr/scope.ts'

const card = {
  id: 7, name: 'Ember Drake', type: 'Unit', rarity: 'Mythic', cost: '5', power: '4', toughness: '3',
  rules_text: 'Flying.', flavor_text: '', tags: 'dragon,fire',
  custom_fields: JSON.stringify({ faction: 'Ember', element: 'Fire', nested: { a: 1 }, 'bad key': 1 }),
}
const scope = cardScope(card)
const val = (src: string) => {
  const r = evaluate(src, scope)
  assert.ok(r.ok, `${src}: ${!r.ok && r.error}`)
  return r.value
}

test('the spec examples', () => {
  assert.equal(interpolate('{{cost}}', scope).text, '5')
  assert.equal(interpolate('{{upper(name)}}', scope).text, 'EMBER DRAKE')
  assert.equal(interpolate('{{if(faction == "Ember", "#c0392b", "#555")}}', scope).text, '#c0392b')
  assert.equal(interpolate('frames/{{lower(faction)}}.png', scope).text, 'frames/ember.png')
  assert.equal(interpolate('{{power}}/{{toughness}}', scope).text, '4/3')
  assert.equal(condition("type == 'Unit'", scope).value, true)
  assert.equal(condition("flavor_text != ''", scope).value, false)
  assert.equal(condition('rarity = "Mythic"', scope).value, true, 'single = is equality, as written in the spec prose')
})

test('numbers stored as text behave as numbers', () => {
  assert.equal(val('cost + 1'), 6)
  assert.equal(val('cost * power'), 20)
  assert.equal(val('cost > 10'), false, 'numeric, not "5" > "10" as strings')
  assert.equal(val('"a" + cost'), 'a5')
  assert.equal(val('round(10 / 3, 2)'), 3.33)
  assert.equal(val('-power + 1'), -3)
  assert.equal(val('7 % 4'), 3)
})

test('precedence and logic', () => {
  assert.equal(val('1 + 2 * 3'), 7)
  assert.equal(val('(1 + 2) * 3'), 9)
  assert.equal(val('power >= 3 && rarity == "Mythic" || false'), true)
  assert.equal(val('!contains(rules_text, "flying")'), false)
  assert.equal(val('10 - 2 - 3'), 5, 'left-associative')
})

test('missing fields and defaults', () => {
  assert.equal(val('missing_field'), null)
  assert.equal(interpolate('[{{missing_field}}]', scope).text, '[]')
  assert.equal(val('default(flavor_text, "—")'), '—')
  assert.equal(val('len(name)'), 11)
  assert.equal(val('if(false, 1)'), null)
})

test('custom fields are exposed; nested objects and odd keys are not', () => {
  assert.equal(val('element'), 'Fire')
  assert.equal(val('nested'), null)
  assert.deepEqual(bindableFields([card]).slice(-2), ['element', 'faction'])
})

test('nothing can escape the sandbox', () => {
  const evil = [
    'constructor', '__proto__', 'toString', 'hasOwnProperty', 'prototype',
    'name.constructor', 'name["constructor"]', 'eval("1")', 'Function("return 1")()',
    'process', 'globalThis', 'require("fs")', 'this', 'window.api', 'name; 1',
  ]
  for (const src of evil) {
    const r = evaluate(src, scope)
    assert.ok(!r.ok || r.value === null, `${src} must fail or be null, got ${JSON.stringify(r)}`)
  }
  assert.equal(evaluate('constructor', cardScope({ custom_fields: '{"constructor":"x"}' })).ok, true)
  // "=" is equality, never assignment: the scope is unchanged.
  assert.deepEqual(evaluate('name = 1', scope), { ok: true, value: false })
  assert.equal(scope.name, 'Ember Drake')
})

test('limits and errors never throw', () => {
  assert.equal(compile('1 +').ok, false)
  assert.equal(compile('"open').ok, false)
  assert.equal(compile('nofn(1)').ok, false)
  assert.equal(compile('upper()').ok, false, 'arity is checked')
  assert.equal(compile('#').ok, false)
  assert.equal(compile('1'.repeat(LIMITS.maxLength + 1)).ok, false)
  assert.equal(compile('('.repeat(200) + '1' + ')'.repeat(200)).ok, false, 'depth limit')
  assert.equal(evaluate('1 / 0', scope).ok, false)
  assert.equal(evaluate('round("abc")', scope).ok, false)
  const r = interpolate('a{{1/0}}b{{nope(}}c', scope)
  assert.equal(r.text, 'abc')
  assert.equal(r.errors.length, 2)
})

test('template splitting', () => {
  assert.deepEqual(splitTemplate('x {{ "}}" }} y'), [{ lit: 'x ' }, { expr: '"}}"' }, { lit: ' y' }])
  assert.deepEqual(splitTemplate('no {{ close'), [{ lit: 'no {{ close' }])
  assert.equal(interpolate('{{ "}}" }}', scope).text, '}}')
})
