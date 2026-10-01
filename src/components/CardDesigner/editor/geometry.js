// Pure geometry for the card stage, in template units (pixels at meta.dpi). The stage converts
// pointer positions to template units before calling these, so they are unit-testable.

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const MIN_SIZE = 4

export const rectOf = (layer) => ({
  x: Number(layer.x) || 0,
  y: Number(layer.y) || 0,
  width: Number(layer.width) || 0,
  height: Number(layer.height) || 0,
})

const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })

// Top-most visible, unlocked layer under the point. layersTopFirst: paint order reversed.
export function hitTest(layersTopFirst, point) {
  for (const layer of layersTopFirst) {
    if (layer.visible === false || layer.locked) continue
    const r = rectOf(layer)
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return layer.id
  }
  return null
}

// axisLock: keep only the larger of the two movements (Shift while dragging).
export function moveRect(start, dx, dy, { axisLock = false } = {}) {
  let mx = dx
  let my = dy
  if (axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) my = 0
    else mx = 0
  }
  return { ...start, x: start.x + mx, y: start.y + my }
}

// handle: one of HANDLES. keepAspect: Shift while resizing (corner handles scale both axes;
// edge handles scale the other axis around the centre).
export function resizeRect(start, handle, dx, dy, { keepAspect = false, minSize = MIN_SIZE } = {}) {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy

  // Dragging past the opposite edge clamps at the minimum size rather than flipping.
  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize
    else right = left + minSize
  }
  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize
    else bottom = top + minSize
  }

  if (keepAspect && start.width > 0 && start.height > 0) {
    const aspect = start.width / start.height
    let width = right - left
    let height = bottom - top
    const horizontal = handle.includes('e') || handle.includes('w')
    const vertical = handle.includes('n') || handle.includes('s')
    if (horizontal && vertical) {
      // Corner: follow whichever axis moved proportionally more.
      if (width / start.width >= height / start.height) height = width / aspect
      else width = height * aspect
      if (handle.includes('w')) left = right - width
      else right = left + width
      if (handle.includes('n')) top = bottom - height
      else bottom = top + height
    } else if (horizontal) {
      height = width / aspect
      const cy = start.y + start.height / 2
      top = cy - height / 2
      bottom = cy + height / 2
    } else {
      width = height * aspect
      const cx = start.x + start.width / 2
      left = cx - width / 2
      right = cx + width / 2
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// Snap targets: card edges and centre, plus edges and centres of the other visible layers.
export function snapTargets(template, excludeId) {
  const { width, height } = template.meta
  const xs = [0, width / 2, width]
  const ys = [0, height / 2, height]
  for (const layer of template.layers || []) {
    if (layer.id === excludeId || layer.visible === false) continue
    const r = rectOf(layer)
    xs.push(r.x, r.x + r.width / 2, r.x + r.width)
    ys.push(r.y, r.y + r.height / 2, r.y + r.height)
  }
  return { xs, ys }
}

function nearest(values, targets, threshold) {
  let best = null
  for (const v of values) {
    for (const t of targets) {
      const d = t - v
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t }
    }
  }
  return best
}

/**
 * Snap a rect being moved (handle = null) or resized (handle = which edges move).
 * Returns { rect, guides: { x: number[], y: number[] } } with the rect rounded to whole px.
 */
export function snapRect(rect, targets, threshold, handle = null) {
  const out = { ...rect }
  const guides = { x: [], y: [] }
  if (!handle) {
    const sx = nearest([rect.x, rect.x + rect.width / 2, rect.x + rect.width], targets.xs, threshold)
    if (sx) { out.x += sx.delta; guides.x.push(sx.at) }
    const sy = nearest([rect.y, rect.y + rect.height / 2, rect.y + rect.height], targets.ys, threshold)
    if (sy) { out.y += sy.delta; guides.y.push(sy.at) }
    return { rect: roundRect(out), guides }
  }
  if (handle.includes('w')) {
    const s = nearest([rect.x], targets.xs, threshold)
    if (s && rect.width - s.delta >= MIN_SIZE) { out.x += s.delta; out.width -= s.delta; guides.x.push(s.at) }
  } else if (handle.includes('e')) {
    const s = nearest([rect.x + rect.width], targets.xs, threshold)
    if (s && rect.width + s.delta >= MIN_SIZE) { out.width += s.delta; guides.x.push(s.at) }
  }
  if (handle.includes('n')) {
    const s = nearest([rect.y], targets.ys, threshold)
    if (s && rect.height - s.delta >= MIN_SIZE) { out.y += s.delta; out.height -= s.delta; guides.y.push(s.at) }
  } else if (handle.includes('s')) {
    const s = nearest([rect.y + rect.height], targets.ys, threshold)
    if (s && rect.height + s.delta >= MIN_SIZE) { out.height += s.delta; guides.y.push(s.at) }
  }
  return { rect: roundRect(out), guides }
}

export { roundRect }
