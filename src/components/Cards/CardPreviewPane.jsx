import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered, PanelRightClose } from 'lucide-react'
import { useStore } from '../../store'
import CardRender, { cardPixelSize } from '../../designer/render/CardRender.tsx'
import { validateTemplate } from '../../designer/schema/schema.ts'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { resolveTemplate, orderRules, describeResolution } from '../../designer/rules/resolveTemplate.ts'
import { applyLive } from './grid/cardFields'
import { measurePaint } from './grid/liveTiming'

const FIT_LABEL = {
  fits: (r) => `fits at ${r.pt} pt`,
  shrunk: (r) => `shrunk to ${r.pt} pt`,
  hidden: () => 'hidden (no room)',
  overflow: (r) => `overflows at ${r.pt} pt`,
}

// Parsed templates by row, re-parsed only when a row's version changes.
const parsedCache = new Map()
function parseRow(row) {
  const key = `${row.id}:${row.version}:${row.updated_at}`
  if (parsedCache.has(key)) return parsedCache.get(key)
  let out
  try {
    const r = validateTemplate(JSON.parse(row.content))
    out = r.ok ? { template: r.template } : { error: r.errors.join('; ') }
  } catch (error) {
    out = { error: error.message }
  }
  parsedCache.set(key, out)
  return out
}

export function useParsedTemplates() {
  const rows = useStore((s) => s.templates)
  return useMemo(() => new Map(rows.map((r) => [r.id, { row: r, ...parseRow(r) }])), [rows])
}

/** The selected card, rendered live with the template its override or the rules pick. */
export default function CardPreviewPane({ onClose, onOpenRules }) {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const card = useStore((s) => s.cards.find((c) => c.id === s.activeCardId) || null)
  const liveEdit = useStore((s) => s.liveEdit)
  const rules = useStore((s) => s.templateRules)
  const assetVersions = useStore((s) => s.assetVersions)
  const templates = useParsedTemplates()
  const fonts = useProjectFonts(activeProjectId)
  const [report, setReport] = useState(null)
  const [lastMs, setLastMs] = useState(null)
  const [box, setBox] = useState({ w: 320, h: 440 })
  const stageRef = useRef(null)

  const liveCard = useMemo(() => applyLive(card, liveEdit), [card, liveEdit])
  const ordered = useMemo(() => orderRules(rules), [rules])
  const templateIds = useMemo(() => [...templates.keys()], [templates])
  const resolution = useMemo(() => (liveCard ? resolveTemplate(liveCard, ordered, templateIds) : null), [liveCard, ordered, templateIds])
  const entry = resolution?.templateId ? templates.get(resolution.templateId) : null
  const template = entry?.template || null

  // Fit the card into the pane.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pxPerMm = useMemo(() => {
    if (!template) return 4
    const pad = 24
    const s = Math.min((box.w - pad) / template.size.widthMm, (box.h - pad) / template.size.heightMm)
    return Math.max(1, Math.floor(s * 4) / 4)
  }, [template, box])

  // Edit-to-paint timing: CardRender's own layout effects (text fitting) have run by now.
  useLayoutEffect(() => {
    measurePaint().then((ms) => { if (ms !== null) setLastMs(ms) })
  }, [liveCard, template])

  const onReady = useCallback((r) => setReport(r), [])
  // Fit budget for text that didn't fit at its set size (spec: "Rules text: fits at 8.5 pt").
  const fitLines = useMemo(() => Object.entries(report?.fits || {}).filter(([, r]) => r.status !== 'fits'), [report])
  const templateName = (id) => templates.get(id)?.row.name || `#${id}`
  const size = template ? cardPixelSize(template, pxPerMm, false) : null
  const overrideId = card?.template_override_id ?? ''

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border" data-testid="card-preview" data-last-render-ms={lastMs === null ? '' : lastMs.toFixed(1)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium text-text-primary truncate flex-1" title={card?.name}>{card ? card.name || 'Unnamed card' : 'No card selected'}</span>
        <button onClick={onOpenRules} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary" data-testid="open-template-rules" title="Template assignment: which template each card uses">
          <ListOrdered size={14} /> Assignment…
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-muted" title="Hide preview"><PanelRightClose size={16} /></button>
      </div>

      {card && (
        <div className="px-3 py-2 border-b border-border space-y-1 text-xs">
          <div className="text-text-secondary" data-testid="preview-template">
            {resolution ? describeResolution(resolution, templateName) : '—'}
          </div>
          <label className="flex items-center gap-2 text-text-muted">
            Template
            <select
              data-testid="template-override"
              className="flex-1 px-2 py-1 bg-surface-2 border border-border rounded text-text-primary"
              value={overrideId}
              onChange={(e) => useStore.getState().setTemplateOverride(card.id, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Automatic (type / exceptions)</option>
              {[...templates.values()].map(({ row }) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center overflow-hidden" style={{ background: 'repeating-conic-gradient(#2a2f3a 0% 25%, #252a34 0% 50%) 50% / 16px 16px' }}>
        {!card && <p className="text-text-muted text-sm">Select a card</p>}
        {card && !templateIds.length && <p className="text-text-muted text-sm px-6 text-center">No templates yet. Create one in the Designer.</p>}
        {card && entry && !template && <p className="text-danger text-xs px-6">Template "{entry.row.name}" can't be opened: {entry.error}</p>}
        {card && template && fonts.ready && (
          <div style={{ width: size.width, height: size.height }} className="shadow-2xl">
            <CardRender template={template} card={liveCard} projectId={activeProjectId} pxPerMm={pxPerMm} assetVersions={assetVersions} onReady={onReady} />
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[11px] space-y-1 max-h-32 overflow-auto">
        {resolution?.errors.map((e) => <p key={e} className="text-danger">⚠ {e}</p>)}
        {fitLines.map(([id, r]) => (
          <p key={id} className={r.status === 'overflow' ? 'text-danger' : 'text-text-secondary'} data-fit={id}>
            {r.status === 'overflow' ? '⚠ ' : ''}{id}: {FIT_LABEL[r.status](r)}
          </p>
        ))}
        {report?.warnings.map((w) => <p key={w} className="text-amber-400">⚠ {w}</p>)}
        <p className="text-text-muted" data-testid="render-timing">
          {lastMs === null ? 'Edit a cell to see the live render time.' : `Last edit rendered in ${lastMs.toFixed(0)} ms`}
        </p>
      </div>
    </div>
  )
}
