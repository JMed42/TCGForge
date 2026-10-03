import test from 'node:test'
import assert from 'node:assert'
import { parseRichText, parseSymbols, plainText } from '../src/designer/render/markup.ts'
import { compileLibrary, remindersOn, librarySignature } from '../src/designer/library/library.ts'
import { repeatCount, repeatPositions } from '../src/designer/library/iconRepeat.ts'

const symbols = new Set(['fire', 'T', 'W/U', '2'])
const flat = (lines: ReturnType<typeof parseRichText>) => lines.map((runs) => runs.map((r) => (r.symbol ? `<${r.symbol}${r.bold ? ' b' : ''}${r.italic ? ' i' : ''}>` : r.text)).join('|'))

test('known shortcodes become symbol runs, in bold and italic too', () => {
  assert.deepEqual(flat(parseRichText('Pay {fire}{fire}: **draw {T}** *or {W/U}*', { symbols })), ['Pay |<fire>|<fire>|: |draw |<T b>| |or |<W/U i>'])
  assert.deepEqual(flat(parseRichText('{2} then\n{fire}', { symbols })), ['<2>| then', '<fire>'])
})

test('unknown codes, escapes and {{ }} stay text', () => {
  const unknown: string[] = []
  assert.deepEqual(flat(parseRichText('{ice} \\{fire} {{HAND_SIZE}} {not a code} {}', { symbols, unknown })), ['{ice} {fire} {{HAND_SIZE}} {not a code} {}'])
  assert.deepEqual(unknown, ['ice'])
  assert.equal(plainText('<b>not html</b> {fire}'), '<b>not html</b> {fire}', 'without a symbol list nothing is a symbol')
})

test('plain Text reads symbols but not bold or italic, and keeps other backslashes', () => {
  const runs = parseSymbols('5 * {fire} = *x* \\d', { symbols })
  assert.deepEqual(runs.map((r) => r.symbol ? `<${r.symbol}>` : r.text), ['5 * ', '<fire>', ' = *x* \\d'])
})

test('the library: symbol sizes, reminder choice by card, set and project, signature', () => {
  const rows = {
    symbols: [{ shortcode: 'fire', rel_path: 'assets/icons/fire.png', scale: 1.1, baseline_offset: -0.2, width: 64, height: 32 }],
    keywords: [{ name: 'Guard', params: [], reminder_template: '(Units must attack this first.)' }],
    variables: [{ key: 'HAND_SIZE', value: '7' }],
    settings: { reminders: { show: true, sets: { Core: false } } },
  }
  const lib = compileLibrary(rows)
  assert.deepEqual(lib.symbols.get('fire'), { code: 'fire', relPath: 'assets/icons/fire.png', aspect: 2, scale: 1.1, offset: -0.2 })
  assert.equal(lib.variables.HAND_SIZE, '7')
  assert.equal(remindersOn(lib, { set_name: 'Promo' }), true, 'project default')
  assert.equal(remindersOn(lib, { set_name: 'Core' }), false, 'the set says hide')
  assert.equal(remindersOn(lib, { set_name: 'Core', reminders: 1 }), true, 'the card says show')
  assert.equal(remindersOn(lib, { reminders: 0 }), false)
  const sig = librarySignature(rows)
  assert.notEqual(librarySignature({ ...rows, variables: [{ key: 'HAND_SIZE', value: '8' }] }), sig)
  assert.notEqual(librarySignature({ ...rows, symbols: [{ ...rows.symbols[0], width: 32 }] }), sig, 'the image shape')
  assert.equal(librarySignature({ symbols: [], keywords: [], variables: [], settings: { reminders: { show: true, sets: {} } } }), '', 'an empty library changes nothing')
})

test('icon repeat: count, positions, squeezing and direction', () => {
  assert.equal(repeatCount('3'), 3)
  assert.equal(repeatCount(''), 0)
  assert.equal(repeatCount('200'), 50)
  assert.equal(repeatCount('X'), null)
  assert.deepEqual(repeatPositions(3, 100, 10, 2), [0, 12, 24])
  assert.deepEqual(repeatPositions(3, 100, 10, 2, true), [90, 78, 66], 'right to left')
  assert.deepEqual(repeatPositions(5, 30, 10, 2), [0, 5, 10, 15, 20], 'squeezed to fit')
  assert.deepEqual(repeatPositions(0, 30, 10, 2), [])
})
