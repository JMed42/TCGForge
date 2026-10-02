import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight, AlertTriangle,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Group, Ungroup,
} from 'lucide-react'
import { useStore } from '../../store'
import CardRender, { cardPixelSize } from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { isContainer } from '../../designer/schema/types.ts'
import { absoluteBox, findRef } from '../../designer/layout/tree.ts'
import {
  HANDLES, alignBoxes, bounds, contains, distributeBoxes, intersects, moveBox, rectFromPoints, resizeBox, roundBox, scaleInto, snapBox, snapTargets,
} from '../../designer/editor/geometry.ts'
import { deleteLayers, duplicateLayers, getLayer, groupLayers, isFramePositioned, setLayerRect, ungroup } from '../../designer/editor/ops.ts'

const CSS_PX_PER_MM = 96 / 25.4
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const SNAP_SCREEN_PX = 5
const DRAG_START_PX = 3
const FIT_MARGIN_PX = 48

const HANDLE_POS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }
const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

function ToolButton({ title, onClick, disabled, active, children, testid }) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`p-1 rounded ${active ? 'bg-surface-3 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'} disabled:opacity-30 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  )
}

/**
 * The Template Designer canvas (spec Phase 2): zoom, pan, bleed/trim/safe guides and grid,
 * select (click, Shift/Ctrl-click, marquee), drag, resize with snapping, align/distribute,
 * group/ungroup, a sample-card switcher. The card itself is CardRender, the same component the
 * exports use. All geometry is in mm, in trim coordinates.
 */
export default function DesignerCanvas() {
  const {
    draft, cards, previewCardId, activeProjectId, activeTemplateId, assetVersions, selectedIds,
    setSelection, toggleSelection, edit, beginGesture, editLive, stepPreviewCard, setPreviewCard,
  } = useStore()
  const fonts = useProjectFonts(activeProjectId, assetVersions)
  const viewportRef = useRef(null)
  const gestureRef = useRef(null)
  const spaceRef = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [show, setShow] = useState({ bleed: true, safe: true, grid: false })
  const [entered, setEntered] = useState(null) // container id whose children are being edited
  const [hoverId, setHoverId] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const [snapGuides, setSnapGuides] = useState({ x: [], y: [] })
  const [report, setReport] = useState(null)
  const [, forceMeasure] = useState(0)

  const card = cards.find((c) => c.id === previewCardId) || null
  const pxPerMm = CSS_PX_PER_MM * zoom
  const bleed = draft?.size.bleedMm ?? 0
  const sizeKey = draft ? `${draft.size.widthMm}x${draft.size.heightMm}x${bleed}` : ''

  // ---------------------------------------------------------------- view

  const fit = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !draft) return
    const wMm = draft.size.widthMm + 2 * bleed
    const hMm = draft.size.heightMm + 2 * bleed
    const z = clampZoom(Math.min((vp.clientWidth - FIT_MARGIN_PX * 2) / (wMm * CSS_PX_PER_MM), (vp.clientHeight - FIT_MARGIN_PX * 2) / (hMm * CSS_PX_PER_MM)))
    const px = CSS_PX_PER_MM * z
    // Whole pixels: a sub-pixel offset would rasterise differently from the export.
    setZoom(z)
    setPan({ x: Math.round((vp.clientWidth - wMm * px) / 2), y: Math.round((vp.clientHeight - hMm * px) / 2) })
  }, [draft, bleed])

  // Fit when a template opens or the card size changes.
  useLayoutEffect(() => { fit() }, [activeTemplateId, sizeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((next, clientX, clientY) => {
    const vp = viewportRef.current
    if (!vp) return
    const z = clampZoom(next)
    const r = vp.getBoundingClientRect()
    const cx = clientX ?? r.left + vp.clientWidth / 2
    const cy = clientY ?? r.top + vp.clientHeight / 2
    const ratio = z / zoom
    setPan((p) => ({ x: Math.round(cx - r.left - (cx - r.left - p.x) * ratio), y: Math.round(cy - r.top - (cy - r.top - p.y) * ratio) }))
    setZoom(z)
  }, [zoom])

  // Wheel: Ctrl zooms around the cursor; otherwise pans (Shift: horizontal). Non-passive.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
      else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX
        const dy = e.shiftKey ? 0 : e.deltaY
        setPan((p) => ({ x: Math.round(p.x - dx), y: Math.round(p.y - dy) }))
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoom, zoomAt])

  // ---------------------------------------------------------------- layers and boxes

  // Layers the pointer can pick: the entered container's children, otherwise the top level.
  const candidates = useMemo(() => {
    if (!draft) return []
    if (entered) {
      const c = getLayer(draft, entered)
      if (c && isContainer(c)) return c.children
    }
    return draft.layers
  }, [draft, entered])

  // Absolute box in mm: from the frame, or measured from the render for flow (stack) children.
  const boxOf = useCallback((id) => {
    if (!draft) return null
    const computed = absoluteBox(draft, id)
    if (computed) return computed
    const vp = viewportRef.current
    const root = vp?.querySelector('[data-card-root]')
    const el = root?.querySelector(`[data-layer-id="${CSS.escape(id)}"]`)
    if (!root || !el) return null
    const rr = root.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    return { x: (er.left - rr.left) / pxPerMm - bleed, y: (er.top - rr.top) / pxPerMm - bleed, w: er.width / pxPerMm, h: er.height / pxPerMm }
  }, [draft, pxPerMm, bleed])

  const isRendered = useCallback((id) => Boolean(viewportRef.current?.querySelector(`[data-card-root] [data-layer-id="${CSS.escape(id)}"]`)), [])

  const hitTest = useCallback((pt) => {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const l = candidates[i]
      if (l.hidden || l.locked || !isRendered(l.id)) continue
      const b = boxOf(l.id)
      if (b && contains(b, pt)) return l.id
    }
    return null
  }, [candidates, boxOf, isRendered])

  const toMm = useCallback((e) => {
    const r = viewportRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left - pan.x) / pxPerMm - bleed, y: (e.clientY - r.top - pan.y) / pxPerMm - bleed }
  }, [pan, pxPerMm, bleed])

  // Selected layers that can be moved on the canvas (frame-positioned, unlocked).
  const movable = useCallback((ids) => (draft ? ids.filter((id) => {
    const l = getLayer(draft, id)
    return l && !l.locked && isFramePositioned(draft, id)
  }) : []), [draft])

  const targetsExcluding = useCallback((ids) => {
    const skip = new Set(ids)
    const others = []
    for (const l of candidates) {
      if (skip.has(l.id) || l.hidden) continue
      const b = boxOf(l.id)
      if (b) others.push(b)
    }
    return snapTargets({ card: { w: draft.size.widthMm, h: draft.size.heightMm, bleed, safe: draft.size.safeMm }, others })
  }, [candidates, boxOf, draft, bleed])

  // ---------------------------------------------------------------- pointer

  const onPointerDown = (e) => {
    if (!draft) return
    const vp = viewportRef.current
    vp.focus({ preventScroll: true })
    const panning = e.button === 1 || (e.button === 0 && spaceRef.current)
    if (panning) {
      e.preventDefault()
      vp.setPointerCapture(e.pointerId)
      gestureRef.current = { mode: 'pan', origin: { x: e.clientX, y: e.clientY }, startPan: pan }
      return
    }
    if (e.button !== 0) return
    const pt = toMm(e)
    const handle = e.target.dataset?.handle
    const ids = movable(selectedIds)
    if (handle && ids.length) {
      const startBoxes = Object.fromEntries(ids.map((id) => [id, absoluteBox(draft, id)]))
      vp.setPointerCapture(e.pointerId)
      gestureRef.current = { mode: 'resize', handle, origin: pt, ids, startBoxes, startBounds: bounds(Object.values(startBoxes)), targets: targetsExcluding(ids), started: false }
      return
    }
    const hit = hitTest(pt)
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelection(hit); return }
      const sel = selectedIds.includes(hit) ? selectedIds : [hit]
      if (sel !== selectedIds) setSelection(sel)
      const moveIds = movable(sel)
      if (!moveIds.length) return
      const startBoxes = Object.fromEntries(moveIds.map((id) => [id, absoluteBox(draft, id)]))
      vp.setPointerCapture(e.pointerId)
      gestureRef.current = { mode: 'move', origin: pt, ids: moveIds, startBoxes, startBounds: bounds(Object.values(startBoxes)), targets: targetsExcluding(moveIds), started: false }
      return
    }
    // Empty canvas: marquee (Shift adds to the selection).
    vp.setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'marquee', origin: pt, base: e.shiftKey ? selectedIds : [], started: false }
    if (!e.shiftKey) setSelection([])
  }

  const onPointerMove = (e) => {
    const g = gestureRef.current
    if (!draft) return
    if (!g) {
      setHoverId(hitTest(toMm(e)))
      return
    }
    if (g.mode === 'pan') {
      setPan({ x: Math.round(g.startPan.x + e.clientX - g.origin.x), y: Math.round(g.startPan.y + e.clientY - g.origin.y) })
      return
    }
    const pt = toMm(e)
    const dx = pt.x - g.origin.x
    const dy = pt.y - g.origin.y
    if (!g.started) {
      if (Math.hypot(dx, dy) * pxPerMm < DRAG_START_PX) return
      g.started = true
      if (g.mode !== 'marquee') beginGesture() // one undo step per drag
    }
    if (g.mode === 'marquee') {
      const rect = rectFromPoints(g.origin, pt)
      setMarquee(rect)
      const hits = candidates.filter((l) => !l.hidden && !l.locked && isRendered(l.id) && (() => { const b = boxOf(l.id); return b && intersects(b, rect) })()).map((l) => l.id)
      setSelection([...new Set([...g.base, ...hits])])
      return
    }
    const threshold = SNAP_SCREEN_PX / pxPerMm
    const grid = show.grid ? 1 : null
    let target
    if (g.mode === 'move') {
      const moved = moveBox(g.startBounds, dx, dy, e.shiftKey)
      const snapped = e.altKey ? { box: roundBox(moved), guides: { x: [], y: [] } } : snapBox(moved, g.targets, threshold, null, grid)
      setSnapGuides(snapped.guides)
      const ddx = snapped.box.x - g.startBounds.x
      const ddy = snapped.box.y - g.startBounds.y
      target = Object.fromEntries(g.ids.map((id) => [id, roundBox({ ...g.startBoxes[id], x: g.startBoxes[id].x + ddx, y: g.startBoxes[id].y + ddy })]))
    } else {
      const resized = resizeBox(g.startBounds, g.handle, dx, dy, e.shiftKey)
      const noSnap = e.altKey || e.shiftKey
      const snapped = noSnap ? { box: roundBox(resized), guides: { x: [], y: [] } } : snapBox(resized, g.targets, threshold, g.handle, grid)
      setSnapGuides(snapped.guides)
      target = Object.fromEntries(g.ids.map((id) => [id, roundBox(g.ids.length === 1 ? snapped.box : scaleInto(g.startBoxes[id], g.startBounds, snapped.box))]))
    }
    editLive((t) => g.ids.reduce((acc, id) => setLayerRect(acc, id, target[id]), t))
  }

  const endGesture = (e) => {
    const vp = viewportRef.current
    if (gestureRef.current && vp?.hasPointerCapture?.(e.pointerId)) vp.releasePointerCapture(e.pointerId)
    gestureRef.current = null
    setMarquee(null)
    setSnapGuides({ x: [], y: [] })
  }

  // Double-click a group or stack to edit its children; on empty canvas, leave it.
  const onDoubleClick = (e) => {
    if (!draft) return
    const pt = toMm(e)
    const hit = hitTest(pt)
    const layer = hit && getLayer(draft, hit)
    if (layer && isContainer(layer)) {
      setEntered(layer.id)
      const inner = [...layer.children].reverse().find((c) => !c.hidden && !c.locked && isRendered(c.id) && (() => { const b = boxOf(c.id); return b && contains(b, pt) })())
      setSelection(inner ? [inner.id] : [])
    } else if (!hit && entered) {
      setSelection([entered])
      setEntered(null)
    }
  }

  // Leaving the entered container if it disappears or the template changes.
  useEffect(() => { setEntered(null) }, [activeTemplateId])
  useEffect(() => { if (entered && draft && !getLayer(draft, entered)) setEntered(null) }, [draft, entered])

  // ---------------------------------------------------------------- commands

  const selectionBoxes = useMemo(() => {
    if (!draft) return []
    return selectedIds.map((id) => ({ id, box: boxOf(id) })).filter((s) => s.box)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selectedIds, boxOf, report])

  const align = (mode) => {
    const ids = movable(selectedIds)
    if (!ids.length) return
    const boxes = ids.map((id) => absoluteBox(draft, id))
    const ref = ids.length === 1 ? { x: 0, y: 0, w: draft.size.widthMm, h: draft.size.heightMm } : bounds(boxes)
    const next = alignBoxes(boxes, mode, ref)
    edit((t) => ids.reduce((acc, id, i) => setLayerRect(acc, id, next[i]), t))
  }

  const distribute = (axis) => {
    const ids = movable(selectedIds)
    if (ids.length < 3) return
    const next = distributeBoxes(ids.map((id) => absoluteBox(draft, id)), axis)
    edit((t) => ids.reduce((acc, id, i) => setLayerRect(acc, id, next[i]), t))
  }

  const [notice, setNotice] = useState(null)
  const group = () => {
    const r = groupLayers(draft, selectedIds)
    if ('error' in r) { setNotice(r.error); return }
    edit(() => r.template, { select: [r.id] })
  }
  const ungroupSelected = () => {
    const id = selectedIds.length === 1 ? selectedIds[0] : null
    const r = id ? ungroup(draft, id) : { error: 'select one group' }
    if ('error' in r) { setNotice(r.error); return }
    edit(() => r.template, { select: r.ids })
  }
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t) }, [notice])

  const selectedLayer = selectedIds.length === 1 && draft ? getLayer(draft, selectedIds[0]) : null
  const movableCount = movable(selectedIds).length
  const canGroup = draft && selectedIds.length >= 1 && (() => { const p = new Set(selectedIds.map((id) => findRef(draft, id)?.parentId)); return p.size === 1 })()

  // Keyboard (ignored while typing in a field).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === ' ' && !isTyping(document.activeElement)) { spaceRef.current = true; if (document.activeElement === viewportRef.current) e.preventDefault() }
      const s = useStore.getState()
      if (!s.draft || isTyping(document.activeElement) || s.unsavedPrompt) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomAt(zoom * 1.25); return }
      if (mod && key === '-') { e.preventDefault(); zoomAt(zoom / 1.25); return }
      if (mod && key === '0') { e.preventDefault(); fit(); return }
      if (e.key === '[') { s.stepPreviewCard(-1); return }
      if (e.key === ']') { s.stepPreviewCard(1); return }
      if (mod && key === 'a') {
        e.preventDefault()
        s.setSelection(candidates.filter((l) => !l.hidden && !l.locked).map((l) => l.id))
        return
      }
      if (e.key === 'Escape') {
        if (entered) { s.setSelection([entered]); setEntered(null) } else s.setSelection([])
        return
      }
      const ids = s.selectedIds
      if (!ids.length) return
      if (mod && key === 'g' && !e.shiftKey) { e.preventDefault(); group(); return }
      if (mod && key === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelected(); return }
      if (mod && key === 'd') {
        e.preventDefault()
        const r = duplicateLayers(s.draft, ids)
        s.edit(() => r.template, { select: r.ids })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        s.edit((t) => deleteLayers(t, ids), { select: [] })
        return
      }
      const step = e.shiftKey ? 5 : 0.5
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      const moveIds = movable(ids)
      if (nudge && moveIds.length) {
        e.preventDefault()
        s.edit((t) => moveIds.reduce((acc, id) => {
          const b = absoluteBox(acc, id)
          return b ? setLayerRect(acc, id, roundBox({ ...b, x: b.x + nudge[0], y: b.y + nudge[1] })) : acc
        }, t), { key: `nudge:${moveIds.join(',')}` })
      }
    }
    const onKeyUp = (e) => { if (e.key === ' ') spaceRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }) // re-bound every render: handlers read fresh state

  const onReady = useCallback((r) => { setReport(r); forceMeasure((n) => n + 1) }, [])

  // ---------------------------------------------------------------- render

  if (!draft) return <div className="flex-1 bg-surface-0" />
  const cardPx = cardPixelSize(draft, pxPerMm, true)
  const origin = bleed * pxPerMm
  const toPx = (b) => ({ left: origin + b.x * pxPerMm, top: origin + b.y * pxPerMm, width: b.w * pxPerMm, height: b.h * pxPerMm })
  const selBounds = bounds(selectionBoxes.map((s) => s.box))
  const showHandles = movableCount > 0 && movableCount === selectedIds.length
  const hovered = hoverId && !selectedIds.includes(hoverId) ? boxOf(hoverId) : null
  const enteredBox = entered ? boxOf(entered) : null
  const cardIndex = cards.findIndex((c) => c.id === previewCardId)
  const gridStep = pxPerMm >= 6 ? 1 : 5

  return (
    <div className="flex-1 min-w-[320px] flex flex-col overflow-hidden bg-surface-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border text-xs text-text-secondary flex-wrap">
        <ToolButton title="Zoom out (Ctrl+-)" onClick={() => zoomAt(zoom / 1.25)}><ZoomOut size={15} /></ToolButton>
        <button type="button" data-testid="zoom-level" title="Actual size (100% = physical size at 96 dpi)" onClick={() => zoomAt(1)} className="w-12 text-center hover:text-text-primary">
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton title="Zoom in (Ctrl+=)" onClick={() => zoomAt(zoom * 1.25)}><ZoomIn size={15} /></ToolButton>
        <ToolButton title="Fit (Ctrl+0)" onClick={fit} testid="zoom-fit"><Maximize size={15} /></ToolButton>
        <div className="w-px h-5 bg-border mx-1" />
        {[['bleed', 'Bleed'], ['safe', 'Safe'], ['grid', 'Grid']].map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-testid={`guide-${k}`}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            className={`px-1.5 py-0.5 rounded ${show[k] ? 'bg-surface-3 text-accent' : 'hover:bg-surface-2'}`}
          >
            {label}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        <ToolButton title="Align left" testid="align-left" disabled={!movableCount} onClick={() => align('left')}><AlignStartVertical size={15} /></ToolButton>
        <ToolButton title="Align centre" testid="align-hcenter" disabled={!movableCount} onClick={() => align('hcenter')}><AlignCenterVertical size={15} /></ToolButton>
        <ToolButton title="Align right" testid="align-right" disabled={!movableCount} onClick={() => align('right')}><AlignEndVertical size={15} /></ToolButton>
        <ToolButton title="Align top" testid="align-top" disabled={!movableCount} onClick={() => align('top')}><AlignStartHorizontal size={15} /></ToolButton>
        <ToolButton title="Align middle" testid="align-vcenter" disabled={!movableCount} onClick={() => align('vcenter')}><AlignCenterHorizontal size={15} /></ToolButton>
        <ToolButton title="Align bottom" testid="align-bottom" disabled={!movableCount} onClick={() => align('bottom')}><AlignEndHorizontal size={15} /></ToolButton>
        <ToolButton title="Distribute horizontally" testid="distribute-x" disabled={movableCount < 3} onClick={() => distribute('x')}><AlignHorizontalDistributeCenter size={15} /></ToolButton>
        <ToolButton title="Distribute vertically" testid="distribute-y" disabled={movableCount < 3} onClick={() => distribute('y')}><AlignVerticalDistributeCenter size={15} /></ToolButton>
        <ToolButton title="Group (Ctrl+G)" testid="group" disabled={!canGroup} onClick={group}><Group size={15} /></ToolButton>
        <ToolButton title="Ungroup (Ctrl+Shift+G)" testid="ungroup" disabled={selectedLayer?.type !== 'group'} onClick={ungroupSelected}><Ungroup size={15} /></ToolButton>
        <div className="flex-1" />
        {/* Sample-card switcher: step through real cards ([ and ]). */}
        <ToolButton title="Previous card ([)" testid="card-prev" disabled={!cards.length} onClick={() => stepPreviewCard(-1)}><ChevronLeft size={15} /></ToolButton>
        <select
          data-testid="sample-card"
          value={previewCardId ?? ''}
          onChange={(e) => setPreviewCard(Number(e.target.value))}
          className="max-w-[12rem] px-1.5 py-0.5 bg-surface-2 border border-border rounded text-xs text-text-primary focus:outline-none"
        >
          {cards.length === 0 && <option value="">No cards</option>}
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="tabular-nums">{cards.length ? `${cardIndex + 1}/${cards.length}` : ''}</span>
        <ToolButton title="Next card (])" testid="card-next" disabled={!cards.length} onClick={() => stepPreviewCard(1)}><ChevronRight size={15} /></ToolButton>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        id="designer-viewport"
        tabIndex={0}
        className="relative flex-1 overflow-hidden outline-none select-none"
        style={{ cursor: gestureRef.current?.mode === 'pan' || spaceRef.current ? 'grab' : hoverId ? 'move' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={() => !gestureRef.current && setHoverId(null)}
        onDoubleClick={onDoubleClick}
        onAuxClick={(e) => e.preventDefault()}
      >
        {fonts.ready && (
          <div
            id="card-stage"
            data-px-per-mm={pxPerMm}
            data-zoom={zoom}
            className="absolute shadow-2xl"
            style={{ left: pan.x, top: pan.y, width: cardPx.width, height: cardPx.height }}
          >
            <CardRender template={draft} card={card} projectId={activeProjectId} pxPerMm={pxPerMm} showBleed assetVersions={assetVersions} onReady={onReady} />

            {/* Guides */}
            <div className="absolute inset-0 pointer-events-none" data-testid="guides">
              {show.bleed && bleed > 0 && <div data-guide="bleed" className="absolute inset-0 border border-dashed border-red-400/90" />}
              <div
                data-guide="trim"
                className="absolute border border-white/80"
                style={{ ...toPx({ x: 0, y: 0, w: draft.size.widthMm, h: draft.size.heightMm }), borderRadius: (draft.size.cornerRadiusMm || 0) * pxPerMm }}
              />
              {show.safe && draft.size.safeMm > 0 && (
                <div
                  data-guide="safe"
                  className="absolute border border-dashed border-sky-400/90"
                  style={toPx({ x: draft.size.safeMm, y: draft.size.safeMm, w: draft.size.widthMm - 2 * draft.size.safeMm, h: draft.size.heightMm - 2 * draft.size.safeMm })}
                />
              )}
              {show.grid && (
                <div
                  data-guide="grid"
                  className="absolute"
                  style={{
                    ...toPx({ x: 0, y: 0, w: draft.size.widthMm, h: draft.size.heightMm }),
                    backgroundImage: `linear-gradient(to right, rgba(124,110,240,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(124,110,240,0.25) 1px, transparent 1px)`,
                    backgroundSize: `${gridStep * pxPerMm}px ${gridStep * pxPerMm}px`,
                  }}
                />
              )}
            </div>

            {/* Selection and interaction overlay */}
            <div className="absolute inset-0 pointer-events-none">
              {enteredBox && <div className="absolute border border-dashed border-accent/60" style={toPx(enteredBox)} />}
              {hovered && <div className="absolute border border-accent/60" style={toPx(hovered)} />}
              {selectionBoxes.map(({ id, box }) => {
                const l = getLayer(draft, id)
                return (
                  <div
                    key={id}
                    data-selected={id}
                    className={`absolute border-2 ${l?.hidden || l?.locked || !isRendered(id) ? 'border-dashed' : ''} border-accent`}
                    style={toPx(box)}
                  />
                )
              })}
              {selBounds && showHandles && (
                <div data-testid="selection-bounds" className="absolute" style={toPx(selBounds)}>
                  {HANDLES.map((h) => (
                    <div
                      key={h}
                      data-handle={h}
                      className="absolute w-2.5 h-2.5 bg-white border border-accent rounded-sm pointer-events-auto"
                      style={{ left: `calc(${HANDLE_POS[h][0] * 100}% - 5px)`, top: `calc(${HANDLE_POS[h][1] * 100}% - 5px)`, cursor: HANDLE_CURSOR[h] }}
                    />
                  ))}
                </div>
              )}
              {marquee && <div data-testid="marquee" className="absolute border border-accent bg-accent/10" style={toPx(marquee)} />}
              {snapGuides.x.map((x) => (
                <div key={`gx${x}`} data-snap-guide="x" className="absolute w-px bg-pink-500" style={{ left: origin + x * pxPerMm, top: 0, bottom: 0 }} />
              ))}
              {snapGuides.y.map((y) => (
                <div key={`gy${y}`} data-snap-guide="y" className="absolute h-px bg-pink-500" style={{ top: origin + y * pxPerMm, left: 0, right: 0 }} />
              ))}
            </div>
          </div>
        )}
        {notice && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded bg-surface-2 border border-border text-xs text-text-primary shadow">{notice}</div>
        )}
        {entered && (
          <div className="absolute left-3 top-3 px-2 py-1 rounded bg-surface-2/90 border border-border text-[11px] text-text-secondary">
            Editing inside <span className="text-accent font-mono">{entered}</span> · Esc to leave
          </div>
        )}
      </div>

      {report?.warnings?.length > 0 && (
        <div className="border-t border-border px-4 py-2 max-h-24 overflow-y-auto space-y-0.5" data-testid="render-warnings">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning flex gap-2">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

