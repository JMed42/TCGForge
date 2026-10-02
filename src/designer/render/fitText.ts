// Text fitting by measurement in the real DOM (spec: "Measure in a hidden DOM container;
// binary-search font size between min and max"). Exact with real fonts, because the browser
// lays out the text itself.
//
// Strategy order (spec, "The fit engine"): shrink font to min, tighten line height, hide. The
// full per-set fit engine and fit_cache are Phase 3; this is the per-element step it builds on.

import type { FitStrategy } from '../schema/types.ts'

export type FitStatus = 'fits' | 'shrunk' | 'overflow' | 'hidden'

export interface FitResult {
  status: FitStatus
  pt: number
  lineHeight: number
}

export const DEFAULT_MIN_PT = 6
export const STEP_PT = 0.25
const TIGHTEST_LINE_HEIGHT = 1.0

// overflows(pt, lineHeight) must lay the text out at that size and report whether it overflows.
export function fitText(
  basePt: number,
  baseLineHeight: number,
  minPt: number,
  strategy: FitStrategy[],
  overflows: (pt: number, lineHeight: number) => boolean,
): FitResult {
  if (!overflows(basePt, baseLineHeight)) return { status: 'fits', pt: basePt, lineHeight: baseLineHeight }
  let pt = basePt
  let lineHeight = baseLineHeight
  let fitted = false
  if (strategy.includes('shrink') && minPt < basePt) {
    // Largest grid size (basePt - k*STEP) >= minPt that fits; fitting is monotonic in size.
    const steps = Math.floor((basePt - minPt) / STEP_PT + 1e-9)
    let lo = 1
    let hi = steps
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (overflows(basePt - mid * STEP_PT, lineHeight)) lo = mid + 1
      else { best = mid; hi = mid - 1 }
    }
    if (best >= 0) { pt = basePt - best * STEP_PT; fitted = true }
    else pt = Math.max(minPt, basePt - steps * STEP_PT)
  }
  if (!fitted && strategy.includes('tightenLeading') && lineHeight > TIGHTEST_LINE_HEIGHT) {
    for (let lh = Math.round((lineHeight - 0.05) * 100) / 100; lh >= TIGHTEST_LINE_HEIGHT - 1e-9; lh = Math.round((lh - 0.05) * 100) / 100) {
      if (!overflows(pt, lh)) { lineHeight = lh; fitted = true; break }
    }
    if (!fitted) lineHeight = TIGHTEST_LINE_HEIGHT
  }
  if (fitted) return { status: pt < basePt || lineHeight < baseLineHeight ? 'shrunk' : 'fits', pt, lineHeight }
  if (strategy.includes('hide')) return { status: 'hidden', pt, lineHeight }
  return { status: 'overflow', pt, lineHeight }
}

export const ptToPx = (pt: number, pxPerMm: number) => (pt / 72) * 25.4 * pxPerMm
