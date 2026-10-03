// The #render route, loaded in the hidden export window (electron/renderWindow.js). It draws
// export jobs with the same CardRender the Designer canvas uses and tells the main process when
// the result is settled, so it can capture (PNG) or print (PDF).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import CardRender, { cardPixelSize } from './CardRender.tsx'
import type { RenderReport } from './CardRender.tsx'
import type { Template } from '../schema/types.ts'
import { useProjectFonts } from './useProjectFonts.ts'
import { resolveAll } from '../rules/resolveTemplate.ts'
import type { TemplateRule } from '../rules/resolveTemplate.ts'
import { LibraryContext } from '../library/LibraryContext.ts'
import { compileLibrary } from '../library/library.ts'
import type { LibraryRows } from '../library/library.ts'

interface CardJob {
  jobId: number
  kind: 'card'
  template: Template
  card: Record<string, unknown>
  projectId: number
  pxPerMm: number
  showBleed: boolean
  background: string | null
  library?: LibraryRows | null // the project's symbols, keywords and variables
}

interface PagesJob {
  jobId: number
  kind: 'pages'
  template: Template
  projectId: number
  showBleed: boolean
  library?: LibraryRows | null
  pageWidthMm: number
  pageHeightMm: number
  // An item may carry its own template (cards resolved by template rules); a page may carry its
  // own paper size (groups of different card sizes can land in different orientations).
  pages: Array<{
    items: Array<{ card: Record<string, unknown>; xMm: number; yMm: number; template?: Template }>
    marks: Array<[number, number, number, number]>
    pageWidthMm?: number
    pageHeightMm?: number
  }>
}

// Not drawn: evaluates template rules with the shared expression engine (main has no TS engine).
interface ResolveJob {
  jobId: number
  kind: 'resolve'
  cards: Array<Record<string, unknown>>
  rules: TemplateRule[]
  templateIds: number[]
}

type Job = CardJob | PagesJob

const CSS_PX_PER_MM = 96 / 25.4 // printing maps 96 CSS px to one inch

function CardJobView({ job }: { job: CardJob }) {
  const onReady = useCallback((report: RenderReport) => {
    window.api.renderDone({ jobId: job.jobId, report })
  }, [job.jobId])
  const { width, height } = cardPixelSize(job.template, job.pxPerMm, job.showBleed)
  return (
    <div style={{ width, height, background: job.background || 'transparent' }}>
      <CardRender template={job.template} card={job.card} projectId={job.projectId} pxPerMm={job.pxPerMm} showBleed={job.showBleed} onReady={onReady} />
    </div>
  )
}

function PagesJobView({ job }: { job: PagesJob }) {
  const total = useMemo(() => job.pages.reduce((n, p) => n + p.items.length, 0), [job])
  const doneRef = useRef({ count: 0, warnings: new Set<string>(), sent: false })
  useEffect(() => { doneRef.current = { count: 0, warnings: new Set(), sent: false } }, [job])
  const onItemReady = useCallback((report: RenderReport) => {
    const d = doneRef.current
    d.count++
    for (const w of report.warnings) d.warnings.add(w)
    if (d.count >= total && !d.sent) {
      d.sent = true
      window.api.renderDone({ jobId: job.jobId, report: { warnings: [...d.warnings], fits: {} } })
    }
  }, [job.jobId, total])
  useEffect(() => {
    if (total === 0) window.api.renderDone({ jobId: job.jobId, report: { warnings: [], fits: {} } })
  }, [job.jobId, total])

  const px = CSS_PX_PER_MM
  // Named @page rules, one per distinct paper size.
  const sizes = useMemo(() => {
    const list: string[] = []
    for (const p of job.pages) {
      const key = `${p.pageWidthMm ?? job.pageWidthMm}mm ${p.pageHeightMm ?? job.pageHeightMm}mm`
      if (!list.includes(key)) list.push(key)
    }
    return list
  }, [job])
  const pageCss = sizes.map((s, i) => `@page s${i} { size: ${s}; margin: 0 }`).join(' ')
  return (
    <>
      <style>{`@page { size: ${job.pageWidthMm}mm ${job.pageHeightMm}mm; margin: 0 } ${pageCss} html, body { margin: 0; padding: 0; background: #ffffff }`}</style>
      {job.pages.map((page, p) => {
        const w = page.pageWidthMm ?? job.pageWidthMm
        const h = page.pageHeightMm ?? job.pageHeightMm
        return (
        <div
          key={p}
          style={{
            position: 'relative', width: `${w}mm`, height: `${h}mm`, overflow: 'hidden',
            breakAfter: p < job.pages.length - 1 ? 'page' : 'auto', background: '#ffffff',
            page: `s${sizes.indexOf(`${w}mm ${h}mm`)}`,
          } as CSSProperties}
        >
          {page.items.map((item, i) => (
            <div key={i} style={{ position: 'absolute', left: item.xMm * px, top: item.yMm * px }}>
              <CardRender template={item.template || job.template} card={item.card} projectId={job.projectId} pxPerMm={px} showBleed={job.showBleed} onReady={onItemReady} />
            </div>
          ))}
          {page.marks.length > 0 && (
            <svg style={{ position: 'absolute', left: 0, top: 0 }} width={w * px} height={h * px}>
              {page.marks.map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1 * px} y1={y1 * px} x2={x2 * px} y2={y2 * px} stroke="#000" strokeWidth={0.25 * (96 / 72)} />
              ))}
            </svg>
          )}
        </div>
        )
      })}
    </>
  )
}

export default function RenderHost() {
  const [job, setJob] = useState<Job | null>(null)
  const fonts = useProjectFonts(job?.projectId)

  useEffect(() => {
    // The app's index.html paints a dark background; exports need a clean page.
    document.body.className = ''
    document.body.style.margin = '0'
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    // No scrollbars: the window is sized to the card rounded up, so it must never scroll.
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const off = window.api.onRenderJob((j: Job | ResolveJob) => {
      if (j.kind === 'resolve') {
        try {
          const res = resolveAll(j.cards, j.rules, j.templateIds)
          window.api.renderDone({ jobId: j.jobId, resolutions: j.cards.map((c) => [c.id, res.get(c.id)!.templateId]) })
        } catch (err) {
          window.api.renderDone({ jobId: j.jobId, error: String((err as Error).message || err) })
        }
        return
      }
      setJob(j)
    })
    window.api.renderHostReady()
    return off
  }, [])

  const library = useMemo(() => compileLibrary(job?.library), [job])
  if (!job || !fonts.ready) return null
  return (
    <LibraryContext.Provider value={library}>
      {job.kind === 'card' ? <CardJobView key={job.jobId} job={job} /> : <PagesJobView key={job.jobId} job={job} />}
    </LibraryContext.Provider>
  )
}
