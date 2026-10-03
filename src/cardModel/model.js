// Pure helpers over the card model ({ fields, types, standardFields, kinds } from getCardModel).
// Field kinds: text, longText, number, choice, yesNo, image, tags. "name" is implicit: every type
// starts with it.

export const KIND_LABELS = {
  text: 'Text',
  longText: 'Long text',
  number: 'Number',
  choice: 'Choice',
  yesNo: 'Yes / No',
  image: 'Image',
  tags: 'Tags',
}

export const KIND_HELP = {
  text: 'One line of text.',
  longText: 'Several lines; **bold** and *italic* work.',
  number: 'A number. Text such as "X" is allowed but flagged.',
  choice: 'One of a list of options.',
  yesNo: 'A checkbox. Templates can test it: if(flying, "Flying", "").',
  image: 'An image file copied into the project (paste or choose).',
  tags: 'Comma-separated tags.',
}

export const NAME_FIELD = { key: 'name', label: 'Name', kind: 'text', help: '', options: [], default_value: '', builtin: true }

export const STANDARD_KEYS = new Set(['type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'flavor_text', 'tags', 'notes', 'image_path'])

export const emptyModel = () => ({ fields: [], types: [], standardFields: [], kinds: [] })

export function fieldMap(model) {
  return new Map(model.fields.map((f) => [f.key, f]))
}

export function typeById(model, id) {
  return model.types.find((t) => t.id === id) || null
}

/** The fields a type shows, in order, starting with Name. */
export function fieldsForType(model, typeId) {
  const type = typeById(model, typeId)
  const map = fieldMap(model)
  const out = [NAME_FIELD]
  for (const key of type ? type.field_keys : []) {
    const f = map.get(key)
    if (f) out.push(f)
  }
  return out
}

/** Fields in database-column order: by type order, then field order, each once. */
export function allFieldsInOrder(model) {
  const map = fieldMap(model)
  const seen = new Set()
  const out = [NAME_FIELD]
  for (const t of model.types) {
    for (const key of t.field_keys) {
      if (seen.has(key) || !map.has(key)) continue
      seen.add(key)
      out.push(map.get(key))
    }
  }
  return out
}

export function typesUsing(model, key) {
  return model.types.filter((t) => t.field_keys.includes(key))
}

/** Fields for the binding picker: name, card type, then every library field. */
export function bindingFields(model) {
  return [
    { key: 'name', label: 'Name' },
    { key: 'card_type', label: 'Card type' },
    ...model.fields.map((f) => ({ key: f.key, label: f.label })),
  ]
}

// "Action Rating" -> "action_rating" (mirrors electron/cardModel.js keyFromLabel).
export function keyFromLabel(label) {
  let s = String(label ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  if (!s) return ''
  if (/^[0-9]/.test(s)) s = `f_${s}`
  return s.slice(0, 48).replace(/_+$/, '')
}

export const isNumeric = (v) => String(v).trim() !== '' && Number.isFinite(Number(v))
