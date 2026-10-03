// Keywords (spec: "define Burn X once, with reminder text that uses the parameter and
// conditionals"). A keyword is found in card text by its name followed by its parameters
// ("Burn 3"), as whole words and regardless of case. The first time it appears in a text layer,
// its reminder text goes in after it (after its punctuation and closing bold/italic), in italic
// parentheses. The reminder is written in the template language with the parameters in scope:
//   (Deal {{X}} damage{{if(X > 1, " split as you choose", "")}}.)

import { interpolate } from '../expr/expr.ts'
import type { Scope } from '../expr/expr.ts'

export interface KeywordParam {
  name: string
  kind: 'number' | 'word'
}

export interface KeywordRow {
  id?: number
  name: string
  params: KeywordParam[]
  reminder_template: string
  rule_ref?: number | null
}

export interface CompiledKeyword {
  name: string
  params: KeywordParam[]
  template: string
  re: RegExp
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PARAM_RE: Record<KeywordParam['kind'], string> = {
  number: '(\\d+|[A-Z])', // a number, or a letter standing for one ("Burn X")
  word: '([\\p{L}\\p{N}\'-]+|\\{[^{}\\s]+\\})',
}

// Not part of a longer word, and not inside a {shortcode}.
const BEFORE = '(?<![\\p{L}\\p{N}_{])'
const AFTER = '(?![\\p{L}\\p{N}_}])'

export function compileKeyword(k: KeywordRow): CompiledKeyword {
  const name = k.name.trim().split(/\s+/).map(escapeRe).join('\\s+')
  const params = (k.params || []).map((p) => `\\s+${PARAM_RE[p.kind] || PARAM_RE.number}`).join('')
  return { name: k.name.trim(), params: k.params || [], template: k.reminder_template || '', re: new RegExp(`${BEFORE}${name}${params}${AFTER}`, 'iu') }
}

/** Longest names first, so "Burn Bright" is found before "Burn". */
export const compileKeywords = (rows: KeywordRow[]) => rows.map(compileKeyword).sort((a, b) => b.name.length - a.name.length)

const paramValue = (raw: string, kind: KeywordParam['kind']) => (kind === 'number' && /^\d+$/.test(raw) ? Number(raw) : raw)

// Escape what the light markup would read: the reminder is plain text inside *( … )*.
const escapeMarkup = (s: string) => s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*')

/**
 * Insert reminder text after the first occurrence of each keyword. markup: the layer reads
 * **bold** / *italic* (Rich Text): the reminder is italic; otherwise it is plain.
 */
export function applyKeywords(text: string, keywords: CompiledKeyword[], scope: Scope, { markup = true } = {}): { text: string; errors: string[]; found: string[] } {
  const errors: string[] = []
  const found: string[] = []
  const inserts: Array<{ at: number; text: string }> = []
  const taken: Array<[number, number]> = []
  for (const k of keywords) {
    const m = k.re.exec(text)
    if (!m) continue
    const start = m.index
    const end = start + m[0].length
    if (taken.some(([a, b]) => start < b && end > a)) continue // inside a longer keyword already found
    taken.push([start, end])
    found.push(k.name)
    if (!k.template.trim()) continue
    const local: Scope = Object.create(null)
    for (const key of Object.keys(scope)) local[key] = scope[key]
    k.params.forEach((p, i) => { local[p.name] = paramValue(m[i + 1] ?? '', p.kind) })
    const r = interpolate(k.template, local)
    for (const e of r.errors) errors.push(`keyword ${k.name}: ${e}`)
    const reminder = r.text.trim()
    if (!reminder) continue
    // After the keyword: its punctuation and the bold / italic it closes ("**Burn 2.**").
    let at = end
    while (at < text.length) {
      if (text.startsWith('**', at)) at += 2
      else if (text[at] === '*' || /[.,;:!?]/.test(text[at])) at += 1
      else break
    }
    const body = reminder.startsWith('(') ? reminder : `(${reminder})`
    inserts.push({ at, text: markup ? ` *${escapeMarkup(body)}*` : ` ${body}` })
  }
  let out = text
  for (const ins of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at)
  return { text: out, errors, found }
}

/** Does a text use the keyword (for "where used")? */
export const usesKeyword = (text: string, k: CompiledKeyword) => k.re.test(text)
