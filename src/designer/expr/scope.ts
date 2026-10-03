// Builds the read-only scope an expression sees for one card: the card's columns plus the
// top-level keys of custom_fields (built-in columns win on a name clash). Null-prototype, so
// names like "constructor" or "__proto__" are just missing fields.

import type { Scope, Value } from './expr.ts'

export const CARD_COLUMNS = [
  'id', 'name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness',
  'rules_text', 'flavor_text', 'tags', 'image_path', 'notes', 'card_type',
] as const

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function scalar(v: unknown): Value | undefined {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((x) => String(x)).join(',') // tags in UI form
  return undefined // nested objects are not exposed
}

function parseCustom(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const p = JSON.parse(raw)
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
  } catch {
    return {}
  }
}

export function cardScope(card: Record<string, unknown> | null | undefined): Scope {
  const scope: Scope = Object.create(null)
  if (!card) return scope
  const custom = parseCustom(card.custom_fields)
  for (const key of Object.keys(custom)) {
    if (!IDENT.test(key)) continue
    const v = scalar(custom[key])
    if (v !== undefined) scope[key] = v
  }
  for (const col of CARD_COLUMNS) {
    const v = scalar(card[col])
    if (v !== undefined && v !== null) scope[col] = v
    else if (!(col in scope)) scope[col] = null
  }
  return scope
}

// Field names a binding picker can offer for a set of cards.
export function bindableFields(cards: Array<Record<string, unknown>>): string[] {
  const custom = new Set<string>()
  for (const c of cards) {
    const fields = parseCustom(c.custom_fields)
    for (const k of Object.keys(fields)) if (IDENT.test(k) && scalar(fields[k]) !== undefined) custom.add(k)
  }
  return [...CARD_COLUMNS, ...[...custom].filter((k) => !(CARD_COLUMNS as readonly string[]).includes(k)).sort()]
}
