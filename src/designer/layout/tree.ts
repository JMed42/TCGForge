// Layer tree helpers. Paint order is array order (first = bottom); containers paint their
// children above themselves, in order.

import type { Box, Layer, Template } from '../schema/types.ts'
import { isContainer } from '../schema/types.ts'
import { resolveFrame } from './frame.ts'

export interface LayerRef {
  layer: Layer
  parentId: string | null // null = template root
  index: number
  depth: number
}

export function walk(layers: Layer[], visit: (ref: LayerRef) => void, parentId: string | null = null, depth = 0) {
  layers.forEach((layer, index) => {
    visit({ layer, parentId, index, depth })
    if (isContainer(layer)) walk(layer.children, visit, layer.id, depth + 1)
  })
}

export function flatten(t: Template): LayerRef[] {
  const out: LayerRef[] = []
  walk(t.layers, (r) => out.push(r))
  return out
}

export function findRef(t: Template, id: string): LayerRef | null {
  let found: LayerRef | null = null
  walk(t.layers, (r) => { if (!found && r.layer.id === id) found = r })
  return found
}

export function trimBox(t: Template): Box {
  return { x: 0, y: 0, w: t.size.widthMm, h: t.size.heightMm }
}

// The box a layer's frame is relative to: the trim box at the root, or its group's box.
// Stack children are positioned by flow, not by frame, so they have no frame parent.
export function parentBoxOf(t: Template, id: string): Box | null {
  const chain: Layer[] = []
  const find = (layers: Layer[]): boolean => {
    for (const l of layers) {
      if (l.id === id) return true
      if (isContainer(l)) {
        chain.push(l)
        if (find(l.children)) return true
        chain.pop()
      }
    }
    return false
  }
  if (!find(t.layers)) return null
  let box = trimBox(t)
  for (const container of chain) {
    if (container.type === 'stack') return null
    box = resolveFrame(container.frame, box)
  }
  return box
}

// Absolute box (mm, trim coordinates) of a frame-positioned layer; null for stack children.
export function absoluteBox(t: Template, id: string): Box | null {
  const ref = findRef(t, id)
  const parent = parentBoxOf(t, id)
  if (!ref || !parent) return null
  return resolveFrame(ref.layer.frame, parent)
}

// Immutable update of one layer anywhere in the tree.
export function mapLayer(t: Template, id: string, fn: (l: Layer) => Layer): Template {
  // Only the path to the changed layer is copied; untouched branches keep their identity.
  const rec = (layers: Layer[]): Layer[] => {
    let changed = false
    const next = layers.map((l) => {
      if (l.id === id) { changed = true; return fn(l) }
      if (isContainer(l)) {
        const children = rec(l.children)
        if (children !== l.children) { changed = true; return { ...l, children } }
      }
      return l
    })
    return changed ? next : layers
  }
  const layers = rec(t.layers)
  return layers === t.layers ? t : { ...t, layers }
}

export function allIds(t: Template): Set<string> {
  const ids = new Set<string>()
  walk(t.layers, (r) => ids.add(r.layer.id))
  return ids
}

export function uniqueId(t: Template, base: string): string {
  const ids = allIds(t)
  const stem = String(base || 'layer').replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, '') || 'layer'
  if (!ids.has(stem)) return stem
  for (let n = 2; ; n++) if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`
}
