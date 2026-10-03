// Text fitting (spec, "The fit engine"). Every text layer has a policy: a starting size, a minimum
// size and strategies, applied in the spec's order: shrink to the minimum, tighten the line
// height, hide, then flag overflow. The caller measures the real DOM layout (exact with real
// fonts); this file is the algorithm, so it can be tested with a fake layout.
//
//   fitText   one layer with a size of its own (a frame, or a fixed height inside a stack)
//   fitStack  the text layers that size to their content inside a stack, fitted together
//             against the stack: they give way by priority, the highest number first

import type { FitStrategy } from '../schema/types.ts'

export type FitStatus = 'fits' | 'shrunk' | 'overflow' | 'hidden'

export interface FitResult {
  status: FitStatus
  pt: number // size used
  lineHeight: number // line height used
  basePt: number // starting size
  minPt: number // smallest size it may shrink to (the starting size when it may not shrink)
  fill: number // space needed at the starting size / space available (above 1: doesn't fit as set)
  overflowMm?: number // overflow: how far the text sticks out at the size used
  overflowLines?: number // ...in lines of that size, when it sticks out at the bottom
  wide?: boolean // the overflow is sideways (a single line that is too long)
  spareLines?: number // fits: whole lines of room left
  stackFill?: number // inside a stack: the whole stack's fill at the starting sizes
}

export interface FitPolicy {
  basePt: number
  baseLineHeight: number
  minPt: number
  strategy: FitStrategy[]
}

// Pixels along each axis: what the text needs and what it has.
export interface TextMeasure {
  needH: number
  roomH: number
  needW: number
  roomW: number
}

export const DEFAULT_MIN_PT = 6
export const STEP_PT = 0.25
export const LEADING_STEP = 0.05
export const TIGHTEST_LINE_HEIGHT = 1.0
const TOLERANCE_PX = 0.5

export const ptToPx = (pt: number, pxPerMm: number) => (pt / 72) * 25.4 * pxPerMm
const linePx = (pt: number, lh: number, pxPerMm: number) => ptToPx(pt, pxPerMm) * lh
const round2 = (n: number) => Math.round(n * 100) / 100
const effectiveMin = (p: FitPolicy) => Math.min(p.minPt, p.basePt)
const stepsOf = (p: FitPolicy) => Math.max(0, Math.floor((p.basePt - effectiveMin(p)) / STEP_PT + 1e-9))
const floorOf = (p: FitPolicy) => (p.strategy.includes('shrink') ? Math.max(effectiveMin(p), p.basePt - stepsOf(p) * STEP_PT) : p.basePt)

const overflows = (m: TextMeasure) => m.needH > m.roomH + TOLERANCE_PX || m.needW > m.roomW + TOLERANCE_PX

function fillOf(m: TextMeasure, wrap: boolean): number {
  const h = m.roomH > 0 ? m.needH / m.roomH : Infinity
  const w = m.roomW > 0 ? m.needW / m.roomW : Infinity
  // Wrapped text always spans the full width, so only a sideways overflow counts for it.
  if (wrap) return m.needW > m.roomW + TOLERANCE_PX ? Math.max(h, w) : h
  return Math.max(w, m.needH > m.roomH + TOLERANCE_PX ? h : 0)
}

function overflowOf(m: TextMeasure, pt: number, lh: number, pxPerMm: number) {
  const down = m.needH - m.roomH
  if (down > TOLERANCE_PX) {
    return { overflowMm: round2(down / pxPerMm), overflowLines: Math.max(1, Math.ceil((down - TOLERANCE_PX) / linePx(pt, lh, pxPerMm))) }
  }
  return { overflowMm: round2(Math.max(0, m.needW - m.roomW) / pxPerMm), wide: true }
}

/**
 * One text layer in a box of its own. measure(pt, lineHeight) lays the text out at that size and
 * returns what it needs against what it has, in px at pxPerMm.
 */
export function fitText(
  policy: FitPolicy,
  measure: (pt: number, lineHeight: number) => TextMeasure,
  pxPerMm: number,
  wrap = true,
): FitResult {
  const { basePt, baseLineHeight: baseLh, strategy } = policy
  const minPt = effectiveMin(policy)
  const base = measure(basePt, baseLh)
  const common = { basePt, minPt: floorOf(policy), fill: round2(fillOf(base, wrap)) }
  if (!overflows(base)) {
    const spare = wrap ? Math.floor((base.roomH - base.needH + TOLERANCE_PX) / linePx(basePt, baseLh, pxPerMm)) : undefined
    return { status: 'fits', pt: basePt, lineHeight: baseLh, ...common, ...(spare !== undefined ? { spareLines: Math.max(0, spare) } : {}) }
  }
  let pt = basePt
  let lh = baseLh
  let fitted = false
  if (strategy.includes('shrink') && minPt < basePt) {
    // Largest grid size (basePt - k*STEP) >= minPt that fits; fitting is monotonic in size.
    const steps = stepsOf(policy)
    let lo = 1
    let hi = steps
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (overflows(measure(basePt - mid * STEP_PT, lh))) lo = mid + 1
      else { best = mid; hi = mid - 1 }
    }
    if (best >= 0) { pt = basePt - best * STEP_PT; fitted = true }
    else pt = Math.max(minPt, basePt - steps * STEP_PT)
  }
  if (!fitted && strategy.includes('tightenLeading') && lh > TIGHTEST_LINE_HEIGHT) {
    for (let next = round2(lh - LEADING_STEP); next >= TIGHTEST_LINE_HEIGHT - 1e-9; next = round2(next - LEADING_STEP)) {
      if (!overflows(measure(pt, next))) { lh = next; fitted = true; break }
    }
    if (!fitted) lh = TIGHTEST_LINE_HEIGHT
  }
  if (fitted) return { status: pt < basePt || lh < baseLh ? 'shrunk' : 'fits', pt, lineHeight: lh, ...common }
  if (strategy.includes('hide')) return { status: 'hidden', pt, lineHeight: lh, ...common }
  return { status: 'overflow', pt, lineHeight: lh, ...common, ...overflowOf(measure(pt, lh), pt, lh, pxPerMm) }
}

// ------------------------------------------------------------------------- stacks

export interface StackItem extends FitPolicy {
  id: string
  priority: number // higher numbers give way first
}

export interface StackState {
  pt: number
  lineHeight: number
  hidden: boolean
}

// Pixels along the stack's main axis: the room it has, how far its content reaches, and where
// each (visible) item sits.
export interface StackMeasure {
  room: number
  need: number
  items: Record<string, { pos: number; size: number }>
}

export type StackFitOrder = 'shrinkFirst' | 'hideFirst'

/**
 * The text layers inside a stack that size to their content, in stack order. measure(state)
 * lays them out with those sizes (hidden ones removed) and measures the stack.
 *
 * Order (spec): shrink to the minimum, tighten the line height, hide, then flag overflow.
 * Layers give way by priority, the highest number first; equal priorities shrink together.
 * After each layer is hidden, the rest start again from full size. 'hideFirst' hides before
 * shrinking (the spec's open question; its default is shrink first).
 */
export function fitStack(
  items: StackItem[],
  measure: (state: Record<string, StackState>) => StackMeasure,
  pxPerMm: number,
  order: StackFitOrder = 'shrinkFirst',
): Record<string, FitResult> {
  const state: Record<string, StackState> = {}
  for (const it of items) state[it.id] = { pt: it.basePt, lineHeight: it.baseLineHeight, hidden: false }
  const fits = () => {
    const m = measure(state)
    return m.need <= m.room + TOLERANCE_PX
  }
  const base = measure(state)
  const priorities = [...new Set(items.map((i) => i.priority))].sort((a, b) => b - a)
  const groups = priorities.map((p) => items.filter((i) => i.priority === p))

  const shrink = (): boolean => {
    for (const group of groups) {
      const members = group.filter((i) => !state[i.id].hidden && i.strategy.includes('shrink') && stepsOf(i) > 0)
      if (!members.length) continue
      const apply = (k: number) => { for (const i of members) state[i.id].pt = i.basePt - Math.min(k, stepsOf(i)) * STEP_PT }
      const maxSteps = Math.max(...members.map(stepsOf))
      let lo = 1
      let hi = maxSteps
      let best = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        apply(mid)
        if (fits()) { best = mid; hi = mid - 1 } else lo = mid + 1
      }
      if (best >= 0) { apply(best); return true }
      apply(maxSteps)
    }
    return false
  }

  const tighten = (): boolean => {
    for (const group of groups) {
      const members = group.filter((i) => !state[i.id].hidden && i.strategy.includes('tightenLeading'))
      for (;;) {
        let moved = false
        for (const i of members) {
          const s = state[i.id]
          if (s.lineHeight > TIGHTEST_LINE_HEIGHT + 1e-9) { s.lineHeight = Math.max(TIGHTEST_LINE_HEIGHT, round2(s.lineHeight - LEADING_STEP)); moved = true }
        }
        if (!moved) break
        if (fits()) return true
      }
    }
    return false
  }

  const squeeze = () => fits() || shrink() || tighten()
  // Hide the highest priority number first; among equals, the one lower in the stack.
  const hideOrder = items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => it.strategy.includes('hide'))
    .sort((a, b) => b.it.priority - a.it.priority || b.index - a.index)
    .map(({ it }) => it)

  let ok: boolean
  if (order === 'hideFirst') {
    ok = fits()
    for (const it of hideOrder) {
      if (ok) break
      state[it.id].hidden = true
      ok = fits()
    }
    if (!ok) ok = shrink() || tighten()
  } else {
    ok = squeeze()
    for (const it of hideOrder) {
      if (ok) break
      state[it.id].hidden = true
      for (const other of items) {
        if (!state[other.id].hidden) { state[other.id].pt = other.basePt; state[other.id].lineHeight = other.baseLineHeight }
      }
      ok = squeeze()
    }
  }

  const final = measure(state)
  const stackFill = round2(base.room > 0 ? base.need / base.room : Infinity)
  const spare = Math.max(0, final.room - final.need)
  const out: Record<string, FitResult> = {}
  let anyClipped = false
  for (const it of items) {
    const s = state[it.id]
    const atBase = base.items[it.id]
    const common = {
      pt: s.pt, lineHeight: s.lineHeight, basePt: it.basePt, minPt: floorOf(it),
      fill: round2(base.room > 0 && atBase ? atBase.size / base.room : 0), stackFill,
    }
    if (s.hidden) { out[it.id] = { status: 'hidden', ...common }; continue }
    const at = final.items[it.id]
    const cut = at ? Math.min(at.size, at.pos + at.size - final.room) : 0
    if (cut > TOLERANCE_PX) {
      anyClipped = true
      out[it.id] = {
        status: 'overflow', ...common, overflowMm: round2(cut / pxPerMm),
        overflowLines: Math.max(1, Math.ceil((cut - TOLERANCE_PX) / linePx(s.pt, s.lineHeight, pxPerMm))),
      }
    } else if (s.pt < it.basePt || s.lineHeight < it.baseLineHeight) {
      out[it.id] = { status: 'shrunk', ...common }
    } else {
      out[it.id] = { status: 'fits', ...common, spareLines: Math.floor((spare + TOLERANCE_PX) / linePx(s.pt, s.lineHeight, pxPerMm)) }
    }
  }
  // Something other than text was pushed out (an image or shape below the text): the last
  // visible text layer is what pushed it.
  if (!ok && !anyClipped) {
    const last = [...items].reverse().find((i) => !state[i.id].hidden)
    if (last) {
      const s = state[last.id]
      const over = final.need - final.room
      out[last.id] = {
        ...out[last.id], status: 'overflow', overflowMm: round2(over / pxPerMm),
        overflowLines: Math.max(1, Math.ceil((over - TOLERANCE_PX) / linePx(s.pt, s.lineHeight, pxPerMm))),
      }
      delete out[last.id].spareLines
    }
  }
  return out
}
