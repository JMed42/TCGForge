// Frames: offsets from the parent box's edges (mm or "N%"). Two of left/right/width and two of
// top/bottom/height pin a layer; left + right stretches it. Because positions are relative to
// edges rather than absolute, changing the card size reflows the layout.

import type { Box, Frame, Length } from '../schema/types.ts'

export type HAnchor = 'left' | 'right' | 'stretch'
export type VAnchor = 'top' | 'bottom' | 'stretch'

const isPct = (v: Length | undefined): v is string => typeof v === 'string' && v.endsWith('%')

export function lengthMm(v: Length | undefined, parentSize: number): number | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'number') return v
  return (parseFloat(v) / 100) * parentSize
}

// Resolve one axis. Missing values default so a partial frame still resolves predictably:
// size only → pinned to the start edge; start only → stretch to the end edge; nothing → fill.
function axis(start: number | undefined, end: number | undefined, size: number | undefined, parentSize: number) {
  if (start !== undefined && end !== undefined) return { pos: start, size: parentSize - start - end }
  if (start !== undefined && size !== undefined) return { pos: start, size }
  if (end !== undefined && size !== undefined) return { pos: parentSize - end - size, size }
  if (size !== undefined) return { pos: 0, size }
  if (start !== undefined) return { pos: start, size: parentSize - start }
  if (end !== undefined) return { pos: 0, size: parentSize - end }
  return { pos: 0, size: parentSize }
}

export function resolveFrame(frame: Frame | undefined, parent: Box): Box {
  const f = frame || {}
  const h = axis(lengthMm(f.left, parent.w), lengthMm(f.right, parent.w), lengthMm(f.width, parent.w), parent.w)
  const v = axis(lengthMm(f.top, parent.h), lengthMm(f.bottom, parent.h), lengthMm(f.height, parent.h), parent.h)
  return { x: parent.x + h.pos, y: parent.y + v.pos, w: Math.max(0, h.size), h: Math.max(0, v.size) }
}

export function anchorsOf(frame: Frame | undefined): { h: HAnchor; v: VAnchor } {
  const f = frame || {}
  const h: HAnchor = f.left !== undefined && f.right !== undefined ? 'stretch'
    : f.right !== undefined && f.left === undefined ? 'right' : 'left'
  const v: VAnchor = f.top !== undefined && f.bottom !== undefined ? 'stretch'
    : f.bottom !== undefined && f.top === undefined ? 'bottom' : 'top'
  return { h, v }
}

const round = (n: number, pct: boolean) => (pct ? Math.round(n * 100) / 100 : Math.round(n * 100) / 100)

// Write a length in the unit the frame already used for that key (mm unless it was a %).
function encode(mm: number, parentSize: number, asPct: boolean): Length {
  if (asPct && parentSize > 0) return `${round((mm / parentSize) * 100, true)}%`
  return round(mm, false)
}

/**
 * The inverse of resolveFrame: a frame that places the layer at `rect` inside `parent`, using
 * the given anchors (default: the frame's current ones) and keeping each key's unit.
 */
export function frameFromRect(rect: Box, parent: Box, frame: Frame | undefined, anchors = anchorsOf(frame)): Frame {
  const f = frame || {}
  const out: Frame = {}
  const left = rect.x - parent.x
  const right = parent.x + parent.w - (rect.x + rect.w)
  const top = rect.y - parent.y
  const bottom = parent.y + parent.h - (rect.y + rect.h)
  const pct = (k: keyof Frame) => isPct(f[k])

  if (anchors.h === 'stretch') {
    out.left = encode(left, parent.w, pct('left'))
    out.right = encode(right, parent.w, pct('right'))
  } else if (anchors.h === 'right') {
    out.right = encode(right, parent.w, pct('right'))
    out.width = encode(rect.w, parent.w, pct('width'))
  } else {
    out.left = encode(left, parent.w, pct('left'))
    out.width = encode(rect.w, parent.w, pct('width'))
  }
  if (anchors.v === 'stretch') {
    out.top = encode(top, parent.h, pct('top'))
    out.bottom = encode(bottom, parent.h, pct('bottom'))
  } else if (anchors.v === 'bottom') {
    out.bottom = encode(bottom, parent.h, pct('bottom'))
    out.height = encode(rect.h, parent.h, pct('height'))
  } else {
    out.top = encode(top, parent.h, pct('top'))
    out.height = encode(rect.h, parent.h, pct('height'))
  }
  return out
}

// Change anchoring without moving the layer.
export function setAnchors(frame: Frame | undefined, parent: Box, anchors: { h: HAnchor; v: VAnchor }): Frame {
  return frameFromRect(resolveFrame(frame, parent), parent, frame, anchors)
}

// Switch every key of the frame to mm or to %, keeping the layer where it is.
export function setUnits(frame: Frame | undefined, parent: Box, unit: 'mm' | '%'): Frame {
  const rect = resolveFrame(frame, parent)
  const marker: Frame = {}
  for (const k of ['left', 'right', 'width', 'top', 'bottom', 'height'] as const) marker[k] = unit === '%' ? '0%' : 0
  return frameFromRect(rect, parent, marker, anchorsOf(frame))
}
