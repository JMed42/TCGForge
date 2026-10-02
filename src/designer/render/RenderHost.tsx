// The #render route, loaded in the hidden export window (electron/renderWindow.js). It draws
// export jobs with the same CardRender the Designer canvas uses and tells the main process when
// the result is settled, so it can capture (PNG) or print (PDF).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CardRender, { cardPixelSize } from './CardRender.tsx'
import type { RenderReport } from './CardRender.tsx'
import type { Template } from '../schema/types.ts'
import { useProjectFonts } from './useProjectFonts.ts'

interface CardJob {
  jobId: number
  kind: 'card'
  template: Template
  card: Record<string, unknown>
  projectId: number
  pxPerMm: number
  showBleed: boolean
  background: string | null
}

interface PagesJob {
  jobId: number
  kind: 'pages'
  template: Template
  projectId: number
  showBleed: boolean
  pageWidthMm: number
  pageHeightMm: number
  pages: Array<{ items: Array<{ card: Record<string, unknown>; xMm: number; yMm: number }>; marks: Array<[number, number, number, number]> }>
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
  return (
    <>
      <style>{`@page { size: ${job.pageWidthMm}mm ${job.pageHeightMm}mm; margin: 0 } html, body { margin: 0; padding: 0; background: #ffffff }`}</style>
      {job.pages.map((page, p) => (
        <div
          key={p}
          style={{
            position: 'relative', width: `${job.pageWidthMm}mm`, height: `${job.pageHeightMm}mm`, overflow: 'hidden',
            breakAfter: p < job.pages.length - 1 ? 'page' : 'auto', background: '#ffffff',
          }}
        >
          {page.items.map((item, i) => (
            <div key={i} style={{ position: 'absolute', left: item.xMm * px, top: item.yMm * px }}>
              <CardRender template={job.template} card={item.card} projectId={job.projectId} pxPerMm={px} showBleed={job.showBleed} onReady={onItemReady} />
            </div>
          ))}
          {page.marks.length > 0 && (
            <svg style={{ position: 'absolute', left: 0, top: 0 }} width={job.pageWidthMm * px} height={job.pageHeightMm * px}>
              {page.marks.map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1 * px} y1={y1 * px} x2={x2 * px} y2={y2 * px} stroke="#000" strokeWidth={0.25 * (96 / 72)} />
              ))}
            </svg>
          )}
        </div>
      ))}
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
    const off = window.api.onRenderJob((j: Job) => setJob(j))
    window.api.renderHostReady()
    return off
  }, [])

  if (!job || !fonts.ready) return null
  return job.kind === 'card' ? <CardJobView key={job.jobId} job={job} /> : <PagesJobView key={job.jobId} job={job} />
}
