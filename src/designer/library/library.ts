// The project library as the renderer uses it (electron/library.js holds the rows): symbols by
// shortcode with their image's aspect ratio, compiled keywords, variables, and whether reminder
// text is shown. Every CardRender gets it through LibraryContext; its signature is a fit input.

import { hashOf } from '../fit/hash.ts'
import { compileKeywords } from './keywords.ts'
import type { CompiledKeyword, KeywordRow } from './keywords.ts'

export interface SymbolRow {
  id?: number
  shortcode: string
  rel_path: string
  scale?: number
  baseline_offset?: number
  width?: number | null
  height?: number | null
}

export interface VariableRow {
  id?: number
  key: string
  value: string
  description?: string
}

export interface LibrarySettings {
  reminders: { show: boolean; sets: Record<string, boolean> }
}

export interface LibraryRows {
  symbols: SymbolRow[]
  keywords: KeywordRow[]
  variables: VariableRow[]
  settings?: LibrarySettings
}

export interface RenderSymbol {
  code: string
  relPath: string
  aspect: number // width / height
  scale: number // height in em
  offset: number // vertical-align in em (negative: below the baseline)
}

export interface RenderLibrary {
  symbols: Map<string, RenderSymbol>
  keywords: CompiledKeyword[]
  variables: Record<string, string>
  reminders: LibrarySettings['reminders']
  signature: string // changes when anything that affects how text lays out changes
}

const DEFAULT_REMINDERS = { show: true, sets: {} as Record<string, boolean> }

export const EMPTY_LIBRARY: RenderLibrary = {
  symbols: new Map(), keywords: [], variables: {}, reminders: DEFAULT_REMINDERS, signature: '',
}

export function librarySignature(rows: LibraryRows | null | undefined): string {
  if (!rows) return ''
  const empty = !rows.symbols.length && !rows.keywords.length && !rows.variables.length
  if (empty && rows.settings?.reminders?.show !== false && !Object.keys(rows.settings?.reminders?.sets || {}).length) return ''
  return hashOf([
    rows.symbols.map((s) => [s.shortcode, s.rel_path, s.scale ?? 1, s.baseline_offset ?? -0.12, s.width ?? null, s.height ?? null]),
    rows.keywords.map((k) => [k.name, k.params, k.reminder_template]),
    rows.variables.map((v) => [v.key, v.value]),
    rows.settings?.reminders ?? DEFAULT_REMINDERS,
  ])
}

export function compileLibrary(rows: LibraryRows | null | undefined): RenderLibrary {
  if (!rows) return EMPTY_LIBRARY
  const symbols = new Map<string, RenderSymbol>()
  for (const s of rows.symbols || []) {
    const aspect = s.width && s.height ? s.width / s.height : 1
    symbols.set(s.shortcode, { code: s.shortcode, relPath: s.rel_path, aspect: Math.min(8, Math.max(0.125, aspect)), scale: s.scale ?? 1, offset: s.baseline_offset ?? -0.12 })
  }
  const variables: Record<string, string> = Object.create(null)
  for (const v of rows.variables || []) variables[v.key] = v.value
  return {
    symbols,
    keywords: compileKeywords(rows.keywords || []),
    variables,
    reminders: rows.settings?.reminders ?? DEFAULT_REMINDERS,
    signature: librarySignature(rows),
  }
}

/** Reminder text for a card: its own choice, else its set's, else the project's. */
export function remindersOn(lib: RenderLibrary, card: Record<string, unknown> | null | undefined): boolean {
  const own = card?.reminders
  if (own === 1 || own === true) return true
  if (own === 0 || own === false) return false
  const set = String(card?.set_name ?? '')
  if (set && Object.prototype.hasOwnProperty.call(lib.reminders.sets, set)) return lib.reminders.sets[set]
  return lib.reminders.show
}
