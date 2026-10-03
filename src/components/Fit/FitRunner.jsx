import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { orderRules } from '../../designer/rules/resolveTemplate.ts'
import { FIT_PX_PER_MM } from '../../designer/fit/inputs.ts'
import { useParsedTemplates } from './templates'
import { fitKeyFor } from './fitKey'
import { useLibrary } from '../../designer/library/LibraryContext.ts'
import { deliver, hasRequested, onRequested, takeRequested } from './fitQueue'

// The background fit check (spec Phase 3: "fit_cache fills in the background for the whole set
// and invalidates on any input change"), mounted while a project is open. Each card's inputs are
// hashed (src/designer/fit/inputs.ts); a card whose hash has no cached result is measured here,
// a few at a time when the app is idle, in a hidden area at 300 dpi with the real CardRender.
// Results reach the store at once and the database in batches (src/fitSlice.js).
//
// Measurements asked for directly (the Designer's worst case, ./fitQueue.js) go first.

const MAX_BATCH = 8
const TARGET_MS = 12 // per measuring step, so the app stays responsive
const BATCH_TIMEOUT_MS = 8000

export default function FitRunner() {
  const projectId = useStore((s) => s.activeProjectId)
  const cards = useStore((s) => s.cards)
  const rules = useStore((s) => s.templateRules)
  const fitCache = useStore((s) => s.fitCache)
  const sigs = useStore((s) => s.fitSignatures)
  const ready = useStore((s) => s.fitReady)
  const assetVersions = useStore((s) => s.assetVersions)
  const activeCardId = useStore((s) => s.activeCardId)
  const templates = useParsedTemplates()
  const library = useLibrary()
  const fonts = useProjectFonts(projectId, assetVersions)
  const [batch, setBatch] = useState(null)
  const [wake, setWake] = useState(0)
  const failed = useRef(new Set()) // `${cardId}:${hash}` that didn't finish; retried when its inputs change
  const [failedCount, setFailedCount] = useState(0)
  const size = useRef(2)

  useEffect(() => onRequested(() => setWake((n) => n + 1)), [])

  // Every card's template and input hash.
  const wanted = useMemo(() => {
    if (!sigs) return []
    const ordered = orderRules(rules)
    const out = []
    for (const card of cards) {
      const key = fitKeyFor(card, templates, ordered, sigs, library.signature)
      if (key) out.push({ ...key, card, cardId: card.id })
    }
    return out
  }, [cards, rules, templates, sigs, library])

  // Cards without a current result, the active card first.
  const stale = useMemo(() => {
    const list = wanted.filter((w) => fitCache[w.cardId]?.hash !== w.hash && !failed.current.has(`${w.cardId}:${w.hash}`))
    const i = list.findIndex((w) => w.cardId === activeCardId)
    if (i > 0) list.unshift(list.splice(i, 1)[0])
    return list
  }, [wanted, fitCache, activeCardId, failedCount]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    useStore.getState().setFitProgress({ total: wanted.length, staleIds: new Set(stale.map((w) => w.cardId)) })
  }, [wanted.length, stale])

  const finish = useCallback((b) => {
    if (b.finished) return
    b.finished = true
    clearTimeout(b.timer)
    if (b.kind === 'request') {
      for (const item of b.items) deliver(item.req, item.reqKey, b.results.get(item.key) || {})
    } else {
      const entries = []
      for (const item of b.items) {
        const fits = b.results.get(item.key)
        if (fits) entries.push({ cardId: item.cardId, hash: item.hash, templateId: item.templateId, templateVersion: item.templateVersion, results: fits })
        else failed.current.add(item.key)
      }
      useStore.getState().recordFits(entries)
      if (entries.length < b.items.length) setFailedCount(failed.current.size)
    }
    const ms = performance.now() - b.started
    if (ms < TARGET_MS) size.current = Math.min(MAX_BATCH, size.current + 1)
    else if (ms > TARGET_MS * 2) size.current = Math.max(1, size.current - 1)
    setBatch((cur) => (cur === b ? null : cur))
  }, [])

  const onItem = useCallback((b, item, fits) => {
    if (b.finished || b.results.has(item.key)) return
    b.results.set(item.key, fits)
    if (b.results.size >= b.items.length) finish(b)
  }, [finish])

  const start = useCallback((kind, items) => {
    const b = { kind, items, results: new Map(), started: performance.now(), finished: false }
    b.timer = setTimeout(() => finish(b), BATCH_TIMEOUT_MS)
    setBatch(b)
  }, [finish])

  // Next step: requested measurements, else the next stale cards once the app is idle.
  useEffect(() => {
    if (batch || !ready || !fonts.ready || !projectId) return undefined
    if (hasRequested()) {
      start('request', takeRequested(MAX_BATCH).map(({ req, item }, i) => ({ key: `r${i}:${item.key}`, req, reqKey: item.key, card: item.card, template: item.template })))
      return undefined
    }
    if (!stale.length) {
      useStore.getState().flushFitResults()
      return undefined
    }
    const run = () => start('check', stale.slice(0, size.current).map((w) => ({ ...w, key: `${w.cardId}:${w.hash}` })))
    const id = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 400 }) : window.setTimeout(run, 16)
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(id) : clearTimeout(id))
  }, [batch, ready, fonts.ready, projectId, stale, wake, start])

  return (
    <div aria-hidden="true" data-fit-runner="" style={{ position: 'fixed', left: -100000, top: 0, visibility: 'hidden', pointerEvents: 'none' }}>
      {batch && fonts.ready && batch.items.map((item) => (
        <div key={item.key} style={{ position: 'absolute', left: 0, top: 0, contain: 'layout paint style' }}>
          <CardRender
            template={item.template}
            card={item.card}
            projectId={projectId}
            pxPerMm={FIT_PX_PER_MM}
            assetVersions={assetVersions}
            measureOnly
            onFits={(fits) => onItem(batch, item, fits)}
          />
        </div>
      ))}
    </div>
  )
}
