// Fit results for people: a card's summary (its hardest text layer first), the order that finds
// the hardest cards (worst case, sorting), the Fit filter, and the wording that the column, the
// budget lines, the preview and the Designer share.

import type { FitResult } from '../render/fitText.ts'

export interface FitItem {
  layerId: string
  label: string
  result: FitResult
}

export interface FitSummary {
  status: FitResult['status'] | 'empty' // empty: the card has no text to fit
  worst: FitItem | null
  items: FitItem[] // hardest first
}

export type FitFilter = '' | 'overflow' | 'shrunk' | 'below' | 'hidden' | 'unchecked'

/**
 * How hard a result is, compared key by key (bigger is harder): overflowing by most, then hidden,
 * then shrunk furthest below its set size, then the fullest.
 */
export function hardness(r: FitResult): [number, number, number] {
  switch (r.status) {
    case 'overflow': return [4, r.overflowMm ?? 0, r.fill]
    case 'hidden': return [3, r.fill, 0]
    case 'shrunk': return [2, r.basePt > 0 ? 1 - r.pt / r.basePt : 0, r.fill]
    default: return [1, r.fill, 0]
  }
}

/** Positive when a is harder than b. */
export function compareHardness(a: FitResult, b: FitResult): number {
  const x = hardness(a)
  const y = hardness(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

export function summarize(results: Record<string, FitResult> | null | undefined, labelOf: (layerId: string) => string): FitSummary {
  const items = Object.entries(results || {})
    .map(([layerId, result]) => ({ layerId, label: labelOf(layerId), result }))
    .sort((a, b) => compareHardness(b.result, a.result) || a.layerId.localeCompare(b.layerId))
  return { status: items.length ? items[0].result.status : 'empty', worst: items[0] || null, items }
}

/** The Fit filter. summary is null for a card that hasn't been checked yet. */
export function matchesFitFilter(summary: FitSummary | null | undefined, filter: FitFilter, belowPt = 7): boolean {
  if (!filter) return true
  if (filter === 'unchecked') return !summary
  if (!summary) return false
  return summary.items.some(({ result: r }) => {
    switch (filter) {
      case 'overflow': return r.status === 'overflow'
      case 'shrunk': return r.status === 'shrunk'
      case 'hidden': return r.status === 'hidden'
      case 'below': return r.status !== 'hidden' && r.pt < r.basePt && r.pt < belowPt
      default: return true
    }
  })
}

const pt = (n: number) => `${Number(n.toFixed(2))} pt`
const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`

/** "fits at 8.5 pt · about 2 lines to spare", "shrunk to 7.25 pt (min 6.5 pt)", "overflows by 1 line at 6.5 pt", … */
export function describeFit(r: FitResult): string {
  switch (r.status) {
    case 'fits':
      return r.spareLines ? `fits at ${pt(r.pt)} · about ${lines(r.spareLines)} to spare` : `fits at ${pt(r.pt)}`
    case 'shrunk':
      if (r.pt >= r.basePt) return `fits at ${pt(r.pt)} with tighter line spacing`
      return r.pt > r.minPt ? `shrunk to ${pt(r.pt)} (min ${pt(r.minPt)})` : `shrunk to ${pt(r.pt)}, its minimum`
    case 'hidden':
      return 'hidden (no room)'
    case 'overflow':
      return r.wide ? `too wide by ${Number((r.overflowMm ?? 0).toFixed(1))} mm at ${pt(r.pt)}` : `overflows by ${lines(r.overflowLines ?? 1)} at ${pt(r.pt)}`
    default:
      return ''
  }
}

/** Short form for the Fit column: "Effect 7.25 pt", "Effect +1 line", "Flavor hidden". */
export function shortFit(item: FitItem): string {
  const r = item.result
  switch (r.status) {
    case 'overflow': return r.wide ? `${item.label} too wide` : `${item.label} +${lines(r.overflowLines ?? 1)}`
    case 'hidden': return `${item.label} hidden`
    case 'shrunk': return r.pt < r.basePt ? `${item.label} ${pt(r.pt)}` : `${item.label} tighter`
    default: return 'Fits'
  }
}
