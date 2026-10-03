// "Where used" for the library (spec: "Renaming a keyword lists every card and rule that uses
// it"): which cards, templates, exceptions and Game Docs documents use a symbol, keyword or
// variable, and the rewrites that rename it everywhere. Pure; the screens show the result and
// the store applies it in one transaction (renameLibraryItem).

import { cellKey, getFieldValue, withField } from '../Cards/grid/cardFields.js'
import { compileKeyword } from '../../designer/library/keywords.ts'
import { renameFieldInCondition, renameFieldInTemplate } from '../../designer/model/renameField.ts'

const TEXT_COLUMNS = ['name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'flavor_text', 'notes']

/** Every text value a card holds: [{ key (cell key), text }]. */
export function cardTexts(card) {
  const out = []
  for (const k of TEXT_COLUMNS) {
    const text = getFieldValue(card, k)
    if (text) out.push({ key: k, text })
  }
  for (const [k, v] of Object.entries(card.custom_fields || {})) {
    if (typeof v === 'string' && v) out.push({ key: cellKey(k), text: v })
  }
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── matchers ──
export const symbolMatcher = (code) => new RegExp(`(?<!\\\\)\\{${escapeRe(code)}\\}`, 'g')
export const variableMatcher = (key) => new RegExp(`\\{\\{\\s*${escapeRe(key)}\\s*\\}\\}`, 'g')
// A keyword's name as whole words, any case (parameters don't matter for a rename).
export const keywordNameMatcher = (name) => {
  const k = compileKeyword({ name, params: [], reminder_template: '' })
  return new RegExp(k.re.source, 'giu')
}

/** Cards whose text matches: [{ card, fields: [{ key, text }] }] */
export function cardUses(cards, re) {
  const out = []
  for (const card of cards) {
    const fields = cardTexts(card).filter((f) => { re.lastIndex = 0; return re.test(f.text) })
    if (fields.length) out.push({ card, fields })
  }
  re.lastIndex = 0
  return out
}

/** Game Docs documents whose text mentions it (HTML tags removed). */
export function docUses(documents, re) {
  const out = []
  for (const d of documents) {
    if (d.type === 'folder') continue
    const text = `${d.title || ''}\n${String(d.content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')}`
    re.lastIndex = 0
    if (re.test(text)) out.push(d)
  }
  re.lastIndex = 0
  return out
}

// The same case as the word it replaces: "burn" -> "scorch", "BURN" -> "SCORCH", "Burn" -> "Scorch".
export function keepCase(found, replacement) {
  if (found === found.toLowerCase()) return replacement.toLowerCase()
  if (found === found.toUpperCase() && /[A-Z]/.test(found)) return replacement.toUpperCase()
  if (found[0] === found[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

/** Card patches that apply `replace` to every matching text: [{ id, patch }] */
export function cardRewrites(uses, re, replace) {
  return uses.map(({ card, fields }) => {
    let next = card
    let patch = {}
    for (const f of fields) {
      re.lastIndex = 0
      const r = withField(next, f.key, f.text.replace(re, replace))
      next = r.card
      patch = { ...patch, ...r.patch }
    }
    return { id: card.id, patch }
  })
}

// ── per kind ──
export function keywordWhereUsed({ cards, documents }, name) {
  const re = keywordNameMatcher(name)
  return { cards: cardUses(cards, re), docs: docUses(documents, re), templates: [], rules: [] }
}

export function keywordRename(uses, from, to) {
  const re = keywordNameMatcher(from)
  return { cards: cardRewrites(uses.cards, re, (m) => keepCase(m, to)), templates: [], rules: [] }
}

// Templates: text that writes {code} and icon repeaters that draw it.
function templateUsesSymbol(t, code) {
  const s = JSON.stringify(t.layers)
  return s.includes(`{${code}}`) || s.includes(`"icon":"${code}"`)
}

function renameSymbolInLayers(layers, from, to) {
  return layers.map((l) => {
    const next = { ...l }
    if (typeof next.text === 'string') next.text = next.text.split(`{${from}}`).join(`{${to}}`)
    if (next.type === 'iconRepeat' && typeof next.icon === 'string') next.icon = next.icon === from ? to : next.icon.split(`{${from}}`).join(`{${to}}`)
    if (Array.isArray(next.children)) next.children = renameSymbolInLayers(next.children, from, to)
    return next
  })
}

/** templates: Map id -> { row, template } (useParsedTemplates) */
export function symbolWhereUsed({ cards, documents, templates }, code) {
  const re = symbolMatcher(code)
  const tpls = [...templates.values()].filter((e) => e.template && templateUsesSymbol(e.template, code)).map((e) => e.row)
  return { cards: cardUses(cards, re), docs: docUses(documents, re), templates: tpls, rules: [] }
}

export function symbolRename(uses, templates, from, to) {
  const re = symbolMatcher(from)
  return {
    cards: cardRewrites(uses.cards, re, `{${to}}`),
    templates: uses.templates.map((row) => {
      const t = templates.get(row.id).template
      return { id: row.id, content: JSON.stringify({ ...t, layers: renameSymbolInLayers(t.layers, from, to) }, null, 2) }
    }),
    rules: [],
  }
}

/** rules: template_rules rows; templates: Map id -> { row, template } */
export function variableWhereUsed({ cards, documents, templates, rules }, key) {
  const re = variableMatcher(key)
  const tpls = [...templates.values()].filter((e) => e.template && renameFieldInTemplate(e.template, key, `${key}__probe`) !== e.template).map((e) => e.row)
  const rls = (rules || []).filter((r) => renameFieldInCondition(r.condition_expr || '', key, `${key}__probe`) !== (r.condition_expr || ''))
  return { cards: cardUses(cards, re), docs: docUses(documents, re), templates: tpls, rules: rls }
}

export function variableRename(uses, templates, from, to) {
  const re = variableMatcher(from)
  return {
    cards: cardRewrites(uses.cards, re, `{{${to}}}`),
    templates: uses.templates.map((row) => ({ id: row.id, content: JSON.stringify(renameFieldInTemplate(templates.get(row.id).template, from, to), null, 2) })),
    rules: uses.rules.map((r) => ({ id: r.id, condition_expr: renameFieldInCondition(r.condition_expr, from, to) })),
  }
}

export const usesCount = (uses) => uses.cards.length + uses.templates.length + uses.rules.length + uses.docs.length
