// Renaming a field key everywhere it is bound: every string property of every layer
// ("{{atk}}" in text, sources and colours; bare expressions in visibleIf and count) and template
// exception conditions. Token-aware (src/designer/expr/expr.ts renameIdentifier), so literal text,
// string literals and function names are never touched.

import { renameIdentifier, renameInTemplateText } from '../expr/expr.ts'
import type { Template } from '../schema/types.ts'

const BARE_EXPRESSION_PROPS = new Set(['visibleIf', 'count'])
const STRUCTURAL_PROPS = new Set(['id', 'type', 'children'])

function renameValue(value: unknown, prop: string, from: string, to: string): unknown {
  if (typeof value === 'string') {
    if (BARE_EXPRESSION_PROPS.has(prop)) return renameIdentifier(value, from, to)
    return value.includes('{{') ? renameInTemplateText(value, from, to) : value
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const r = renameValue(v, prop, from, to)
      if (r !== v) changed = true
      return r
    })
    return changed ? out : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const r = STRUCTURAL_PROPS.has(k) && k !== 'children' ? v : renameValue(v, k, from, to)
      if (r !== v) changed = true
      out[k] = r
    }
    return changed ? out : value
  }
  return value
}

/** The template with `from` renamed to `to` in every binding, or the same object if unused. */
export function renameFieldInTemplate(t: Template, from: string, to: string): Template {
  const layers = renameValue(t.layers, 'layers', from, to) as Template['layers']
  return layers === t.layers ? t : { ...t, layers }
}

export function renameFieldInCondition(src: string, from: string, to: string): string {
  return renameIdentifier(src, from, to)
}

/** Does the template bind `key` anywhere? (for "used in" lists) */
export function templateUsesField(t: Template, key: string): boolean {
  return renameFieldInTemplate(t, key, `${key}__probe`) !== t
}
