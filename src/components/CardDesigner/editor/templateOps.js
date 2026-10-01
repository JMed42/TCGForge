// Pure, non-mutating edits on template JSON. Every function returns a new template object.
// Layer paint order is zIndex (ties: array order), as in the renderer. Reordering renumbers
// zIndex to 10, 20, 30… and keeps the array in paint order so the JSON stays readable.

export const LAYER_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

const LAYER_DEFAULTS = {
  text: {
    type: 'text', value: 'Text', width: 300, height: 60,
    font: 'Segoe UI', fontSize: 32, color: '#ffffff',
    align: 'left', valign: 'middle', overflow: 'shrink',
  },
  image: { type: 'image', source: '{{image_path}}', width: 300, height: 220, fit: 'cover', align: 'center center' },
  rect: { type: 'shape', shape: 'rect', width: 240, height: 120, fill: '#7c6ef0', stroke: '#ffffff', strokeWidth: 0, cornerRadius: 0 },
  circle: { type: 'shape', shape: 'circle', width: 120, height: 120, fill: '#7c6ef0', stroke: '#ffffff', strokeWidth: 3 },
}

export function sortedLayers(template) {
  return (template.layers || [])
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => ((Number(a.layer.zIndex) || 0) - (Number(b.layer.zIndex) || 0)) || (a.index - b.index))
    .map((e) => e.layer)
}

// Layers in paint order with zIndex renumbered 10, 20, 30…
function renumbered(layers) {
  return layers.map((layer, i) => ((layer.zIndex === (i + 1) * 10) ? layer : { ...layer, zIndex: (i + 1) * 10 }))
}

export function uniqueLayerId(template, base) {
  const ids = new Set((template.layers || []).map((l) => l.id))
  const stem = String(base || 'layer').replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, '') || 'layer'
  if (!ids.has(stem)) return stem
  for (let n = 2; ; n++) {
    if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`
  }
}

export function findLayer(template, id) {
  return (template.layers || []).find((l) => l.id === id) || null
}

export function updateLayer(template, id, patch) {
  return { ...template, layers: (template.layers || []).map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

// kind: 'text' | 'image' | 'rect' | 'circle'. New layers go on top, centred on the card.
export function addLayer(template, kind) {
  const defaults = LAYER_DEFAULTS[kind]
  if (!defaults) throw new Error(`unknown layer kind "${kind}"`)
  const meta = template.meta
  const width = Math.min(defaults.width, meta.width)
  const height = Math.min(defaults.height, meta.height)
  const id = uniqueLayerId(template, kind === 'rect' || kind === 'circle' ? 'shape' : kind)
  const layer = {
    id,
    ...defaults,
    x: Math.round((meta.width - width) / 2),
    y: Math.round((meta.height - height) / 2),
    width,
    height,
  }
  const layers = renumbered([...sortedLayers(template), layer])
  return { template: { ...template, layers }, id }
}

export function deleteLayer(template, id) {
  return { ...template, layers: (template.layers || []).filter((l) => l.id !== id) }
}

// Copy sits directly above the original, offset so it is visible.
export function duplicateLayer(template, id) {
  const ordered = sortedLayers(template)
  const index = ordered.findIndex((l) => l.id === id)
  if (index < 0) return { template, id: null }
  const original = ordered[index]
  const copy = { ...original, id: uniqueLayerId(template, `${original.id}-copy`), x: (Number(original.x) || 0) + 16, y: (Number(original.y) || 0) + 16 }
  const layers = renumbered([...ordered.slice(0, index + 1), copy, ...ordered.slice(index + 1)])
  return { template: { ...template, layers }, id: copy.id }
}

// topFirstIds: every layer id, top-most first (the order the layer panel shows).
export function reorderLayers(template, topFirstIds) {
  const byId = new Map((template.layers || []).map((l) => [l.id, l]))
  const missing = (template.layers || []).filter((l) => !topFirstIds.includes(l.id))
  const paintOrder = [...topFirstIds].reverse().map((id) => byId.get(id)).filter(Boolean)
  return { ...template, layers: renumbered([...missing, ...paintOrder]) }
}

// delta +1 moves the layer one step up (towards the top), -1 one step down.
export function moveLayer(template, id, delta) {
  const ordered = sortedLayers(template)
  const index = ordered.findIndex((l) => l.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ordered.length) return template
  const next = [...ordered]
  ;[next[index], next[target]] = [next[target], next[index]]
  return { ...template, layers: renumbered(next) }
}

// Returns { template } or { error }.
export function renameLayer(template, oldId, newId) {
  const id = String(newId || '').trim()
  if (id === oldId) return { template }
  if (!LAYER_ID_RE.test(id)) return { error: 'Use letters, digits, - or _, starting with a letter.' }
  if (findLayer(template, id)) return { error: `A layer called "${id}" already exists.` }
  return { template: updateLayer(template, oldId, { id }) }
}

export function updateMeta(template, patch) {
  return { ...template, meta: { ...template.meta, ...patch } }
}

export function updateBackground(template, patch) {
  return { ...template, background: { ...(template.background || {}), ...patch } }
}

export function setTemplateProp(template, key, value) {
  return { ...template, [key]: value }
}
