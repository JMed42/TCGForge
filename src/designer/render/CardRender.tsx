// The one card renderer (spec, "Architecture": React DOM, absolutely positioned elements in a
// fixed-size container measured in mm). The Designer canvas, the PNG export and the PDF/print
// sheets all render through this component, so what the editor shows is what exports.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Box, ImageLayer, Layer, ShapeLayer, StackLayer, GroupLayer, Template, TextLayer, IconRepeatLayer } from '../schema/types.ts'
import { resolveFrame, lengthMm } from '../layout/frame.ts'
import { condition, evaluate, interpolate, toText } from '../expr/expr.ts'
import type { Scope } from '../expr/expr.ts'
import { cardScope } from '../expr/scope.ts'
import { assetUrl, checkSrc } from './assetUrl.ts'
import type { AssetVersions } from './assetUrl.ts'
import { parseRichText, parseSymbols } from './markup.ts'
import type { Run } from './markup.ts'
import { useLibrary } from '../library/LibraryContext.ts'
import { remindersOn } from '../library/library.ts'
import type { RenderLibrary, RenderSymbol } from '../library/library.ts'
import { applyKeywords } from '../library/keywords.ts'
import { variableRefs } from '../library/variables.ts'
import { repeatCount, repeatPositions } from '../library/iconRepeat.ts'
import { fitStack, fitText, ptToPx, DEFAULT_MIN_PT } from './fitText.ts'
import type { FitResult, StackItem, StackMeasure, StackState } from './fitText.ts'

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
  // Measure-only (fit checks): images whose size is set by their frame are not loaded, and
  // onFits reports the fit results as soon as layout is done.
  measureOnly?: boolean
  onFits?: (fits: Record<string, FitResult>) => void
}

interface Ctx {
  projectId: number
  pxPerMm: number
  scope: Scope
  versions?: AssetVersions
  fontsReady: boolean
  measureOnly: boolean
  library: RenderLibrary // symbols, keywords, variables (LibraryContext)
  reminders: boolean // keyword reminder text on for this card (its own choice, its set, the project)
  epoch: string // changes when layout can move without a prop change (fonts, images loading)
  warn: (id: string, msg: string) => void
  fitted: (id: string, r: FitResult) => void
  unfit: (id: string) => void
  imagePending: (id: string, pending: boolean) => void
}

const RenderCtx = createContext<Ctx | null>(null)
const useRender = () => useContext(RenderCtx)!

// Decisions of the nearest stack that fits its text (StackView), by layer id.
const StackFitCtx = createContext<Map<string, StackState> | null>(null)

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

interface Placed {
  style: CSSProperties
  box: Box | null
  fixedW: boolean // the width is set (frame, or the stack's cross axis)
  fixedH: boolean
}

function placementStyle(layer: Layer, place: Placement, pxPerMm: number): Placed {
  if (place.parent) {
    const box = resolveFrame(layer.frame, place.parent)
    return { style: boxStyle(box, pxPerMm), box, fixedW: true, fixedH: true }
  }
  // Flow child of a stack: full cross-axis size, main-axis size from the frame or content.
  const vertical = place.stackDirection !== 'horizontal'
  const f = layer.frame || {}
  const main = vertical ? lengthMm(f.height, 0) : lengthMm(f.width, 0)
  const style: CSSProperties = { position: 'relative', flex: '0 0 auto' }
  if (vertical) { style.width = '100%'; if (main !== undefined) style.height = main * pxPerMm }
  else { style.height = '100%'; if (main !== undefined) style.width = main * pxPerMm }
  return { style, box: null, fixedW: vertical || main !== undefined, fixedH: !vertical || main !== undefined }
}

// An inline symbol: a box of the symbol's size in em (so layout never waits for the image) on the
// baseline, moved by its offset. Measure-only renders keep the box and skip the image.
function SymbolView({ sym, layerId }: { sym: RenderSymbol; layerId: string }) {
  const { projectId, versions, measureOnly, warn } = useRender()
  const style: CSSProperties = { display: 'inline-block', height: `${sym.scale}em`, width: `${sym.scale * sym.aspect}em`, verticalAlign: `${sym.offset}em` }
  if (measureOnly) return <span data-symbol={sym.code} style={style} />
  return (
    <img
      data-symbol={sym.code}
      src={assetUrl(projectId, sym.relPath, versions)}
      alt=""
      draggable={false}
      style={{ ...style, objectFit: 'contain' }}
      onError={() => warn(layerId, `symbol {${sym.code}}: image not found (${sym.relPath})`)}
    />
  )
}

function TextView({ layer, place }: { layer: TextLayer; place: Placement }) {
  const { scope, pxPerMm, fontsReady, warn, fitted, unfit, library, reminders } = useRender()
  const decisions = useContext(StackFitCtx)
  const s = layer.style || {}
  const rich = layer.type === 'richText'
  // Bindings, then keyword reminder text (when the layer asks for it), then markup and symbols.
  const { text, errors, runs } = useMemo(() => {
    const r = interpolate(layer.text, scope)
    let out = r.text
    const errs = [...r.errors]
    if (layer.keywords && reminders && library.keywords.length) {
      const k = applyKeywords(out, library.keywords, scope, { markup: rich })
      out = k.text
      errs.push(...k.errors)
    }
    for (const key of variableRefs(out)) errs.push(`unknown variable ${key}`)
    const unknown: string[] = []
    const opts = { symbols: library.symbols, unknown }
    const parsed = rich ? parseRichText(out, opts) : out.includes('{') ? [parseSymbols(out, opts)] : null
    if (library.symbols.size) for (const code of unknown) errs.push(`unknown symbol {${code}}`)
    return { text: out, errors: errs, runs: parsed }
  }, [layer.text, layer.keywords, rich, scope, library, reminders])
  useEffect(() => { for (const e of errors) warn(layer.id, e) }, [errors, layer.id, warn])
  const { style: outer, box, fixedW, fixedH } = placementStyle(layer, place, pxPerMm)
  // Text with a size of its own fits itself; text that sizes to its content inside a stack is
  // fitted by the stack (StackView), together with its siblings.
  const selfFit = fixedW && fixedH
  const inStack = !selfFit && place.parent === null
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
  const boxKey = box ? `${box.w.toFixed(4)}x${box.h.toFixed(4)}` : `flow:${String(outer.width ?? '')}x${String(outer.height ?? '')}`

  // Fit by measuring the real layout (synchronous, before paint).
  useLayoutEffect(() => {
    const c = containerRef.current
    const inner = innerRef.current
    if (!selfFit || !c || !inner || !fontsReady || !text) { setResult(null); return }
    // Measure by setting sizes directly on the element, then put back exactly what React rendered:
    // React only re-applies a style when its value changes, so clearing it would leave the text
    // at the inherited size.
    const prevSize = inner.style.fontSize
    const prevLh = inner.style.lineHeight
    const prevMinWidth = inner.style.minWidth
    // A single line is laid out at least as wide as its box (for alignment); measure its own width.
    if (!wrap) inner.style.minWidth = '0px'
    const measure = (pt: number, lh: number) => {
      inner.style.fontSize = `${ptToPx(pt, pxPerMm)}px`
      inner.style.lineHeight = String(lh)
      const cr = c.getBoundingClientRect()
      const ir = inner.getBoundingClientRect()
      return { needH: ir.height, roomH: cr.height, needW: Math.max(ir.width, inner.scrollWidth), roomW: cr.width }
    }
    const r = fitText({ basePt: startPt, baseLineHeight: baseLh, minPt, strategy }, measure, pxPerMm, wrap)
    inner.style.fontSize = prevSize
    inner.style.lineHeight = prevLh
    inner.style.minWidth = prevMinWidth
    setResult(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfFit, text, startPt, baseLh, minPt, strategy.join(','), boxKey, pxPerMm, fontsReady, s.font, s.weight, s.italic, s.letterSpacingPt, wrap, layer.type, library.signature])

  // Report the result (stack children are reported by their stack).
  useLayoutEffect(() => {
    if (inStack || !result || !fontsReady) return undefined
    fitted(layer.id, result)
    return () => unfit(layer.id)
  }, [inStack, result, fontsReady, fitted, unfit, layer.id])

  const decided = inStack ? decisions?.get(layer.id) : undefined
  const pt = decided?.pt ?? result?.pt ?? startPt
  const lh = decided?.lineHeight ?? result?.lineHeight ?? baseLh
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
  const hidden = (inStack ? decided?.hidden : result?.status === 'hidden') || !text
  // What the stack needs to fit this layer (read from the DOM by StackView).
  // `look` is only there so that a font or style change makes the stack fit again.
  const policy = inStack && text
    ? JSON.stringify({ basePt: startPt, baseLineHeight: baseLh, minPt, strategy, priority: layer.priority ?? 0, look: [layer.type, s.font, s.weight, s.italic, s.letterSpacingPt, s.wrap, s.align, library.signature] })
    : undefined
  const runView = (r: Run, j: number) => {
    const sym = r.symbol ? library.symbols.get(r.symbol) : undefined
    if (sym) return <SymbolView key={j} sym={sym} layerId={layer.id} />
    return rich ? <span key={j} style={{ fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? 'italic' : undefined }}>{r.text}</span> : <span key={j}>{r.text}</span>
  }
  return (
    <div
      ref={containerRef}
      data-layer-id={layer.id}
      data-fit-item={policy ? layer.id : undefined}
      data-fit-policy={policy}
      style={{
        ...outer,
        display: hidden && !box ? 'none' : 'flex',
        visibility: hidden ? 'hidden' : undefined,
        flexDirection: 'column',
        justifyContent: justify,
        overflow: selfFit ? 'hidden' : 'visible',
        opacity: layer.opacity,
      }}
    >
      <div ref={innerRef} data-fit-inner="" style={innerStyle}>
        {rich
          ? runs!.map((line, i) => <div key={i} style={{ minHeight: '1em' }}>{line.map(runView)}</div>)
          : runs ? runs[0].map(runView) : text}
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
  const { scope, pxPerMm, projectId, versions, warn, measureOnly, imagePending } = useRender()
  const { style: outer, fixedW, fixedH } = placementStyle(layer, place, pxPerMm)
  const { text: src, errors } = useMemo(() => interpolate(layer.src, scope), [layer.src, scope])
  const check = checkSrc(src)
  const [failed, setFailed] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const url = check.ok ? assetUrl(projectId, check.rel, versions) : null
  // An image inside a stack with no length of its own takes the file's proportions, so its
  // loading moves the text around it: the stack refits when it settles.
  const sizedByFile = !(fixedW && fixedH)
  const settles = sizedByFile && Boolean(url) && !failed
  useEffect(() => { setFailed(null); setNatural(null) }, [url])
  useLayoutEffect(() => {
    if (!settles) return undefined
    imagePending(layer.id, true)
    return () => imagePending(layer.id, false)
  }, [settles, url, layer.id, imagePending])
  useEffect(() => {
    for (const e of errors) warn(layer.id, e)
    if (!check.ok && check.reason !== 'empty') warn(layer.id, check.reason)
    if (failed) warn(layer.id, `image not found (${failed})`)
  }, [errors, check.ok, failed, layer.id, warn]) // eslint-disable-line react-hooks/exhaustive-deps
  const radius = layer.radiusMm ? layer.radiusMm * pxPerMm : undefined
  const showPlaceholder = !url || failed
  const tile = layer.objectFit === 'tile'
  const settled = () => { if (settles) imagePending(layer.id, false) }
  if (measureOnly && !sizedByFile) return <div data-layer-id={layer.id} style={outer} />
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
            onLoad={(e) => { setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); settled() }}
            onError={() => { setFailed(src); settled() }}
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
          onLoad={settled}
          onError={() => { setFailed(src); settled() }}
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
  const { pxPerMm, scope, library, warn, projectId, versions, measureOnly } = useRender()
  const { style: outer, box } = placementStyle(layer, place, pxPerMm)
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(box ? { w: box.w * pxPerMm, h: box.h * pxPerMm } : null)
  useLayoutEffect(() => {
    if (box) setSize({ w: box.w * pxPerMm, h: box.h * pxPerMm })
    else if (ref.current) setSize({ w: ref.current.clientWidth, h: ref.current.clientHeight })
  }, [box?.w, box?.h, pxPerMm]) // eslint-disable-line react-hooks/exhaustive-deps
  const { n, code, errors } = useMemo(() => {
    const errs: string[] = []
    let count = 0
    const r = evaluate(layer.count || '0', scope)
    if (!r.ok) errs.push(`count: ${r.error}`)
    else {
      const c = repeatCount(toText(r.value))
      if (c === null) errs.push(`count: "${toText(r.value)}" is not a number`)
      else count = c
    }
    const ic = interpolate(layer.icon || '', scope)
    errs.push(...ic.errors)
    const name = ic.text.trim().replace(/^\{|\}$/g, '')
    if (!name) errs.push('choose an icon: a symbol from the Library')
    else if (!library.symbols.has(name)) errs.push(`no symbol {${name}}`)
    return { n: count, code: name, errors: errs }
  }, [layer.count, layer.icon, scope, library])
  useEffect(() => { for (const e of errors) warn(layer.id, e) }, [errors, layer.id, warn])
  const sym = library.symbols.get(code)
  const dir = layer.direction || 'ltr'
  const horizontal = dir === 'ltr' || dir === 'rtl'
  let icons: ReactNode = null
  if (sym && size && size.w > 0 && size.h > 0) {
    const iw = horizontal ? size.h * sym.aspect : size.w
    const ih = horizontal ? size.h : size.w / sym.aspect
    const gap = (layer.gapMm ?? 0.5) * pxPerMm
    const at = repeatPositions(n, horizontal ? size.w : size.h, horizontal ? iw : ih, gap, dir === 'rtl' || dir === 'btt')
    icons = at.map((p, i) => {
      const st: CSSProperties = { position: 'absolute', width: iw, height: ih, left: horizontal ? p : 0, top: horizontal ? 0 : p }
      return measureOnly
        ? <span key={i} style={st} />
        : <img key={i} data-symbol={sym.code} src={assetUrl(projectId, sym.relPath, versions)} alt="" draggable={false} style={{ ...st, objectFit: 'contain' }} />
    })
  }
  return <div ref={ref} data-layer-id={layer.id} data-count={n} style={{ ...outer, opacity: layer.opacity }}>{icons}</div>
}

function GroupView({ layer, place }: { layer: GroupLayer; place: Placement }) {
  const { pxPerMm } = useRender()
  const { style: outer, box } = placementStyle(layer, place, pxPerMm)
  const local: Box | null = box ? { x: 0, y: 0, w: box.w, h: box.h } : null
  return (
    <div data-layer-id={layer.id} style={{ ...outer, opacity: layer.opacity }}>
      {local && <Layers layers={layer.children} place={{ parent: local }} />}
    </div>
  )
}

const containsFitItem = (el: Element) => el.hasAttribute('data-fit-item') || Boolean(el.querySelector('[data-fit-item]'))

// A stack whose own length is set (a frame, or a set size inside another stack) fits the text
// layers inside it that size to their content: it measures them together and decides each one's
// size, line height or hiding (fitStack), then renders them with those decisions. A stack that
// grows with its content leaves this to the stack around it.
function StackView({ layer, place }: { layer: StackLayer; place: Placement }) {
  const { pxPerMm, fontsReady, fitted, unfit, epoch } = useRender()
  const outerDecisions = useContext(StackFitCtx)
  const { style: outer, fixedW, fixedH } = placementStyle(layer, place, pxPerMm)
  const vertical = layer.direction !== 'horizontal'
  const fitsText = vertical ? fixedH : fixedW
  const order = layer.fitOrder === 'hideFirst' ? 'hideFirst' : 'shrinkFirst'
  const ref = useRef<HTMLDivElement>(null)
  const [decisions, setDecisions] = useState<Map<string, StackState> | null>(null)
  const signature = useRef('')
  const reported = useRef<string[]>([])

  // Runs after every commit; the signature of everything the fit depends on skips the work when
  // nothing changed (the decisions themselves are not part of it, so applying them can't loop).
  useLayoutEffect(() => {
    const el = ref.current
    const report = (results: Record<string, FitResult>) => {
      const ids = Object.keys(results)
      for (const id of reported.current) if (!(id in results)) unfit(id)
      for (const id of ids) fitted(id, results[id])
      reported.current = ids
    }
    if (!fitsText || !el || !fontsReady) {
      if (signature.current) { signature.current = ''; report({}); setDecisions(null) }
      return
    }
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-fit-item]')].filter((n) => n.closest('[data-fit-scope]') === el)
    const inners = nodes.map((n) => n.querySelector<HTMLElement>('[data-fit-inner]')!)
    const box = el.getBoundingClientRect()
    const rigid = [...el.children].filter((c) => !containsFitItem(c)).map((c) => {
      const r = c.getBoundingClientRect()
      return Math.round((vertical ? r.height : r.width) * 100)
    })
    const sig = JSON.stringify([
      epoch, pxPerMm, order, layer.gapMm ?? 0, Math.round(box.width * 100), Math.round(box.height * 100), rigid,
      nodes.map((n, i) => [n.dataset.fitItem, n.dataset.fitPolicy, inners[i].textContent]),
    ])
    if (sig === signature.current) return
    signature.current = sig
    if (!nodes.length) { report({}); setDecisions(null); return }

    const items: StackItem[] = nodes.map((n) => ({ id: n.dataset.fitItem!, ...JSON.parse(n.dataset.fitPolicy!) }))
    const saved = nodes.map((n, i) => [n.style.display, inners[i].style.fontSize, inners[i].style.lineHeight])
    const measure = (state: Record<string, StackState>): StackMeasure => {
      nodes.forEach((n, i) => {
        const s = state[items[i].id]
        n.style.display = s.hidden ? 'none' : 'flex'
        inners[i].style.fontSize = `${ptToPx(s.pt, pxPerMm)}px`
        inners[i].style.lineHeight = String(s.lineHeight)
      })
      const b = el.getBoundingClientRect()
      const start = vertical ? b.top : b.left
      let end = start
      for (const child of el.children) {
        const r = child.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue // display: none
        end = Math.max(end, vertical ? r.bottom : r.right)
      }
      const at: StackMeasure['items'] = {}
      nodes.forEach((n, i) => {
        if (state[items[i].id].hidden) return
        const r = n.getBoundingClientRect()
        at[items[i].id] = { pos: (vertical ? r.top : r.left) - start, size: vertical ? r.height : r.width }
      })
      return { room: vertical ? b.height : b.width, need: end - start, items: at }
    }
    const results = fitStack(items, measure, pxPerMm, order)
    // Put back exactly what React rendered (see TextView); the decisions re-render the children.
    nodes.forEach((n, i) => {
      n.style.display = saved[i][0]
      inners[i].style.fontSize = saved[i][1]
      inners[i].style.lineHeight = saved[i][2]
    })
    setDecisions(new Map(Object.entries(results).map(([id, r]) => [id, { pt: r.pt, lineHeight: r.lineHeight, hidden: r.status === 'hidden' }])))
    report(results)
  })
  useLayoutEffect(() => () => { for (const id of reported.current) unfit(id) }, [unfit])

  return (
    <div
      ref={ref}
      data-layer-id={layer.id}
      data-fit-scope={fitsText ? '' : undefined}
      style={{
        ...outer,
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        gap: (layer.gapMm ?? 0) * pxPerMm,
        overflow: 'hidden',
        opacity: layer.opacity,
      }}
    >
      <StackFitCtx.Provider value={fitsText ? decisions : outerDecisions}>
        <Layers layers={layer.children} place={{ parent: null, stackDirection: layer.direction || 'vertical' }} />
      </StackFitCtx.Provider>
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
    case 'stack': return <StackView layer={layer} place={place} />
    case 'group': return <GroupView layer={layer} place={place} />
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

export default function CardRender({ template, card, projectId, pxPerMm, showBleed = false, assetVersions, onReady, measureOnly = false, onFits }: CardRenderProps) {
  const library = useLibrary()
  const scope = useMemo(() => cardScope(card, library.variables), [card, library])
  const reminders = remindersOn(library, card)
  const [fontEpoch, setFontEpoch] = useState(0)
  const [imageEpoch, setImageEpoch] = useState(0)
  const fontsReady = useFontsReady(template, fontEpoch)
  const rootRef = useRef<HTMLDivElement>(null)
  const warningsRef = useRef(new Map<string, string>())
  // Fit results by layer id. Layers set their entry when their result changes and remove it when
  // they unmount, so the map always matches what is on the card.
  const fitsRef = useRef(new Map<string, FitResult>())
  const fitsVersion = useRef(0) // bumped when an entry changes
  const reported = useRef<{ version: number; template: Template | null; card: unknown }>({ version: -1, template: null, card: undefined })
  const pendingImages = useRef(new Set<string>())
  const fitted = useCallback((id: string, r: FitResult) => {
    const cur = fitsRef.current.get(id)
    if (cur && JSON.stringify(cur) === JSON.stringify(r)) return
    fitsRef.current.set(id, r)
    fitsVersion.current++
  }, [])
  const unfit = useCallback((id: string) => { if (fitsRef.current.delete(id)) fitsVersion.current++ }, [])
  const imagePending = useCallback((id: string, pending: boolean) => {
    if (pending) pendingImages.current.add(id)
    else if (pendingImages.current.delete(id)) setImageEpoch((e) => e + 1)
  }, [])

  // A project font finishing loading changes metrics: refit.
  useEffect(() => {
    const onDone = () => setFontEpoch((e) => e + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [])

  const epoch = `${fontEpoch}:${imageEpoch}`
  const ctx = useMemo<Ctx>(() => {
    warningsRef.current = new Map()
    return {
      projectId, pxPerMm, scope, versions: assetVersions, fontsReady, measureOnly, epoch, library, reminders,
      warn: (id, msg) => { warningsRef.current.set(`${id}: ${msg}`, `${id}: ${msg}`) },
      fitted, unfit, imagePending,
    }
  }, [projectId, pxPerMm, scope, assetVersions, fontsReady, template, measureOnly, epoch, library, reminders, fitted, unfit, imagePending])

  // Measure-only: report once layout has settled, and again when a result, the template or the
  // card changes (a parent re-rendering for another reason must not report again: a listener that
  // stores the results would re-render that parent and loop). Layout effects run children first,
  // and updates they make re-render synchronously before this microtask runs.
  const onFitsRef = useRef(onFits)
  onFitsRef.current = onFits
  useLayoutEffect(() => {
    if (!onFitsRef.current || !fontsReady) return undefined
    let cancelled = false
    queueMicrotask(() => {
      const last = reported.current
      if (cancelled || pendingImages.current.size) return
      if (last.version === fitsVersion.current && last.template === template && last.card === card) return
      reported.current = { version: fitsVersion.current, template, card }
      onFitsRef.current?.(Object.fromEntries(fitsRef.current))
    })
    return () => { cancelled = true }
  })

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
