import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { orderRules } from '../../designer/rules/resolveTemplate.ts'
import { FIT_PX_PER_MM } from '../../designer/fit/inputs.ts'
import { applyLive } from '../Cards/grid/cardFields'
import { useParsedTemplates } from './templates'
import { fitKeyFor } from './fitKey'
import { useLibrary } from '../../designer/library/LibraryContext.ts'

// The live fit budget (spec: "Live fit budget while typing in a cell"): the active card with what
// is being typed, measured on every keystroke the same way as the background check (hidden, 300
// dpi, measure-only CardRender). The result goes to store.liveFit for the form, the cell editor,
// the preview and the Fit column; when nothing is being typed it is also the card's cached result.
export default function LiveFitProbe() {
  const projectId = useStore((s) => s.activeProjectId)
  const card = useStore((s) => s.cards.find((c) => c.id === s.activeCardId) || null)
  const liveEdit = useStore((s) => s.liveEdit)
  const rules = useStore((s) => s.templateRules)
  const sigs = useStore((s) => s.fitSignatures)
  const assetVersions = useStore((s) => s.assetVersions)
  const templates = useParsedTemplates()
  const fonts = useProjectFonts(projectId, assetVersions)
  const liveCard = useMemo(() => applyLive(card, liveEdit), [card, liveEdit])
  const ordered = useMemo(() => orderRules(rules), [rules])
  const library = useLibrary()
  const key = useMemo(() => (liveCard && sigs ? fitKeyFor(liveCard, templates, ordered, sigs, library.signature) : null), [liveCard, templates, ordered, sigs, library])
  const typing = Boolean(card && liveEdit && liveEdit.cardId === card.id)
  const last = useRef('')

  const onFits = useCallback((fits) => {
    const s = useStore.getState()
    const sig = JSON.stringify([liveCard.id, key.templateId, fits])
    if (sig !== last.current) {
      last.current = sig
      s.setLiveFit({ cardId: liveCard.id, templateId: key.templateId, results: fits })
    }
    if (!typing && s.fitCache[liveCard.id]?.hash !== key.hash) {
      s.recordFits([{ cardId: liveCard.id, hash: key.hash, templateId: key.templateId, templateVersion: key.templateVersion, results: fits }])
    }
  }, [liveCard, key, typing])

  useEffect(() => {
    if (!key) { last.current = ''; useStore.getState().setLiveFit(null) }
  }, [key])
  useEffect(() => () => useStore.getState().setLiveFit(null), [])

  if (!key || !fonts.ready) return null
  return (
    <div aria-hidden="true" data-live-fit-probe="" style={{ position: 'fixed', left: -100000, top: 0, visibility: 'hidden', pointerEvents: 'none', contain: 'layout paint style' }}>
      <CardRender template={key.template} card={liveCard} projectId={projectId} pxPerMm={FIT_PX_PER_MM} assetVersions={assetVersions} measureOnly onFits={onFits} />
    </div>
  )
}
