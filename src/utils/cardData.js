// DB rows store tags as "a,b" and custom_fields as JSON text. The UI works with an array
// and an object, so rows are converted once when they enter the store. The main process
// converts back on write (electron/database.js normalizeCardData).

export function parseTags(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map((t) => t.trim()).filter(Boolean)
  return [] // null, or a BLOB left behind by the old array-write bug
}

export function parseCustomFields(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) return value
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function toUiCard(row) {
  return { ...row, tags: parseTags(row.tags), custom_fields: parseCustomFields(row.custom_fields) }
}

// projects.card_schema is JSON text; Settings and the project form edit it as `cardSchema`.
export function toUiProject(row) {
  let cardSchema = null
  try {
    cardSchema = row.card_schema ? JSON.parse(row.card_schema) : null
  } catch {
    cardSchema = null
  }
  return { ...row, cardSchema }
}
