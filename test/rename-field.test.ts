import test from 'node:test'
import assert from 'node:assert'
import { renameIdentifier, renameInTemplateText, interpolate } from '../src/designer/expr/expr.ts'
import { cardScope } from '../src/designer/expr/scope.ts'
import { renameFieldInTemplate, templateUsesField } from '../src/designer/model/renameField.ts'

test('renameIdentifier touches identifiers only: not strings, not function names, not longer names', () => {
  assert.equal(renameIdentifier('atk + 1', 'atk', 'attack'), 'attack + 1')
  assert.equal(renameIdentifier('if(atk > 3, "atk high", atk_bonus)', 'atk', 'attack'), 'if(attack > 3, "atk high", atk_bonus)')
  assert.equal(renameIdentifier('upper(name)', 'upper', 'x'), 'upper(name)', 'a function call stays')
  assert.equal(renameIdentifier('  atk==atk ', 'atk', 'a'), '  a==a ', 'spacing kept')
  assert.equal(renameIdentifier('atk ==', 'atk', 'a'), 'a ==', 'still renamed in an incomplete expression')
  assert.equal(renameIdentifier('"unterminated', 'atk', 'a'), '"unterminated', "source that doesn't tokenize is unchanged")
})

test('renameInTemplateText renames inside {{ }} only', () => {
  assert.equal(renameInTemplateText('ATK {{atk}} / {{ def }} atk', 'atk', 'attack'), 'ATK {{attack}} / {{ def }} atk')
  assert.equal(renameInTemplateText('{{concat("}}", atk)}}', 'atk', 'a'), '{{concat("}}", a)}}', 'a "}}" inside a string does not end the span')
  assert.equal(renameInTemplateText('no bindings', 'atk', 'a'), 'no bindings')
})

test('renameFieldInTemplate covers text, sources, colours, visibleIf, count and nested children', () => {
  const t: any = {
    schemaVersion: 1, name: 'T', size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3 },
    layers: [
      { id: 'atk', type: 'text', text: '{{atk}}', style: { color: '{{if(atk > 3, "#f00", "#fff")}}' }, visibleIf: 'atk != ""' },
      { id: 'pips', type: 'iconRepeat', icon: 'atk', count: 'number(atk)' },
      { id: 'g', type: 'group', children: [{ id: 'art', type: 'image', src: 'art/{{atk}}.png' }] },
      { id: 'other', type: 'text', text: 'atk {{def}}' },
    ],
  }
  const r: any = renameFieldInTemplate(t, 'atk', 'attack')
  assert.equal(r.layers[0].id, 'atk', 'layer ids are not field references')
  assert.equal(r.layers[0].text, '{{attack}}')
  assert.equal(r.layers[0].style.color, '{{if(attack > 3, "#f00", "#fff")}}')
  assert.equal(r.layers[0].visibleIf, 'attack != ""')
  assert.equal(r.layers[1].icon, 'atk', 'plain strings are not bindings')
  assert.equal(r.layers[1].count, 'number(attack)')
  assert.equal(r.layers[2].children[0].src, 'art/{{attack}}.png')
  assert.equal(r.layers[3], t.layers[3], 'untouched layers keep their identity')
  assert.equal(renameFieldInTemplate(t, 'nope', 'x'), t)
  assert.ok(templateUsesField(t, 'def') && !templateUsesField(t, 'hp'))
})

test('card_type is visible to expressions', () => {
  assert.equal(interpolate('{{upper(card_type)}}', cardScope({ card_type: 'Unit' })).text, 'UNIT')
})
