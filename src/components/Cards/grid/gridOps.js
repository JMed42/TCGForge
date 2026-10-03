// Pure helpers for the Database grid: tab-separated text as Excel and Google Sheets put it on the
// clipboard, cell ranges, paste and fill-down planning, value parsing per field kind, filters.

// ----- TSV (clipboard) -----

/** Excel/Sheets clipboard text -> rows of cells. Quoted cells may hold tabs, newlines and "". */
export function parseTsv(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n')
  const rows = []
  let row = []
  let cell = ''
  let i = 0
  let quoted = false
  let atStart = true
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (ch === '"') { quoted = false; i++; continue }
      cell += ch
      i++
      continue
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; i++; continue }
    if (ch === '\t') { row.push(cell); cell = ''; atStart = true; i++; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atStart = true; i++; continue }
    cell += ch
    atStart = false
    i++
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const needsQuotes = (s) => /[\t\n"]/.test(s)
/** Rows of cells -> clipboard text that Excel and Sheets paste back into the same shape. */
export function toTsv(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '')
    return needsQuotes(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join('\t')).join('\n')
}

// ----- ranges -----

/** Normalised rectangle of row/column indexes between two cells. */
export function rangeOf(a, b) {
  return { r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) }
}

export const inRange = (rg, row, col) => row >= rg.r0 && row <= rg.r1 && col >= rg.c0 && col <= rg.c1

// ----- values -----

const YES = new Set(['true', 'yes', 'y', '1', 'x', '\u2713', '\u2714'])
const NO = new Set(['false', 'no', 'n', '0', ''])

/** Text from a cell or clipboard -> the value to store for a column, or { skip: reason }. */
export function parseCellValue(column, text, types) {
  const s = String(text ?? '')
  if (column.kind === 'yesNo') {
    const t = s.trim().toLowerCase()
    if (YES.has(t)) return { value: true }
    if (NO.has(t)) return { value: false }
    return { skip: `"${s}" is not yes/no` }
  }
  if (column.key === 'card_type_id') {
    const t = types.find((x) => x.name.toLowerCase() === s.trim().toLowerCase() || String(x.id) === s.trim())
    return t ? { value: String(t.id) } : { skip: `no card type "${s}"` }
  }
  if (column.key === 'name' && !s.trim()) return { skip: 'a card needs a name' }
  return { value: column.kind === 'longText' ? s : s.replace(/\n+/g, ' ') }
}

/**
 * Plan a paste of `grid` (rows of text) at the top-left of `range`. A single value pasted onto a
 * larger selection fills the whole selection, as in Excel.
 * applicable(card, column) says whether a card's type uses a column.
 * @returns {{ writes: [{ cardId, key, value }], skipped: number, reasons: string[], overflowRows: number }}
 */
export function planPaste({ grid, range, rows, columns, applicable, types }) {
  const writes = []
  const reasons = new Set()
  let skipped = 0
  const single = grid.length === 1 && grid[0].length === 1
  const height = single ? range.r1 - range.r0 + 1 : grid.length
  const width = single ? range.c1 - range.c0 + 1 : Math.max(...grid.map((r) => r.length))
  let overflowRows = 0
  for (let dr = 0; dr < height; dr++) {
    const row = range.r0 + dr
    if (row >= rows.length) { overflowRows++; continue }
    const card = rows[row]
    for (let dc = 0; dc < width; dc++) {
      const col = range.c0 + dc
      const column = columns[col]
      if (!column) continue
      const text = single ? grid[0][0] : grid[dr]?.[dc]
      if (text === undefined) continue
      if (!applicable(card, column) || column.readOnly) { skipped++; reasons.add(`${column.label} isn't used by ${card.card_type || 'this type'}`); continue }
      const v = parseCellValue(column, text, types)
      if ('skip' in v) { skipped++; reasons.add(v.skip); continue }
      writes.push({ cardId: card.id, key: column.key, value: v.value })
    }
  }
  return { writes, skipped, reasons: [...reasons], overflowRows }
}

/**
 * Fill down: each column of the range takes the value of its top cell. A one-row range copies
 * from the row above it.
 */
export function planFillDown({ range, rows, columns, applicable, raw }) {
  const writes = []
  let skipped = 0
  const fromRow = range.r1 === range.r0 ? range.r0 - 1 : range.r0
  const firstTarget = range.r1 === range.r0 ? range.r0 : range.r0 + 1
  if (fromRow < 0) return { writes, skipped }
  for (let col = range.c0; col <= range.c1; col++) {
    const column = columns[col]
    if (!column || column.readOnly) continue
    const source = rows[fromRow]
    if (!applicable(source, column)) continue
    const value = raw(source, column.key)
    for (let row = firstTarget; row <= range.r1; row++) {
      const card = rows[row]
      if (!card) continue
      if (!applicable(card, column) || (column.key === 'name' && !String(value).trim())) { skipped++; continue }
      writes.push({ cardId: card.id, key: column.key, value })
    }
  }
  return { writes, skipped }
}

/** Clear a range: every applicable cell except Name (which can't be empty). */
export function planClear({ range, rows, columns, applicable }) {
  const writes = []
  for (let row = range.r0; row <= range.r1; row++) {
    const card = rows[row]
    if (!card) continue
    for (let col = range.c0; col <= range.c1; col++) {
      const column = columns[col]
      if (!column || column.readOnly || column.key === 'name' || column.key === 'card_type_id') continue
      if (!applicable(card, column)) continue
      writes.push({ cardId: card.id, key: column.key, value: column.kind === 'yesNo' ? false : '' })
    }
  }
  return { writes }
}

// ----- filters -----

/**
 * filters: { search, cardTypeId, fieldKey, fieldOp ('contains' | 'is' | 'empty' | 'notEmpty'), fieldValue }
 * text(card, key) returns a cell's text.
 */
export function filterCards(cards, filters, text, { missingIds = null } = {}) {
  const q = String(filters.search || '').trim().toLowerCase()
  const typeId = filters.cardTypeId ? Number(filters.cardTypeId) : null
  const fk = filters.fieldKey || null
  const fv = String(filters.fieldValue ?? '').toLowerCase()
  return cards.filter((c) => {
    if (missingIds && !missingIds.has(c.id)) return false
    if (typeId && c.card_type_id !== typeId) return false
    if (q) {
      const hay = [c.name, c.type, c.rules_text, c.flavor_text, c.notes, c.set_name, c.rarity, ...(c.tags || []), ...Object.values(c.custom_fields || {}).map(String)]
        .join('\n').toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (fk) {
      const v = text(c, fk).toLowerCase()
      switch (filters.fieldOp) {
        case 'is': if (v !== fv) return false; break
        case 'empty': if (v !== '' && v !== 'false') return false; break
        case 'notEmpty': if (v === '' || v === 'false') return false; break
        default: if (!v.includes(fv)) return false
      }
    }
    return true
  })
}
