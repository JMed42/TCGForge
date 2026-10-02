// Pure canvas geometry in millimetres (trim coordinates). The canvas converts pointer
// positions with its px/mm scale before calling these, so they're unit-testable.

import type { Box } from '../schema/types.ts'

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLES)[number]
export const MIN_SIZE_MM = 0.5

const r2 = (n: number) => Math.round(n * 100) / 100
export const roundBox = (b: Box): Box => ({ x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) })

export function contains(b: Box, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function bounds(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const x1 = Math.min(...boxes.map((b) => b.x))
  const y1 = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

// axisLock: keep only the larger of the two movements (Shift while dragging).
export function moveBox(start: Box, dx: number, dy: number, axisLock = false): Box {
  let mx = dx
  let my = dy
  if (axisLock) { if (Math.abs(dx) >= Math.abs(dy)) my = 0; else mx = 0 }
  return { ...start, x: start.x + mx, y: start.y + my }
}

// Resize from a handle. keepAspect: corners scale both axes; edges scale around the centre.
export function resizeBox(start: Box, handle: Handle, dx: number, dy: number, keepAspect = false, minSize = MIN_SIZE_MM): Box {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy
  if (right - left < minSize) { if (handle.includes('w')) left = right - minSize; else right = left + minSize }
  if (bottom - top < minSize) { if (handle.includes('n')) top = bottom - minSize; else bottom = top + minSize }
  if (keepAspect && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h
    let w = right - left
    let h = bottom - top
    const horizontal = handle.includes('e') || handle.includes('w')
    const vertical = handle.includes('n') || handle.includes('s')
    if (horizontal && vertical) {
      if (w / start.w >= h / start.h) h = w / aspect
      else w = h * aspect
      if (handle.includes('w')) left = right - w; else right = left + w
      if (handle.includes('n')) top = bottom - h; else bottom = top + h
    } else if (horizontal) {
      h = w / aspect
      const cy = start.y + start.h / 2
      top = cy - h / 2
      bottom = cy + h / 2
    } else {
      w = h * aspect
      const cx = start.x + start.w / 2
      left = cx - w / 2
      right = cx + w / 2
    }
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

// Map each box from `from` bounds into `to` bounds (multi-selection resize).
export function scaleInto(box: Box, from: Box, to: Box): Box {
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  return { x: to.x + (box.x - from.x) * sx, y: to.y + (box.y - from.y) * sy, w: box.w * sx, h: box.h * sy }
}

// ------------------------------------------------------------------ snapping

export interface SnapTargets { xs: number[]; ys: number[] }

export function snapTargets(opts: {
  card: { w: number; h: number; bleed: number; safe: number }
  others: Box[]
  gridMm?: number | null
}): SnapTargets {
  const { w, h, bleed, safe } = opts.card
  const xs = [0, w / 2, w, -bleed, w + bleed]
  const ys = [0, h / 2, h, -bleed, h + bleed]
  if (safe > 0) { xs.push(safe, w - safe); ys.push(safe, h - safe) }
  for (const b of opts.others) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w)
    ys.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  return { xs, ys }
}

function nearest(values: number[], targets: number[], threshold: number) {
  let best: { delta: number; at: number } | null = null
  for (const v of values) for (const t of targets) {
    const d = t - v
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t }
  }
  return best
}

const gridSnap = (v: number, grid: number) => Math.round(v / grid) * grid

/**
 * Snap a box being moved (handle = null) or resized. Object targets win; the grid (if any)
 * applies to axes that didn't snap to an object. Guides list the target lines used.
 */
export function snapBox(box: Box, targets: SnapTargets, threshold: number, handle: Handle | null = null, gridMm: number | null = null) {
  const out = { ...box }
  const guides = { x: [] as number[], y: [] as number[] }
  if (!handle) {
    const sx = nearest([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold)
    if (sx) { out.x += sx.delta; guides.x.push(sx.at) } else if (gridMm) out.x = gridSnap(box.x, gridMm)
    const sy = nearest([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold)
    if (sy) { out.y += sy.delta; guides.y.push(sy.at) } else if (gridMm) out.y = gridSnap(box.y, gridMm)
    return { box: roundBox(out), guides }
  }
  const edge = (pos: number, targetList: number[]) => {
    const s = nearest([pos], targetList, threshold)
    if (s) return { pos: s.at, guide: s.at }
    return { pos: gridMm ? gridSnap(pos, gridMm) : pos, guide: null as number | null }
  }
  if (handle.includes('w')) {
    const e = edge(box.x, targets.xs)
    if (box.x + box.w - e.pos >= MIN_SIZE_MM) { out.w = box.x + box.w - e.pos; out.x = e.pos; if (e.guide !== null) guides.x.push(e.guide) }
  } else if (handle.includes('e')) {
    const e = edge(box.x + box.w, targets.xs)
    if (e.pos - box.x >= MIN_SIZE_MM) { out.w = e.pos - box.x; if (e.guide !== null) guides.x.push(e.guide) }
  }
  if (handle.includes('n')) {
    const e = edge(box.y, targets.ys)
    if (box.y + box.h - e.pos >= MIN_SIZE_MM) { out.h = box.y + box.h - e.pos; out.y = e.pos; if (e.guide !== null) guides.y.push(e.guide) }
  } else if (handle.includes('s')) {
    const e = edge(box.y + box.h, targets.ys)
    if (e.pos - box.y >= MIN_SIZE_MM) { out.h = e.pos - box.y; if (e.guide !== null) guides.y.push(e.guide) }
  }
  return { box: roundBox(out), guides }
}

// ------------------------------------------------------------------ align / distribute

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

// Align boxes to `ref` (the selection bounds, or the card when one layer is selected).
export function alignBoxes(boxes: Box[], mode: AlignMode, ref: Box): Box[] {
  return boxes.map((b) => {
    switch (mode) {
      case 'left': return { ...b, x: ref.x }
      case 'hcenter': return { ...b, x: ref.x + (ref.w - b.w) / 2 }
      case 'right': return { ...b, x: ref.x + ref.w - b.w }
      case 'top': return { ...b, y: ref.y }
      case 'vcenter': return { ...b, y: ref.y + (ref.h - b.h) / 2 }
      case 'bottom': return { ...b, y: ref.y + ref.h - b.h }
    }
  }).map(roundBox)
}

// Equal gaps between boxes along an axis, keeping the outermost two in place. Returns boxes in
// the input order.
export function distributeBoxes(boxes: Box[], axis: 'x' | 'y'): Box[] {
  if (boxes.length < 3) return boxes
  const pos = axis === 'x' ? 'x' : 'y'
  const size = axis === 'x' ? 'w' : 'h'
  const order = boxes.map((b, i) => ({ b, i })).sort((a, z) => (a.b[pos] + a.b[size] / 2) - (z.b[pos] + z.b[size] / 2))
  const first = order[0].b
  const last = order[order.length - 1].b
  const span = last[pos] + last[size] - first[pos]
  const total = order.reduce((s, o) => s + o.b[size], 0)
  const gap = (span - total) / (order.length - 1)
  const out = [...boxes]
  let cursor = first[pos]
  for (const o of order) {
    out[o.i] = roundBox({ ...o.b, [pos]: cursor })
    cursor += o.b[size] + gap
  }
  return out
}
