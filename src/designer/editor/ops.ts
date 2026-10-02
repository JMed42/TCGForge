// Pure, non-mutating edits on schema-v1 templates. Every function returns a new template (or
// the same object when nothing changed). Positions are kept in each layer's own anchoring: when a
// layer moves between parents its frame is recomputed so it stays where it was on the card.

import type { Box, ContainerLayer, Frame, Layer, Template } from '../schema/types.ts'
import { isContainer } from '../schema/types.ts'
import { frameFromRect, resolveFrame } from '../layout/frame.ts'
import { absoluteBox, findRef, mapLayer, parentBoxOf, trimBox, uniqueId, walk } from '../layout/tree.ts'

export const LAYER_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export type LayerKind = 'text' | 'richText' | 'image' | 'rect' | 'roundRect' | 'ellipse' | 'stack' | 'group'

const round2 = (n: number) => Math.round(n * 100) / 100

// ------------------------------------------------------------------ lookups

export function getLayer(t: Template, id: string): Layer | null {
  return findRef(t, id)?.layer ?? null
}

export function parentIdOf(t: Template, id: string): string | null | undefined {
  const ref = findRef(t, id)
  return ref ? ref.parentId : undefined
}

export function containerOf(t: Template, parentId: string | null): ContainerLayer | null {
  if (parentId === null) return null
  const l = getLayer(t, parentId)
  return l && isContainer(l) ? l : null
}

export function siblingsOf(t: Template, parentId: string | null): Layer[] {
  if (parentId === null) return t.layers
  return containerOf(t, parentId)?.children ?? []
}

// Ids of layers whose frame positions them (not flow children of a stack).
export function isFramePositioned(t: Template, id: string): boolean {
  return parentBoxOf(t, id) !== null
}

// ------------------------------------------------------------------ structural helpers

function withChildren(t: Template, parentId: string | null, fn: (children: Layer[]) => Layer[]): Template {
  if (parentId === null) {
    const layers = fn(t.layers)
    return layers === t.layers ? t : { ...t, layers }
  }
  return mapLayer(t, parentId, (l) => (isContainer(l) ? { ...l, children: fn(l.children) } : l))
}

function removeIds(layers: Layer[], ids: Set<string>): Layer[] {
  let changed = false
  const out: Layer[] = []
  for (const l of layers) {
    if (ids.has(l.id)) { changed = true; continue }
    if (isContainer(l)) {
      const children = removeIds(l.children, ids)
      if (children !== l.children) { changed = true; out.push({ ...l, children }); continue }
    }
    out.push(l)
  }
  return changed ? out : layers
}

function cloneWithNewIds(layer: Layer, taken: Set<string>): Layer {
  const fresh = (base: string) => {
    const stem = `${base}-copy`
    let id = stem
    for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`
    taken.add(id)
    return id
  }
  const copy = { ...layer, id: fresh(layer.id) } as Layer
  if (isContainer(copy)) (copy as ContainerLayer).children = (copy as ContainerLayer).children.map((c) => cloneWithNewIds(c, taken))
  return copy
}

// A frame placing `rect` inside `parent`. Flow children of a stack keep only their main-axis size.
function frameFor(rect: Box, parent: Box | null, previous: Frame | undefined, stackDirection?: string): Frame | undefined {
  if (!parent) {
    if (stackDirection === 'horizontal') return { width: round2(rect.w) }
    return { height: round2(rect.h) }
  }
  return frameFromRect(rect, parent, previous)
}

// ------------------------------------------------------------------ edits

export function updateLayer(t: Template, id: string, patch: Partial<Layer>): Template {
  return mapLayer(t, id, (l) => ({ ...l, ...patch } as Layer))
}

// Move/resize a frame-positioned layer to an absolute rect (mm, trim coordinates).
export function setLayerRect(t: Template, id: string, rect: Box): Template {
  const parent = parentBoxOf(t, id)
  if (!parent) return t
  return mapLayer(t, id, (l) => ({ ...l, frame: frameFromRect(rect, parent, l.frame) }))
}

export function setSize(t: Template, patch: Partial<Template['size']>): Template {
  return { ...t, size: { ...t.size, ...patch } }
}

const DEFAULTS: Record<LayerKind, { layer: Omit<Layer, 'id'>; w: number; h: number; base: string }> = {
  text: {
    base: 'text', w: 30, h: 8,
    layer: { type: 'text', text: 'Text', style: { font: 'Segoe UI', sizePt: 10, color: '#ffffff', valign: 'middle' }, fit: { strategy: ['shrink'], minPt: 6 } } as Omit<Layer, 'id'>,
  },
  richText: {
    base: 'rules', w: 45, h: 20,
    layer: { type: 'richText', text: 'Rules text with **bold** and *italic*.', style: { font: 'Georgia', sizePt: 8, color: '#1a1a2e' }, fit: { strategy: ['shrink', 'tightenLeading'], minPt: 6 } } as Omit<Layer, 'id'>,
  },
  image: { base: 'image', w: 40, h: 30, layer: { type: 'image', src: '{{image_path}}', objectFit: 'cover', placeholder: 'proxy' } as Omit<Layer, 'id'> },
  rect: { base: 'shape', w: 30, h: 15, layer: { type: 'shape', shape: 'rect', fill: '#7c6ef0' } as Omit<Layer, 'id'> },
  roundRect: { base: 'shape', w: 30, h: 15, layer: { type: 'shape', shape: 'roundRect', fill: '#7c6ef0', radiusMm: 2 } as Omit<Layer, 'id'> },
  ellipse: { base: 'shape', w: 15, h: 15, layer: { type: 'shape', shape: 'ellipse', fill: '#7c6ef0' } as Omit<Layer, 'id'> },
  stack: { base: 'stack', w: 45, h: 30, layer: { type: 'stack', direction: 'vertical', gapMm: 1.5, children: [] } as unknown as Omit<Layer, 'id'> },
  group: { base: 'group', w: 30, h: 20, layer: { type: 'group', children: [] } as unknown as Omit<Layer, 'id'> },
}

/**
 * Add a layer on top of `parentId` (null = card). Frame-positioned layers are centred in their
 * parent; stack children flow. Returns the new id.
 */
export function addLayer(t: Template, kind: LayerKind, parentId: string | null = null): { template: Template; id: string } {
  const d = DEFAULTS[kind]
  const id = uniqueId(t, d.base)
  const parent = parentId === null ? null : containerOf(t, parentId)
  let frame: Frame | undefined
  if (parent && parent.type === 'stack') {
    frame = kind === 'text' || kind === 'richText' ? undefined : parent.direction === 'horizontal' ? { width: d.w } : { height: d.h }
  } else {
    const box = parentId === null ? trimBox(t) : absoluteBox(t, parentId) ?? trimBox(t)
    const w = Math.min(d.w, box.w)
    const h = Math.min(d.h, box.h)
    frame = { left: round2((box.w - w) / 2), top: round2((box.h - h) / 2), width: w, height: h }
  }
  const layer = { ...structuredClone(d.layer), id, ...(frame ? { frame } : {}) } as Layer
  return { template: withChildren(t, parentId, (c) => [...c, layer]), id }
}

export function deleteLayers(t: Template, ids: string[]): Template {
  const layers = removeIds(t.layers, new Set(ids))
  return layers === t.layers ? t : { ...t, layers }
}

/** Duplicate each layer just above itself, offset 2 mm when frame-positioned. */
export function duplicateLayers(t: Template, ids: string[], offsetMm = 2): { template: Template; ids: string[] } {
  const taken = new Set<string>()
  walk(t.layers, (r) => taken.add(r.layer.id))
  let out = t
  const newIds: string[] = []
  for (const id of ids) {
    const ref = findRef(out, id)
    if (!ref) continue
    let copy = cloneWithNewIds(ref.layer, taken)
    const parent = parentBoxOf(out, id)
    const abs = absoluteBox(out, id)
    if (parent && abs) copy = { ...copy, frame: frameFromRect({ ...abs, x: abs.x + offsetMm, y: abs.y + offsetMm }, parent, ref.layer.frame) }
    out = withChildren(out, ref.parentId, (c) => {
      const i = c.findIndex((l) => l.id === id)
      return [...c.slice(0, i + 1), copy, ...c.slice(i + 1)]
    })
    newIds.push(copy.id)
  }
  return { template: out, ids: newIds }
}

/** delta +1 moves one step up the paint order (towards the top) within its parent. */
export function moveInParent(t: Template, id: string, delta: number): Template {
  const ref = findRef(t, id)
  if (!ref) return t
  return withChildren(t, ref.parentId, (c) => {
    const i = c.findIndex((l) => l.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= c.length) return c
    const next = [...c]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
}

/** Move a layer to `index` of `newParentId`'s children, keeping its place on the card. */
export function moveToParent(t: Template, id: string, newParentId: string | null, index: number): Template {
  const ref = findRef(t, id)
  if (!ref) return t
  if (newParentId === id) return t
  // A container can't move into its own subtree.
  if (newParentId !== null && isContainer(ref.layer)) {
    let inside = false
    walk(ref.layer.children, (r) => { if (r.layer.id === newParentId) inside = true })
    if (inside) return t
  }
  const target = newParentId === null ? null : containerOf(t, newParentId)
  if (newParentId !== null && !target) return t
  const abs = absoluteBox(t, id)
  const removed = deleteLayers(t, [id])
  let layer: Layer = ref.layer
  const newParentBox = newParentId === null ? trimBox(removed) : target!.type === 'stack' ? null : absoluteBox(removed, newParentId)
  if (abs) layer = { ...layer, frame: frameFor(abs, newParentBox, layer.frame, target?.type === 'stack' ? target.direction : undefined) }
  else if (newParentBox) layer = { ...layer, frame: { left: 0, top: 0, width: Math.min(20, newParentBox.w), height: Math.min(10, newParentBox.h) } }
  return withChildren(removed, newParentId, (c) => {
    const i = Math.max(0, Math.min(index, c.length))
    return [...c.slice(0, i), layer, ...c.slice(i)]
  })
}

/** Group layers that share a parent (not a stack). The group's frame is their bounding box. */
export function groupLayers(t: Template, ids: string[]): { template: Template; id: string } | { error: string } {
  if (ids.length === 0) return { error: 'nothing selected' }
  const refs = ids.map((id) => findRef(t, id)).filter(Boolean) as NonNullable<ReturnType<typeof findRef>>[]
  const parentId = refs[0].parentId
  if (refs.some((r) => r.parentId !== parentId)) return { error: 'select layers in the same group to group them' }
  const parent = parentId === null ? null : containerOf(t, parentId)
  if (parent?.type === 'stack') return { error: "stack children flow; they can't be grouped" }
  const boxes = ids.map((id) => absoluteBox(t, id)).filter(Boolean) as Box[]
  if (boxes.length !== ids.length) return { error: 'some layers have no position' }
  const x1 = Math.min(...boxes.map((b) => b.x))
  const y1 = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  const groupBox: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  const parentBox = parentId === null ? trimBox(t) : absoluteBox(t, parentId)!
  const gid = uniqueId(t, 'group')
  const siblings = siblingsOf(t, parentId)
  const chosen = new Set(ids)
  const ordered = siblings.filter((l) => chosen.has(l.id)) // keep paint order
  const children = ordered.map((l) => ({ ...l, frame: frameFromRect(absoluteBox(t, l.id)!, groupBox, l.frame) }))
  const group = { id: gid, type: 'group', frame: frameFromRect(groupBox, parentBox, undefined), children } as Layer
  const topIndex = Math.max(...ordered.map((l) => siblings.indexOf(l)))
  const template = withChildren(t, parentId, (c) => {
    const out: Layer[] = []
    c.forEach((l, i) => {
      if (!chosen.has(l.id)) out.push(l)
      if (i === topIndex) out.push(group)
    })
    return out
  })
  return { template, id: gid }
}

/** Replace a group by its children, in place, keeping their positions on the card. */
export function ungroup(t: Template, groupId: string): { template: Template; ids: string[] } | { error: string } {
  const ref = findRef(t, groupId)
  if (!ref || ref.layer.type !== 'group') return { error: 'not a group' }
  const group = ref.layer
  const groupBox = absoluteBox(t, groupId)
  const parentBox = ref.parentId === null ? trimBox(t) : absoluteBox(t, ref.parentId)
  if (!groupBox || !parentBox) return { error: 'groups inside a stack cannot be ungrouped' }
  const children = group.children.map((c) => {
    const abs = resolveFrame(c.frame, groupBox)
    let out: Layer = { ...c, frame: frameFromRect(abs, parentBox, c.frame) }
    // The group's own opacity and condition still apply to each child.
    if (group.opacity !== undefined) out = { ...out, opacity: round2((c.opacity ?? 1) * group.opacity) }
    if (group.visibleIf && group.visibleIf.trim()) {
      out = { ...out, visibleIf: c.visibleIf && c.visibleIf.trim() ? `(${group.visibleIf}) && (${c.visibleIf})` : group.visibleIf }
    }
    if (group.hidden) out = { ...out, hidden: true }
    return out
  })
  const template = withChildren(t, ref.parentId, (c) => c.flatMap((l) => (l.id === groupId ? children : [l])))
  return { template, ids: children.map((c) => c.id) }
}

export function renameLayer(t: Template, oldId: string, newId: string): { template: Template } | { error: string } {
  const id = String(newId || '').trim()
  if (id === oldId) return { template: t }
  if (!LAYER_ID_RE.test(id)) return { error: 'Use letters, digits, - or _, starting with a letter.' }
  if (getLayer(t, id)) return { error: `A layer called "${id}" already exists.` }
  return { template: updateLayer(t, oldId, { id } as Partial<Layer>) }
}
