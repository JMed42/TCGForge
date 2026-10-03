import { useMemo, useRef, useState } from 'react'
import {
  Type, AlignLeft, Image as ImageIcon, Square, RectangleHorizontal, Circle, Rows3, Group, Eye, EyeOff, Lock, Unlock,
  Plus, ChevronUp, ChevronDown, ChevronRight, Copy, Trash2, GripVertical, FolderOutput, Repeat,
} from 'lucide-react'
import { useStore } from '../../store'
import { isContainer } from '../../designer/schema/types.ts'
import { findRef } from '../../designer/layout/tree.ts'
import {
  addLayer, deleteLayers, duplicateLayers, getLayer, moveInParent, moveToParent, renameLayer, siblingsOf, updateLayer,
} from '../../designer/editor/ops.ts'

const ADD_KINDS = [
  ['text', 'Text', Type],
  ['richText', 'Rich text', AlignLeft],
  ['image', 'Image', ImageIcon],
  ['rect', 'Rectangle', Square],
  ['roundRect', 'Rounded rectangle', RectangleHorizontal],
  ['ellipse', 'Ellipse', Circle],
  ['stack', 'Stack: text blocks that push each other down', Rows3],
  ['group', 'Group', Group],
]

function iconFor(layer) {
  switch (layer.type) {
    case 'text': return Type
    case 'richText': return AlignLeft
    case 'image': return ImageIcon
    case 'stack': return Rows3
    case 'group': return Group
    case 'iconRepeat': return Repeat
    default: return layer.shape === 'ellipse' ? Circle : layer.shape === 'roundRect' ? RectangleHorizontal : Square
  }
}

const iconBtn = 'p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent'

// Layer tree, top-most first within each parent (paint order is array order, bottom first).
export default function LayersPanel() {
  const { draft, selectedIds, setSelection, toggleSelection, edit } = useStore()
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, value, error }
  const [drop, setDrop] = useState(null) // { id, where: 'before' | 'after' | 'into' }
  const dragId = useRef(null)
  const dropRef = useRef(null) // latest drop target; state alone can lag behind a fast drop

  // Top-most layer first, as in paint order, except inside a stack: there the list follows the
  // stack's flow, first child at the top, the way it reads on the card.
  const rows = useMemo(() => {
    const out = []
    const visit = (layers, depth, parentId, flow) => {
      const order = flow ? layers : [...layers].reverse()
      for (const l of order) {
        out.push({ layer: l, depth, parentId })
        if (isContainer(l) && !collapsed.has(l.id)) visit(l.children, depth + 1, l.id, l.type === 'stack')
      }
    }
    if (draft) visit(draft.layers, 0, null, false)
    return out
  }, [draft, collapsed])
  const inStack = (parentId) => parentId !== null && parentId !== undefined && getLayer(draft, parentId)?.type === 'stack'

  if (!draft) return null
  const single = selectedIds.length === 1 ? selectedIds[0] : null
  const singleRef = single ? findRef(draft, single) : null

  const add = (kind) => {
    setMenuOpen(false)
    // Into the selected container, or next to the selected layer's siblings, or on the card.
    const sel = single && getLayer(draft, single)
    const parentId = sel && isContainer(sel) ? sel.id : singleRef ? singleRef.parentId : null
    const r = addLayer(draft, kind, parentId)
    edit(() => r.template, { select: [r.id] })
  }

  const commitRename = () => {
    if (!renaming) return
    const r = renameLayer(draft, renaming.id, renaming.value)
    if ('error' in r) { setRenaming({ ...renaming, error: r.error }); return }
    if (r.template !== draft) edit(() => r.template, { select: [renaming.value.trim()] })
    setRenaming(null)
  }

  const onDragOver = (e, row) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const where = isContainer(row.layer) && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'before' : 'after'
    dropRef.current = { id: row.layer.id, where }
    setDrop(dropRef.current)
  }

  const onDrop = (e) => {
    e.preventDefault()
    const id = dragId.current
    const target = dropRef.current
    dragId.current = null
    dropRef.current = null
    setDrop(null)
    if (!id || !target || id === target.id) return
    edit((t) => {
      if (target.where === 'into') return moveToParent(t, id, target.id, Number.MAX_SAFE_INTEGER) // on top inside
      const ref = findRef(t, target.id)
      if (!ref) return t
      // The list is top-most first, so "before" in the list means above = later in the array;
      // inside a stack the list follows the flow, so "before" is earlier in the array.
      const withoutSelf = siblingsOf(t, ref.parentId).filter((l) => l.id !== id)
      const at = withoutSelf.findIndex((l) => l.id === target.id)
      const flow = getLayer(t, ref.parentId)?.type === 'stack'
      return moveToParent(t, id, ref.parentId, flow ? (target.where === 'before' ? at : at + 1) : (target.where === 'before' ? at + 1 : at))
    })
  }

  const moveOut = () => {
    if (!singleRef || singleRef.parentId === null) return
    edit((t) => {
      const parentRef = findRef(t, singleRef.parentId)
      return moveToParent(t, single, parentRef.parentId, parentRef.index + 1)
    })
  }

  return (
    <div className="flex flex-col min-h-0 border-b border-border" style={{ flex: '0 1 42%' }} data-testid="layers-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Layers</h3>
        <div className="relative">
          <button data-testid="add-layer" onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-xs text-text-primary">
            <Plus size={13} /> Add
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-surface-2 border border-border rounded-lg shadow-xl z-20 py-1">
              {ADD_KINDS.map(([kind, label, Icon]) => (
                <button key={kind} data-add={kind} onClick={() => add(kind)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary">
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {rows.map(({ layer, depth }) => {
          const Icon = iconFor(layer)
          const selected = selectedIds.includes(layer.id)
          const marker = drop?.id === layer.id ? drop.where : null
          return (
            <div
              key={layer.id}
              data-layer-row={layer.id}
              draggable={!renaming}
              onDragStart={(e) => { dragId.current = layer.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => onDragOver(e, { layer })}
              onDragEnd={() => { dragId.current = null; dropRef.current = null; setDrop(null) }}
              onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggleSelection(layer.id) : setSelection([layer.id]))}
              onDoubleClick={() => setRenaming({ id: layer.id, value: layer.id, error: null })}
              className={`group relative flex items-center gap-1 mx-1 pr-1 py-0.5 rounded cursor-pointer text-xs ${
                selected ? 'bg-surface-3 text-accent' : 'text-text-secondary hover:bg-surface-2'
              } ${layer.hidden ? 'opacity-50' : ''} ${marker === 'into' ? 'ring-1 ring-accent' : ''}`}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              {marker === 'before' && <div className="absolute left-0 right-0 -top-px h-0.5 bg-accent" />}
              {marker === 'after' && <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent" />}
              {isContainer(layer) ? (
                <button
                  className="p-0.5 text-text-muted"
                  onClick={(e) => { e.stopPropagation(); setCollapsed((c) => { const n = new Set(c); n.has(layer.id) ? n.delete(layer.id) : n.add(layer.id); return n }) }}
                >
                  {collapsed.has(layer.id) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                </button>
              ) : (
                <GripVertical size={11} className="text-text-muted opacity-0 group-hover:opacity-100" />
              )}
              <Icon size={12} className="flex-none" />
              {renaming?.id === layer.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(e) => setRenaming({ ...renaming, value: e.target.value, error: null })}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); e.stopPropagation() }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 px-1 bg-surface-1 border border-accent rounded text-text-primary text-xs focus:outline-none"
                />
              ) : (
                <span className="flex-1 truncate" title="Double-click to rename">{layer.id}</span>
              )}
              {layer.visibleIf && <span title={`visibleIf: ${layer.visibleIf}`} className="px-1 rounded bg-surface-4 text-[9px] text-text-secondary">if</span>}
              <button
                title={layer.hidden ? 'Show' : 'Hide'}
                data-toggle="hidden"
                onClick={(e) => { e.stopPropagation(); edit((t) => updateLayer(t, layer.id, { hidden: !layer.hidden || undefined })) }}
                className={iconBtn}
              >
                {layer.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                title={layer.locked ? 'Unlock' : 'Lock'}
                data-toggle="locked"
                onClick={(e) => { e.stopPropagation(); edit((t) => updateLayer(t, layer.id, { locked: !layer.locked || undefined })) }}
                className={`${iconBtn} ${layer.locked ? 'text-warning' : ''}`}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
          )
        })}
        {renaming?.error && <p className="px-3 py-1 text-[11px] text-danger">{renaming.error}</p>}
      </div>

      <div className="flex items-center gap-0.5 px-2 py-1 border-t border-border">
        <button title={inStack(singleRef?.parentId) ? 'Move up in the stack' : 'Bring forward'} disabled={!single} onClick={() => edit((t) => moveInParent(t, single, inStack(singleRef?.parentId) ? -1 : 1))} className={iconBtn}><ChevronUp size={14} /></button>
        <button title={inStack(singleRef?.parentId) ? 'Move down in the stack' : 'Send backward'} disabled={!single} onClick={() => edit((t) => moveInParent(t, single, inStack(singleRef?.parentId) ? 1 : -1))} className={iconBtn}><ChevronDown size={14} /></button>
        <button title="Move out of its group or stack" disabled={!singleRef || singleRef.parentId === null} onClick={moveOut} className={iconBtn}><FolderOutput size={14} /></button>
        <div className="flex-1" />
        <button
          title="Duplicate (Ctrl+D)"
          disabled={!selectedIds.length}
          onClick={() => { const r = duplicateLayers(draft, selectedIds); edit(() => r.template, { select: r.ids }) }}
          className={iconBtn}
        >
          <Copy size={14} />
        </button>
        <button title="Delete (Del)" disabled={!selectedIds.length} onClick={() => edit((t) => deleteLayers(t, selectedIds), { select: [] })} className={`${iconBtn} hover:text-danger`}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
