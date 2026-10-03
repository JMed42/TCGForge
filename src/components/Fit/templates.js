import { useMemo } from 'react'
import { useStore } from '../../store'
import { validateTemplate } from '../../designer/schema/schema.ts'
import { hashOf } from '../../designer/fit/hash.ts'
import { textLayerFields } from '../../designer/fit/bindings.ts'

// Parsed templates by row, re-parsed only when a row's version changes: { template, hash, fields }
// (hash: of the saved content, a fit-check input; fields: the card fields each text layer shows)
// or { error }.
const parsedCache = new Map()
export function parseTemplateRow(row) {
  const key = `${row.id}:${row.version}:${row.updated_at}`
  if (parsedCache.has(key)) return parsedCache.get(key)
  let out
  try {
    const r = validateTemplate(JSON.parse(row.content))
    out = r.ok ? { template: r.template, hash: hashOf(row.content), fields: textLayerFields(r.template) } : { error: r.errors.join('; ') }
  } catch (error) {
    out = { error: error.message }
  }
  parsedCache.set(key, out)
  return out
}

/** The project's templates by id: { row, template, hash, fields } or { row, error }. */
export function useParsedTemplates() {
  const rows = useStore((s) => s.templates)
  return useMemo(() => new Map(rows.map((r) => [r.id, { row: r, ...parseTemplateRow(r) }])), [rows])
}
