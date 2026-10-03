// Cell-level access to card fields for the Cards grid. Built-in columns are card columns; custom
// fields are addressed as "custom:<name>" and live in card.custom_fields (an object in the UI).
// Every cell edits as text; tags edit as "a, b".

export const BUILTIN_COLUMNS = [
  { key: 'name', label: 'Name', width: 190 },
  { key: 'type', label: 'Type', width: 120 },
  { key: 'set_name', label: 'Set', width: 110 },
  { key: 'rarity', label: 'Rarity', width: 100 },
  { key: 'cost', label: 'Cost', width: 64 },
  { key: 'power', label: 'Power', width: 64 },
  { key: 'toughness', label: 'Tough.', width: 64 },
  { key: 'rules_text', label: 'Rules text', width: 300, multiline: true },
  { key: 'flavor_text', label: 'Flavor text', width: 220, multiline: true },
  { key: 'tags', label: 'Tags', width: 150 },
  { key: 'notes', label: 'Notes', width: 180, multiline: true },
]

export const DEFAULT_VISIBLE = ['name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'tags']

const BUILTIN_KEYS = new Set(BUILTIN_COLUMNS.map((c) => c.key))
const CUSTOM = 'custom:'

export const isCustomKey = (key) => key.startsWith(CUSTOM)
export const customKey = (name) => `${CUSTOM}${name}`
export const customName = (key) => key.slice(CUSTOM.length)

// Custom field names: the project's card schema first (in its order), then keys found on cards.
// Schema fields that are really built-in columns (name, cost, rarity, ...) are skipped.
export function customFieldNames(cards, cardSchema) {
  const names = []
  const add = (n) => {
    const name = String(n || '').trim()
    if (name && !BUILTIN_KEYS.has(name) && name !== 'set' && !names.includes(name)) names.push(name)
  }
  const schemaFields = Array.isArray(cardSchema?.fields) ? cardSchema.fields : Array.isArray(cardSchema) ? cardSchema : []
  for (const f of schemaFields) add(f && f.name)
  for (const c of cards) for (const k of Object.keys(c.custom_fields || {})) add(k)
  return names
}

export function columnsFor(customNames) {
  return [
    ...BUILTIN_COLUMNS,
    ...customNames.map((n) => ({ key: customKey(n), label: n, width: 130, custom: true })),
  ]
}

function text(v) {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function getFieldValue(card, key) {
  if (!card) return ''
  if (isCustomKey(key)) return text((card.custom_fields || {})[customName(key)])
  return text(card[key])
}

// The stored value: Yes/No custom fields are booleans, everything else text. Used for history so
// an undo restores the same kind of value.
export function getFieldRaw(card, key) {
  if (!card) return ''
  if (isCustomKey(key)) {
    const v = (card.custom_fields || {})[customName(key)]
    return typeof v === 'boolean' ? v : text(v)
  }
  return text(card[key])
}

export const sameValue = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? a === b : String(a ?? '') === String(b ?? ''))

// The grid/form key for a model field key: standard columns by name, others under "custom:".
const COLUMN_KEYS = new Set(['name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'flavor_text', 'tags', 'notes', 'image_path', 'card_type_id'])
export const cellKey = (fieldKey) => (COLUMN_KEYS.has(fieldKey) ? fieldKey : customKey(fieldKey))

const splitTags = (v) => String(v).split(',').map((t) => t.trim()).filter(Boolean)

/**
 * The card with one field set, plus the patch to send to updateCard.
 * Clearing a custom field removes the key.
 */
export function withField(card, key, value) {
  const v = String(value ?? '')
  if (isCustomKey(key)) {
    const fields = { ...(card.custom_fields || {}) }
    const name = customName(key)
    if (typeof value === 'boolean') fields[name] = value
    else if (v === '') delete fields[name]
    else fields[name] = v
    return { card: { ...card, custom_fields: fields }, patch: { custom_fields: fields } }
  }
  if (key === 'tags') {
    const tags = splitTags(v)
    return { card: { ...card, tags }, patch: { tags } }
  }
  if (key === 'name' && !v.trim()) throw new Error('a card needs a name')
  if (key === 'card_type_id') {
    const id = Number(v)
    return { card: { ...card, card_type_id: id }, patch: { card_type_id: id } }
  }
  return { card: { ...card, [key]: v }, patch: { [key]: v } }
}

// The card as the preview should show it while a cell is being typed in.
export function applyLive(card, live) {
  if (!card || !live || live.cardId !== card.id) return card
  try {
    return withField(card, live.key, live.value).card
  } catch {
    return { ...card, [live.key]: live.value }
  }
}

// ----- cell undo/redo: each step is a list of { cardId, key, before, after } -----
// One typed cell is a step of one change; a paste, fill-down or bulk edit is one step of many.

export const CELL_HISTORY_LIMIT = 200

export function createCellHistory() {
  return { past: [], future: [] }
}

export function recordCellEdit(history, changes) {
  const step = Array.isArray(changes) ? changes : [changes]
  const past = [...history.past, step]
  if (past.length > CELL_HISTORY_LIMIT) past.splice(0, past.length - CELL_HISTORY_LIMIT)
  return { past, future: [] }
}

// { history, step, writes: [{ cardId, key, value }] } to apply, or null.
export function undoCell(history) {
  if (!history.past.length) return null
  const step = history.past[history.past.length - 1]
  return { step, writes: step.map((c) => ({ cardId: c.cardId, key: c.key, value: c.before })), history: { past: history.past.slice(0, -1), future: [step, ...history.future] } }
}

export function redoCell(history) {
  if (!history.future.length) return null
  const [step, ...future] = history.future
  return { step, writes: step.map((c) => ({ cardId: c.cardId, key: c.key, value: c.after })), history: { past: [...history.past, step], future } }
}
