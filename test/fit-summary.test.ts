import test from 'node:test'
import assert from 'node:assert'
import { compareHardness, describeFit, matchesFitFilter, shortFit, summarize } from '../src/designer/fit/summary.ts'
import { fieldsInText, layerLabel, textLayerFields } from '../src/designer/fit/bindings.ts'
import type { FitResult } from '../src/designer/render/fitText.ts'
import type { Template } from '../src/designer/schema/types.ts'

const r = (over: Partial<FitResult>): FitResult => ({ status: 'fits', pt: 9, lineHeight: 1.2, basePt: 9, minPt: 6.5, fill: 0.5, ...over })

test('hardest first: most overflow, then hidden, then smallest size, then fullest', () => {
  const list = [
    r({ fill: 0.9 }),
    r({ status: 'shrunk', pt: 8, fill: 1.1 }),
    r({ status: 'overflow', pt: 6.5, overflowMm: 1, overflowLines: 1, fill: 1.6 }),
    r({ status: 'shrunk', pt: 7, fill: 1.3 }),
    r({ fill: 0.2 }),
    r({ status: 'hidden', fill: 0.3 }),
    r({ status: 'overflow', pt: 6.5, overflowMm: 4, overflowLines: 3, fill: 2.2 }),
  ]
  const order = [...list].sort((a, b) => compareHardness(b, a)).map((x) => `${x.status}:${x.overflowMm ?? x.pt}:${x.fill}`)
  assert.deepEqual(order, ['overflow:4:2.2', 'overflow:1:1.6', 'hidden:9:0.3', 'shrunk:7:1.3', 'shrunk:8:1.1', 'fits:9:0.9', 'fits:9:0.2'])
})

test('a card summary leads with its hardest layer', () => {
  const s = summarize({ rules: r({ status: 'shrunk', pt: 7.25 }), flavor: r({ status: 'hidden' }), title: r({}) }, (id) => ({ rules: 'Effect', flavor: 'Flavor' } as Record<string, string>)[id] || id)
  assert.equal(s.status, 'hidden')
  assert.deepEqual(s.items.map((i) => i.label), ['Flavor', 'Effect', 'title'])
  assert.equal(summarize({}, (id) => id).status, 'empty')
})

test('the Fit filter', () => {
  const s = summarize({ rules: r({ status: 'shrunk', pt: 6.75 }), title: r({}) }, (id) => id)
  assert.equal(matchesFitFilter(s, ''), true)
  assert.equal(matchesFitFilter(s, 'shrunk'), true)
  assert.equal(matchesFitFilter(s, 'below', 7), true)
  assert.equal(matchesFitFilter(s, 'below', 6.5), false)
  assert.equal(matchesFitFilter(s, 'overflow'), false)
  assert.equal(matchesFitFilter(s, 'hidden'), false)
  assert.equal(matchesFitFilter(null, 'unchecked'), true)
  assert.equal(matchesFitFilter(s, 'unchecked'), false)
  assert.equal(matchesFitFilter(null, 'overflow'), false)
  const over = summarize({ rules: r({ status: 'overflow', pt: 6.5, overflowLines: 2, overflowMm: 3 }) }, (id) => id)
  assert.equal(matchesFitFilter(over, 'below', 7), true, 'text that overflows at 6.5 pt also shrank below 7')
})

test('wording', () => {
  assert.equal(describeFit(r({ pt: 8.5, spareLines: 2 })), 'fits at 8.5 pt · about 2 lines to spare')
  assert.equal(describeFit(r({ pt: 8.5, spareLines: 0 })), 'fits at 8.5 pt')
  assert.equal(describeFit(r({ status: 'shrunk', pt: 7.25 })), 'shrunk to 7.25 pt (min 6.5 pt)')
  assert.equal(describeFit(r({ status: 'shrunk', pt: 6.5 })), 'shrunk to 6.5 pt, its minimum')
  assert.equal(describeFit(r({ status: 'shrunk', pt: 9, lineHeight: 1.1 })), 'fits at 9 pt with tighter line spacing')
  assert.equal(describeFit(r({ status: 'overflow', pt: 6.5, overflowLines: 1, overflowMm: 1.2 })), 'overflows by 1 line at 6.5 pt')
  assert.equal(describeFit(r({ status: 'overflow', pt: 7, wide: true, overflowMm: 3.14 })), 'too wide by 3.1 mm at 7 pt')
  assert.equal(describeFit(r({ status: 'hidden' })), 'hidden (no room)')
  const item = (result: FitResult) => ({ layerId: 'rules', label: 'Effect', result })
  assert.equal(shortFit(item(r({ status: 'overflow', overflowLines: 2 }))), 'Effect +2 lines')
  assert.equal(shortFit(item(r({ status: 'shrunk', pt: 7.25 }))), 'Effect 7.25 pt')
  assert.equal(shortFit(item(r({ status: 'hidden' }))), 'Effect hidden')
})

test('which fields a text layer shows (not function names or string literals)', () => {
  assert.deepEqual(fieldsInText('{{upper(name)}} — {{if(faction == "Ember", cost, "name")}} {{ atk }}/{{def}}'), ['name', 'faction', 'cost', 'atk', 'def'])
  assert.deepEqual(fieldsInText('plain text, {{ broken('), [])
  const t = { schemaVersion: 1, size: { widthMm: 63, heightMm: 88, bleedMm: 0, safeMm: 0 }, layers: [
    { id: 'title', type: 'text', text: '{{name}}' },
    { id: 's', type: 'stack', frame: { left: 0, right: 0, bottom: 0, height: 30 }, children: [{ id: 'rules', type: 'richText', text: '{{rules_text}}' }] },
    { id: 'stats', type: 'text', text: '{{power}}/{{toughness}}' },
  ] } as Template
  const fields = textLayerFields(t)
  assert.deepEqual([...fields.entries()], [['title', ['name']], ['rules', ['rules_text']], ['stats', ['power', 'toughness']]])
  const labels: Record<string, string> = { name: 'Name', rules_text: 'Effect', power: 'ATK', toughness: 'DEF' }
  assert.equal(layerLabel('rules', fields.get('rules'), (k) => labels[k]), 'Effect')
  assert.equal(layerLabel('stats', fields.get('stats'), (k) => labels[k]), 'ATK + DEF')
  assert.equal(layerLabel('logo', [], (k) => labels[k]), 'logo')
})
