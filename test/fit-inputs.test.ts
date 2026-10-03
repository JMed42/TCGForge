import test from 'node:test'
import assert from 'node:assert'
import { hashOf, stableStringify } from '../src/designer/fit/hash.ts'
import { engineKey, fitInputHash, fontsSignature, imagesSignature, sizesImagesByFile } from '../src/designer/fit/inputs.ts'
import type { FitInputs } from '../src/designer/fit/inputs.ts'
import type { Template } from '../src/designer/schema/types.ts'

const card = { id: 4, name: 'Storm Herald', rules_text: 'Deal 3 damage.', cost: '2', card_type: 'Unit', custom_fields: '{"atk":4}', updated_at: '2026-10-03 10:00:00' }
const base: FitInputs = { card, templateId: 7, templateHash: hashOf('{"layers":[]}'), fontsSig: 'f1', imagesSig: null, engine: engineKey('Chrome/130.0') }

test('stable JSON ignores key order', () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}')
  assert.equal(hashOf({ x: 1, y: 2 }), hashOf({ y: 2, x: 1 }))
  assert.notEqual(hashOf({ x: 1 }), hashOf({ x: '1' }))
})

test('the key changes with every input', () => {
  const h = fitInputHash(base)
  assert.equal(fitInputHash({ ...base, card: { ...card } }), h, 'same inputs, same key')
  const changed: Array<[string, FitInputs]> = [
    ['a field', { ...base, card: { ...card, rules_text: 'Deal 4 damage.' } }],
    ['a custom field', { ...base, card: { ...card, custom_fields: '{"atk":5}' } }],
    ['the card type', { ...base, card: { ...card, card_type: 'Spell' } }],
    ['which template', { ...base, templateId: 8 }],
    ['the template content', { ...base, templateHash: hashOf('{"layers":[1]}') }],
    ['the fonts', { ...base, fontsSig: 'f2' }],
    ['the image files (when they size the text)', { ...base, imagesSig: 'i1' }],
    ['the engine', { ...base, engine: engineKey('Chrome/131.0') }],
  ]
  for (const [what, inputs] of changed) assert.notEqual(fitInputHash(inputs), h, what)
})

test('timestamps and fields the template cannot see do not change the key', () => {
  const h = fitInputHash(base)
  assert.equal(fitInputHash({ ...base, card: { ...card, updated_at: '2027-01-01', card_type_id: 99 } }), h)
})

test('font and image signatures come from the assets index', () => {
  const assets = [
    { rel_path: 'assets/fonts/Cinzel-Bold.ttf', kind: 'font', sha256: 'aa' },
    { rel_path: 'assets/art/x.png', kind: 'art', sha256: 'bb' },
  ]
  const fonts = fontsSignature(assets)
  assert.equal(fontsSignature([...assets].reverse()), fonts, 'order does not matter')
  assert.notEqual(fontsSignature([{ ...assets[0], sha256: 'ab' }, assets[1]]), fonts, 'a changed font file')
  assert.equal(fontsSignature([assets[0], { ...assets[1], sha256: 'cc' }]), fonts, 'art is not a font')
  assert.notEqual(imagesSignature([assets[0], { ...assets[1], sha256: 'cc' }]), imagesSignature(assets))
})

test('images count only when one sizes itself by its file inside a stack', () => {
  const t = (children: object[]): Template => ({ schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 0 }, layers: [
    { id: 'art', type: 'image', src: '{{image_path}}', frame: { left: 0, right: 0, top: 0, height: 40 } },
    { id: 's', type: 'stack', frame: { left: 0, right: 0, bottom: 0, height: 30 }, children },
  ] } as Template)
  assert.equal(sizesImagesByFile(t([{ id: 'r', type: 'richText', text: 'x' }])), false)
  assert.equal(sizesImagesByFile(t([{ id: 'i', type: 'image', src: 'a.png', frame: { height: 5 } }])), false, 'a set height')
  assert.equal(sizesImagesByFile(t([{ id: 'i', type: 'image', src: 'a.png' }])), true)
})
