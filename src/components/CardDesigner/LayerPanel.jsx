import { useMemo, useRef, useState } from 'react'
import {
  Type, Image as ImageIcon, Square, Circle, Eye, EyeOff, Lock, Unlock, Plus, ChevronUp, ChevronDown, Copy, Trash2, GripVertical,
} from 'lucide-react'
import { useStore } from '../../store'
import {
  sortedLayers, addLayer, deleteLayer, duplicateLayer, moveLayer, reorderLayers, renameLayer, updateLayer,
} from './editor/templateOps'

const ADD_KINDS = [
  ['text', 'Text', Type],
  ['image', 'Image', ImageIcon],
  ['rect', 'Rectangle', Square],
  ['circle', 'Circle', Circle],
]

function layerIcon(layer) {
  if (layer.type === 'text') return Type
  if (layer.type === 'image' || layer.type === 'icon') return ImageIcon
  if (layer.shape === 'circle' || layer.shape === 'ellipse') return Circle
  return Square
}

const iconBtn = 'p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent'

// Layers listed top-most first, the way they stack on the card.
export default function LayerPanel() {
  const { draft, selectedLayerId, selectLayer, edit } = useStore()
  const topFirst = useMemo(() => (draft ? [...sortedLayers(draft)].reverse() : []), [draft])
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, value, error }
  const [dropIndex, setDropIndex] = useState(null)
  const dragId = useRef(null)

  if (!draft) return null
  const selectedIndex = topFirst.findIndex((l) => l.id === selectedLayerId)

  const add = (kind) => {
    setMenuOpen(false)
    const result = addLayer(draft, kind)
    edit(() => result.template, { select: result.id })
  }

  const commitRename = () => {
    if (!renaming) return
    const result = renameLayer(draft, renaming.id, renaming.value)
    if (result.error) {
      setRenaming({ ...renaming, error: result.error })
      return
    }
    if (result.template !== draft) edit(() => result.template, { select: renaming.value.trim() })
    setRenaming(null)
  }

  const onDrop = (index) => {
    const id = dragId.current
    dragId.current = null
    setDropIndex(null)
    if (!id) return
    const ids = topFirst.map((l) => l.id).filter((x) => x !== id)
    const from = topFirst.findIndex((l) => l.id === id)
    ids.splice(index > from ? index - 1 : index, 0, id)
    edit((t) => reorderLayers(t, ids))
  }

  return (
    <div className="flex flex-col min-h-0 border-b border-border" style={{ flex: '0 1 45%' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Layers</h3>
        <div className="relative">
          <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-text-primary">
            <Plus size={14} /> Add
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-36 bg-surface-2 border border-border rounded-lg shadow-xl z-20 py-1">
              {ADD_KINDS.map(([kind, label, Icon]) => (
                <button key={kind} onClick={() => add(kind)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary">
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drops below the last row land here; row drops bubble up too, but dragId is cleared by then. */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onDrop(dropIndex ?? topFirst.length) }}
      >
        {topFirst.length === 0 && <p className="px-4 py-3 text-xs text-text-muted">No layers yet. Use Add.</p>}
        {topFirst.map((layer, index) => {
          const Icon = layerIcon(layer)
          const selected = layer.id === selectedLayerId
          return (
            <div key={layer.id}>
              {dropIndex === index && <div className="h-0.5 mx-3 bg-accent" />}
              <div
                data-layer-row={layer.id}
                draggable={!renaming}
                onDragStart={(e) => { dragId.current = layer.id; e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => {
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  setDropIndex(e.clientY < r.top + r.height / 2 ? index : index + 1)
                }}
                onDrop={(e) => { e.preventDefault(); onDrop(dropIndex ?? index) }}
                onDragEnd={() => { dragId.current = null; setDropIndex(null) }}
                onClick={() => selectLayer(layer.id)}
                onDoubleClick={() => setRenaming({ id: layer.id, value: layer.id, error: null })}
                className={`group flex items-center gap-1.5 mx-1 px-2 py-1 rounded cursor-pointer text-xs ${
                  selected ? 'bg-surface-3 text-accent' : 'text-text-secondary hover:bg-surface-2'
                } ${layer.visible === false ? 'opacity-50' : ''}`}
              >
                <GripVertical size={12} className="flex-none text-text-muted opacity-0 group-hover:opacity-100 cursor-grab" />
                <Icon size={13} className="flex-none" />
                {renaming?.id === layer.id ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ ...renaming, value: e.target.value, error: null })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    className="flex-1 min-w-0 px-1 bg-surface-1 border border-accent rounded text-text-primary text-xs focus:outline-none"
                  />
                ) : (
                  <span className="flex-1 truncate" title="Double-click to rename">{layer.id}</span>
                )}
                <button
                  title={layer.visible === false ? 'Show' : 'Hide'}
                  onClick={(e) => { e.stopPropagation(); edit((t) => updateLayer(t, layer.id, { visible: layer.visible === false })) }}
                  className={iconBtn}
                >
                  {layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  title={layer.locked ? 'Unlock' : 'Lock'}
                  onClick={(e) => { e.stopPropagation(); edit((t) => updateLayer(t, layer.id, { locked: !layer.locked })) }}
                  className={`${iconBtn} ${layer.locked ? 'text-warning' : ''}`}
                >
                  {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </div>
            </div>
          )
        })}
        {dropIndex === topFirst.length && <div className="h-0.5 mx-3 bg-accent" />}
        {renaming?.error && <p className="px-4 py-1 text-[11px] text-danger">{renaming.error}</p>}
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border">
        <button title="Bring forward" disabled={selectedIndex <= 0} onClick={() => edit((t) => moveLayer(t, selectedLayerId, 1))} className={iconBtn}>
          <ChevronUp size={14} />
        </button>
        <button title="Send backward" disabled={selectedIndex < 0 || selectedIndex >= topFirst.length - 1} onClick={() => edit((t) => moveLayer(t, selectedLayerId, -1))} className={iconBtn}>
          <ChevronDown size={14} />
        </button>
        <div className="flex-1" />
        <button
          title="Duplicate (Ctrl+D)"
          disabled={selectedIndex < 0}
          onClick={() => { const r = duplicateLayer(draft, selectedLayerId); edit(() => r.template, { select: r.id }) }}
          className={iconBtn}
        >
          <Copy size={14} />
        </button>
        <button
          title="Delete (Del)"
          disabled={selectedIndex < 0}
          onClick={() => edit((t) => deleteLayer(t, selectedLayerId), { select: null })}
          className={`${iconBtn} hover:text-danger`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
