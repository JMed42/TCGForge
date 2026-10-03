import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, ListOrdered, PanelRightClose } from 'lucide-react'
import { useStore } from '../../store'
import CardRender, { cardPixelSize } from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { useParsedTemplates } from '../Fit/templates'
import { FitLine } from '../Fit/FitStatus'
import { useCardFit, useLayerLabels } from '../Fit/useFit'
import { resolveTemplate, orderRules, describeResolution } from '../../designer/rules/resolveTemplate.ts'
import { applyLive, cellKey } from './grid/cardFields'
import { fieldsForType } from '../../cardModel/model'
import { measurePaint } from './grid/liveTiming'

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
  const model = useStore((s) => s.cardModel)
  const [pasteNote, setPasteNote] = useState(null)
  useEffect(() => setPasteNote(null), [card?.id])
  // The card type's image field: Art if it has one, else the first image field.
  const imageField = useMemo(() => {
    if (!card) return null
    const fields = fieldsForType(model, card.card_type_id).filter((f) => f.kind === 'image')
    return fields.find((f) => f.key === 'image_path') || fields[0] || null
  }, [model, card])
  const pasteArt = async () => {
    setPasteNote(null)
    try {
      const res = await window.api.pasteImageFromClipboard(activeProjectId, { folder: 'art', name: card.name })
      if (res.empty) { setPasteNote('No image on the clipboard.'); return }
      await useStore.getState().commitCell(card.id, cellKey(imageField.key), res.path)
      setPasteNote(`Pasted into ${imageField.label}.`)
    } catch (err) {
      setPasteNote(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  // Text that doesn't fit at its set size, measured by the live probe (components/Fit) the same
  // way as the Fit column (spec: "Rules text: fits at 8.5 pt").
  const labels = useLayerLabels()
  const { summary: fit } = useCardFit(card?.id, labels)
  const fitLines = useMemo(() => (fit ? fit.items.filter((i) => i.result.status !== 'fits') : []), [fit])
  const templateName = (id) => templates.get(id)?.row.name || `#${id}`
  const size = template ? cardPixelSize(template, pxPerMm, false) : null
  const overrideId = card?.template_override_id ?? ''

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border" data-testid="card-preview" data-last-render-ms={lastMs === null ? '' : lastMs.toFixed(1)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium text-text-primary truncate flex-1" title={card?.name}>{card ? card.name || 'Unnamed card' : 'No card selected'}</span>
        {imageField && (
          <button onClick={pasteArt} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary" data-testid="preview-paste-art" title={`Paste an image from the clipboard into ${imageField.label}`}>
            <ClipboardPaste size={14} /> Paste art
          </button>
        )}
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
        {pasteNote && <p className="text-text-secondary" data-testid="preview-paste-note">{pasteNote}</p>}
        {resolution?.errors.map((e) => <p key={e} className="text-danger">⚠ {e}</p>)}
        {fitLines.map((item) => <FitLine key={item.layerId} item={item} />)}
        {report?.warnings.map((w) => <p key={w} className="text-amber-400">⚠ {w}</p>)}
        <p className="text-text-muted" data-testid="render-timing">
          {lastMs === null ? 'Edit a cell to see the live render time.' : `Last edit rendered in ${lastMs.toFixed(0)} ms`}
        </p>
      </div>
    </div>
  )
}
