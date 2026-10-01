import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { sortedLayers, updateLayer, findLayer } from './editor/templateOps'
import { HANDLES, hitTest, moveRect, rectOf, resizeRect, roundRect, snapRect, snapTargets } from './editor/geometry'

const SNAP_SCREEN_PX = 4
const DRAG_START_SCREEN_PX = 2

const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
}
const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
}

// The rendered card (an <img> from the main-process renderer) with an interaction overlay.
// All geometry is done in template units; cssScale converts to screen pixels.
export default function CardStage() {
  const { draft, preview, previewZoom, selectedLayerId, selectLayer, beginGesture, editLive } = useStore()
  const rootRef = useRef(null)
  const gestureRef = useRef(null)
  const [hoverId, setHoverId] = useState(null)
  const [guides, setGuides] = useState({ x: [], y: [] })
  const [dragging, setDragging] = useState(false)

  const meta = draft.meta
  const cssScale = (96 * previewZoom) / meta.dpi
  const cssW = meta.width * cssScale
  const cssH = meta.height * cssScale
  const layers = useMemo(() => sortedLayers(draft), [draft])
  const topFirst = useMemo(() => [...layers].reverse(), [layers])

  const toTemplate = (e) => {
    const r = rootRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / cssScale, y: (e.clientY - r.top) / cssScale }
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    const pt = toTemplate(e)
    const handle = e.target.dataset?.handle
    const selected = selectedLayerId && findLayer(draft, selectedLayerId)
    let mode = 'move'
    let id
    if (handle && selected && !selected.locked) {
      mode = 'resize'
      id = selected.id
    } else {
      id = hitTest(topFirst, pt)
      selectLayer(id)
      if (!id) return
    }
    rootRef.current.setPointerCapture(e.pointerId)
    gestureRef.current = {
      mode,
      id,
      handle,
      origin: pt,
      start: rectOf(findLayer(draft, id)),
      targets: snapTargets(draft, id),
      started: false,
    }
  }

  const onPointerMove = (e) => {
    const g = gestureRef.current
    const pt = toTemplate(e)
    if (!g) {
      setHoverId(hitTest(topFirst, pt))
      return
    }
    const dx = pt.x - g.origin.x
    const dy = pt.y - g.origin.y
    if (!g.started) {
      if (Math.hypot(dx, dy) * cssScale < DRAG_START_SCREEN_PX) return
      beginGesture() // one undo step for the whole drag
      g.started = true
      setDragging(true)
    }
    const raw = g.mode === 'move'
      ? moveRect(g.start, dx, dy, { axisLock: e.shiftKey })
      : resizeRect(g.start, g.handle, dx, dy, { keepAspect: e.shiftKey })
    const noSnap = e.altKey || (g.mode === 'resize' && e.shiftKey)
    const snapped = noSnap
      ? { rect: roundRect(raw), guides: { x: [], y: [] } }
      : snapRect(raw, g.targets, SNAP_SCREEN_PX / cssScale, g.mode === 'move' ? null : g.handle)
    setGuides(snapped.guides)
    editLive((t) => updateLayer(t, g.id, snapped.rect))
  }

  const endGesture = (e) => {
    if (gestureRef.current && rootRef.current?.hasPointerCapture?.(e.pointerId)) {
      rootRef.current.releasePointerCapture(e.pointerId)
    }
    gestureRef.current = null
    setGuides({ x: [], y: [] })
    setDragging(false)
  }

  const box = (layer) => {
    const r = rectOf(layer)
    return { left: r.x * cssScale, top: r.y * cssScale, width: r.width * cssScale, height: r.height * cssScale }
  }

  const selected = selectedLayerId ? findLayer(draft, selectedLayerId) : null
  const hovered = hoverId && hoverId !== selectedLayerId ? findLayer(draft, hoverId) : null

  return (
    <div
      ref={rootRef}
      id="card-stage"
      data-css-scale={cssScale}
      className="relative flex-none mx-auto shadow-2xl select-none"
      style={{ width: cssW, height: cssH, cursor: dragging ? 'grabbing' : hovered ? 'move' : 'default', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => !gestureRef.current && setHoverId(null)}
    >
      {preview?.dataUrl && (
        <img
          id="card-preview"
          src={preview.dataUrl}
          alt="Card preview"
          draggable={false}
          className="absolute inset-0 max-w-none pointer-events-none"
          style={{ width: cssW, height: cssH }}
        />
      )}

      {hovered && (
        <div
          className={`absolute pointer-events-none border ${hovered.visible === false ? 'border-dashed' : ''} border-accent/60`}
          style={box(hovered)}
        />
      )}

      {selected && (
        <div
          data-testid="selection"
          className={`absolute pointer-events-none border-2 ${selected.visible === false || selected.locked ? 'border-dashed' : ''} border-accent`}
          style={box(selected)}
        >
          {!selected.locked && HANDLES.map((h) => (
            <div
              key={h}
              data-handle={h}
              className="absolute w-2.5 h-2.5 bg-white border border-accent rounded-sm pointer-events-auto"
              style={{
                left: `calc(${HANDLE_POS[h][0] * 100}% - 5px)`,
                top: `calc(${HANDLE_POS[h][1] * 100}% - 5px)`,
                cursor: HANDLE_CURSOR[h],
              }}
            />
          ))}
        </div>
      )}

      {guides.x.map((x) => (
        <div key={`gx${x}`} className="absolute top-0 bottom-0 w-px bg-pink-500 pointer-events-none" style={{ left: x * cssScale }} />
      ))}
      {guides.y.map((y) => (
        <div key={`gy${y}`} className="absolute left-0 right-0 h-px bg-pink-500 pointer-events-none" style={{ top: y * cssScale }} />
      ))}
    </div>
  )
}
