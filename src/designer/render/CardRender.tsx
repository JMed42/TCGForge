// The one card renderer (spec, "Architecture": React DOM, absolutely positioned elements in a
// fixed-size container measured in mm). The Designer canvas, the PNG export and the PDF/print
// sheets all render through this component, so what the editor shows is what exports.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Box, ImageLayer, Layer, ShapeLayer, StackLayer, GroupLayer, Template, TextLayer, IconRepeatLayer } from '../schema/types.ts'
import { resolveFrame, lengthMm } from '../layout/frame.ts'
import { condition, interpolate } from '../expr/expr.ts'
import type { Scope } from '../expr/expr.ts'
import { cardScope } from '../expr/scope.ts'
import { assetUrl, checkSrc } from './assetUrl.ts'
import type { AssetVersions } from './assetUrl.ts'
import { parseRichText } from './markup.ts'
import { fitText, ptToPx, DEFAULT_MIN_PT } from './fitText.ts'
import type { FitResult } from './fitText.ts'

export interface RenderReport {
  warnings: string[]
  fits: Record<string, FitResult>
}

export interface CardRenderProps {
  template: Template
  card: Record<string, unknown> | null
  projectId: number
  pxPerMm: number
  showBleed?: boolean // include the bleed area (print / editor); otherwise trim size with rounded corners
  assetVersions?: AssetVersions
  onReady?: (report: RenderReport) => void // fonts loaded, images settled, text fitted
}

interface Ctx {
  projectId: number
  pxPerMm: number
  scope: Scope
  versions?: AssetVersions
  fontsReady: boolean
  warn: (id: string, msg: string) => void
  fitted: (id: string, r: FitResult) => void
}

const RenderCtx = createContext<Ctx | null>(null)
const useRender = () => useContext(RenderCtx)!

const DEFAULT_PT = 9
const DEFAULT_LINE_HEIGHT = 1.2

// ------------------------------------------------------------------------- fonts

function fontDescriptors(layers: Layer[], out = new Set<string>()): Set<string> {
  for (const l of layers) {
    if (l.type === 'text' || l.type === 'richText') {
      const s = l.style || {}
      const family = s.font || 'sans-serif'
      out.add(`${s.italic ? 'italic' : 'normal'} ${s.weight ?? 400} 16px "${family}"`)
      if (l.type === 'richText') out.add(`italic ${s.weight ?? 400} 16px "${family}"`).add(`normal 700 16px "${family}"`)
    }
    if (l.type === 'stack' || l.type === 'group') fontDescriptors(l.children, out)
  }
  return out
}

// Resolves once every font the template uses is loaded (project fonts are FontFaces registered
// by useProjectFonts; system fonts resolve immediately).
function useFontsReady(template: Template, epoch: number): boolean {
  const key = useMemo(() => [...fontDescriptors(template.layers)].sort().join('|'), [template])
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const descs = key ? key.split('|') : []
    Promise.all(descs.map((d) => document.fonts.load(d).catch(() => [])))
      .then(() => document.fonts.ready)
      .then(() => { if (!cancelled) setReady(`${key}#${epoch}`) })
    return () => { cancelled = true }
  }, [key, epoch])
  return ready === `${key}#${epoch}`
}

// ------------------------------------------------------------------------- layer views

function boxStyle(box: Box, pxPerMm: number): CSSProperties {
  return { position: 'absolute', left: box.x * pxPerMm, top: box.y * pxPerMm, width: box.w * pxPerMm, height: box.h * pxPerMm }
}

interface Placement {
  parent: Box | null // local parent box in mm (null = inside a stack, flow layout)
  stackDirection?: 'vertical' | 'horizontal'
}

function placementStyle(layer: Layer, place: Placement, pxPerMm: number): { style: CSSProperties; box: Box | null } {
  if (place.parent) {
    const box = resolveFrame(layer.frame, place.parent)
    return { style: boxStyle(box, pxPerMm), box }
  }
  // Flow child of a stack: full cross-axis size, main-axis size from the frame or content.
  const vertical = place.stackDirection !== 'horizontal'
  const f = layer.frame || {}
  const main = vertical ? lengthMm(f.height, 0) : lengthMm(f.width, 0)
  const style: CSSProperties = { position: 'relative', flex: '0 0 auto' }
  if (vertical) { style.width = '100%'; if (main !== undefined) style.height = main * pxPerMm }
  else { style.height = '100%'; if (main !== undefined) style.width = main * pxPerMm }
  return { style, box: null }
}

function TextView({ layer, place }: { layer: TextLayer; place: Placement }) {
  const { scope, pxPerMm, fontsReady, warn, fitted } = useRender()
  const s = layer.style || {}
  const { text, errors } = useMemo(() => interpolate(layer.text, scope), [layer.text, scope])
  useEffect(() => { for (const e of errors) warn(layer.id, e) }, [errors, layer.id, warn])
  const { style: outer, box } = placementStyle(layer, place, pxPerMm)
  const basePt = s.sizePt ?? DEFAULT_PT
  const baseLh = s.lineHeight ?? DEFAULT_LINE_HEIGHT
  const wrap = s.wrap !== false
  const fit = layer.fit || {}
  const strategy = fit.strategy || []
  const minPt = Math.min(fit.minPt ?? DEFAULT_MIN_PT, basePt)
  const maxPt = fit.maxPt
  const startPt = maxPt !== undefined ? Math.min(basePt, maxPt) : basePt
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<FitResult | null>(null)
  const boxKey = box ? `${box.w.toFixed(4)}x${box.h.toFixed(4)}` : 'flow'

  // Fit by measuring the real layout (synchronous, before paint).
  useLayoutEffect(() => {
    const c = containerRef.current
    const inner = innerRef.current
    if (!c || !inner) return
    if (!box || !fontsReady) {
      const r: FitResult = { status: 'fits', pt: startPt, lineHeight: baseLh }
      setResult(r)
      if (fontsReady) fitted(layer.id, r)
      return
    }
    const overflows = (pt: number, lh: number) => {
      inner.style.fontSize = `${ptToPx(pt, pxPerMm)}px`
      inner.style.lineHeight = String(lh)
      return inner.offsetHeight > c.clientHeight + 0.5 || inner.scrollWidth > c.clientWidth + 0.5
    }
    const r = fitText(startPt, baseLh, minPt, strategy, overflows)
    inner.style.fontSize = ''
    inner.style.lineHeight = ''
    setResult(r)
    fitted(layer.id, r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, startPt, baseLh, minPt, strategy.join(','), boxKey, pxPerMm, fontsReady, s.font, s.weight, s.italic, wrap, layer.type])

  const pt = result?.pt ?? startPt
  const lh = result?.lineHeight ?? baseLh
  const justify = s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start'
  const innerStyle: CSSProperties = {
    fontFamily: s.font ? `"${s.font}", sans-serif` : 'sans-serif',
    fontSize: ptToPx(pt, pxPerMm),
    fontWeight: s.weight ?? 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    color: s.color || '#000000',
    textAlign: s.align || 'left',
    lineHeight: lh,
    letterSpacing: s.letterSpacingPt ? ptToPx(s.letterSpacingPt, pxPerMm) : undefined,
    whiteSpace: wrap ? 'pre-wrap' : 'pre',
    overflowWrap: wrap ? 'break-word' : undefined,
    width: wrap ? '100%' : 'max-content',
    minWidth: wrap ? undefined : '100%',
  }
  const hidden = result?.status === 'hidden' || !text
  return (
    <div
      ref={containerRef}
      data-layer-id={layer.id}
      style={{
        ...outer,
        display: hidden && !box ? 'none' : 'flex',
        visibility: hidden ? 'hidden' : undefined,
        flexDirection: 'column',
        justifyContent: justify,
        overflow: box ? 'hidden' : 'visible',
        opacity: layer.opacity,
      }}
    >
      <div ref={innerRef} style={innerStyle}>
        {layer.type === 'richText'
          ? parseRichText(text).map((runs, i) => (
              <div key={i} style={{ minHeight: '1em' }}>
                {runs.map((r, j) => (
                  <span key={j} style={{ fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? 'italic' : undefined }}>{r.text}</span>
                ))}
              </div>
            ))
          : text}
      </div>
    </div>
  )
}

function Placeholder({ radius }: { radius?: number }) {
  return (
    <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={{ display: 'block', borderRadius: radius }}>
      <rect x="0" y="0" width="100" height="100" fill="#3a3d52" />
      <path d="M0 0 L100 100 M100 0 L0 100" stroke="#5c6078" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const TILE_SOURCE_DPI = 300 // tile images repeat at their natural size assuming 300 dpi (ext)

function ImageView({ layer, place }: { layer: ImageLayer; place: Placement }) {
  const { scope, pxPerMm, projectId, versions, warn } = useRender()
  const { style: outer } = placementStyle(layer, place, pxPerMm)
  const { text: src, errors } = useMemo(() => interpolate(layer.src, scope), [layer.src, scope])
  const check = checkSrc(src)
  const [failed, setFailed] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const url = check.ok ? assetUrl(projectId, check.rel, versions) : null
  useEffect(() => { setFailed(null); setNatural(null) }, [url])
  useEffect(() => {
    for (const e of errors) warn(layer.id, e)
    if (!check.ok && check.reason !== 'empty') warn(layer.id, check.reason)
    if (failed) warn(layer.id, `image not found (${failed})`)
  }, [errors, check.ok, failed, layer.id, warn]) // eslint-disable-line react-hooks/exhaustive-deps
  const radius = layer.radiusMm ? layer.radiusMm * pxPerMm : undefined
  const showPlaceholder = !url || failed
  const tile = layer.objectFit === 'tile'
  return (
    <div data-layer-id={layer.id} style={{ ...outer, overflow: 'hidden', borderRadius: radius, opacity: layer.opacity }}>
      {showPlaceholder ? (
        layer.placeholder === 'none' ? null : <Placeholder radius={radius} />
      ) : tile ? (
        <>
          <img
            src={url!}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(src)}
            style={{ display: 'none' }}
          />
          {natural && (
            <div
              style={{
                width: '100%', height: '100%',
                backgroundImage: `url("${url}")`, backgroundRepeat: 'repeat',
                backgroundSize: `${(natural.w / TILE_SOURCE_DPI) * 25.4 * pxPerMm}px ${(natural.h / TILE_SOURCE_DPI) * 25.4 * pxPerMm}px`,
              }}
            />
          )}
        </>
      ) : (
        <img
          src={url!}
          alt=""
          draggable={false}
          onError={() => setFailed(src)}
          style={{
            display: 'block', width: '100%', height: '100%',
            objectFit: layer.objectFit === 'fill' ? 'fill' : layer.objectFit === 'contain' ? 'contain' : 'cover',
            objectPosition: layer.objectPosition || '50% 50%',
          }}
        />
      )}
    </div>
  )
}

function ShapeView({ layer, place }: { layer: ShapeLayer; place: Placement }) {
  const { pxPerMm } = useRender()
  const { style: outer, box } = placementStyle(layer, place, pxPerMm)
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(box ? { w: box.w * pxPerMm, h: box.h * pxPerMm } : null)
  useLayoutEffect(() => {
    if (box) setSize({ w: box.w * pxPerMm, h: box.h * pxPerMm })
    else if (ref.current) setSize({ w: ref.current.clientWidth, h: ref.current.clientHeight })
  }, [box?.w, box?.h, pxPerMm]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = size?.w ?? 0
  const h = size?.h ?? 0
  const sw = (layer.strokeMm ?? 0) * pxPerMm
  const stroke = layer.stroke && sw > 0 ? layer.stroke : 'none'
  const fill = layer.fill || 'none'
  return (
    <div ref={ref} data-layer-id={layer.id} style={{ ...outer, opacity: layer.opacity }}>
      {size && (
        // Stroke is centred on the shape's edge, as in the Phase 0 renderer.
        <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
          {layer.shape === 'ellipse' ? (
            <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
          ) : (
            <rect
              x={0} y={0} width={w} height={h}
              rx={layer.shape === 'roundRect' ? Math.min((layer.radiusMm ?? 0) * pxPerMm, w / 2, h / 2) : 0}
              fill={fill} stroke={stroke} strokeWidth={sw}
            />
          )}
        </svg>
      )}
    </div>
  )
}

function IconRepeatView({ layer, place }: { layer: IconRepeatLayer; place: Placement }) {
  const { pxPerMm } = useRender()
  const { style: outer } = placementStyle(layer, place, pxPerMm)
  // Symbols and icon repeaters arrive in Phase 4; until then the element shows where it sits.
  return <div data-layer-id={layer.id} style={{ ...outer, outline: '1px dashed rgba(124,110,240,0.8)', opacity: layer.opacity }} />
}

function ContainerView({ layer, place }: { layer: StackLayer | GroupLayer; place: Placement }) {
  const { pxPerMm } = useRender()
  const { style: outer, box } = placementStyle(layer, place, pxPerMm)
  if (layer.type === 'group') {
    const local: Box | null = box ? { x: 0, y: 0, w: box.w, h: box.h } : null
    return (
      <div data-layer-id={layer.id} style={{ ...outer, opacity: layer.opacity }}>
        {local && <Layers layers={layer.children} place={{ parent: local }} />}
      </div>
    )
  }
  const vertical = layer.direction !== 'horizontal'
  return (
    <div
      data-layer-id={layer.id}
      style={{
        ...outer,
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        gap: (layer.gapMm ?? 0) * pxPerMm,
        overflow: 'hidden',
        opacity: layer.opacity,
      }}
    >
      <Layers layers={layer.children} place={{ parent: null, stackDirection: layer.direction || 'vertical' }} />
    </div>
  )
}

function LayerView({ layer, place }: { layer: Layer; place: Placement }) {
  const { scope, warn } = useRender()
  const visible = useMemo(() => condition(layer.visibleIf, scope), [layer.visibleIf, scope])
  useEffect(() => { if (visible.error) warn(layer.id, `visibleIf: ${visible.error}`) }, [visible.error, layer.id, warn])
  if (layer.hidden || !visible.value) return null
  switch (layer.type) {
    case 'text':
    case 'richText': return <TextView layer={layer} place={place} />
    case 'image': return <ImageView layer={layer} place={place} />
    case 'shape': return <ShapeView layer={layer} place={place} />
    case 'iconRepeat': return <IconRepeatView layer={layer} place={place} />
    case 'stack':
    case 'group': return <ContainerView layer={layer} place={place} />
    default: return null
  }
}

function Layers({ layers, place }: { layers: Layer[]; place: Placement }): ReactNode {
  return <>{layers.map((l) => <LayerView key={l.id} layer={l} place={place} />)}</>
}

// ------------------------------------------------------------------------- root

export function cardPixelSize(template: Template, pxPerMm: number, showBleed: boolean) {
  const b = showBleed ? template.size.bleedMm : 0
  return { width: (template.size.widthMm + 2 * b) * pxPerMm, height: (template.size.heightMm + 2 * b) * pxPerMm }
}

export default function CardRender({ template, card, projectId, pxPerMm, showBleed = false, assetVersions, onReady }: CardRenderProps) {
  const scope = useMemo(() => cardScope(card), [card])
  const [fontEpoch, setFontEpoch] = useState(0)
  const fontsReady = useFontsReady(template, fontEpoch)
  const rootRef = useRef<HTMLDivElement>(null)
  const warningsRef = useRef(new Map<string, string>())
  const fitsRef = useRef(new Map<string, FitResult>())

  // A project font finishing loading changes metrics: refit.
  useEffect(() => {
    const onDone = () => setFontEpoch((e) => e + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [])

  const ctx = useMemo<Ctx>(() => {
    warningsRef.current = new Map()
    fitsRef.current = new Map()
    return {
      projectId, pxPerMm, scope, versions: assetVersions, fontsReady,
      warn: (id, msg) => { warningsRef.current.set(`${id}: ${msg}`, `${id}: ${msg}`) },
      fitted: (id, r) => { fitsRef.current.set(id, r) },
    }
  }, [projectId, pxPerMm, scope, assetVersions, fontsReady, template])

  // Ready = fonts loaded, every <img> settled, two frames painted.
  useEffect(() => {
    if (!onReady || !fontsReady) return
    let cancelled = false
    const root = rootRef.current
    const imgs = root ? [...root.querySelectorAll('img')] : []
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((res) => {
      img.addEventListener('load', () => res(), { once: true })
      img.addEventListener('error', () => res(), { once: true })
    }))))
      .then(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))))
      .then(() => {
        if (cancelled) return
        // A late image swap (tile measuring, a failed load) re-renders; give it a frame too.
        requestAnimationFrame(() => {
          if (cancelled) return
          onReady({ warnings: [...warningsRef.current.values()], fits: Object.fromEntries(fitsRef.current) })
        })
      })
    return () => { cancelled = true }
  }, [ctx, onReady, fontsReady, template, card])

  const { width, height } = cardPixelSize(template, pxPerMm, showBleed)
  const bleed = showBleed ? template.size.bleedMm : 0
  const trim: Box = { x: 0, y: 0, w: template.size.widthMm, h: template.size.heightMm }
  const radius = !showBleed && template.size.cornerRadiusMm ? template.size.cornerRadiusMm * pxPerMm : 0

  return (
    <RenderCtx.Provider value={ctx}>
      <div
        ref={rootRef}
        data-card-root=""
        data-fonts-ready={fontsReady ? '1' : '0'}
        style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: radius, background: 'transparent' }}
      >
        <div style={{ position: 'absolute', left: bleed * pxPerMm, top: bleed * pxPerMm, width: trim.w * pxPerMm, height: trim.h * pxPerMm }}>
          <Layers layers={template.layers} place={{ parent: trim }} />
        </div>
      </div>
    </RenderCtx.Provider>
  )
}
