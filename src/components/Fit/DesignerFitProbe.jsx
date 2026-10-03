import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { FIT_PX_PER_MM } from '../../designer/fit/inputs.ts'

const SETTLE_MS = 150 // after the last edit (drags change the template every frame)

// The Designer's template as edited, on the current sample card, measured the same way as the
// background check (hidden, 300 dpi, measure-only): store.designerFit, for the canvas outlines
// and the Properties panel's "On <card>: shrunk to 7.25 pt".
export default function DesignerFitProbe() {
  const projectId = useStore((s) => s.activeProjectId)
  const draft = useStore((s) => s.draft)
  const card = useStore((s) => s.cards.find((c) => c.id === s.previewCardId) || null)
  const assetVersions = useStore((s) => s.assetVersions)
  const fonts = useProjectFonts(projectId, assetVersions)
  const [settled, setSettled] = useState({ draft, card })

  useEffect(() => {
    const t = setTimeout(() => setSettled({ draft, card }), SETTLE_MS)
    return () => clearTimeout(t)
  }, [draft, card])
  useEffect(() => () => useStore.getState().setDesignerFit(null), [])

  const onFits = useCallback((fits) => {
    const cur = useStore.getState().designerFit
    const cardId = settled.card?.id ?? null
    if (cur && cur.cardId === cardId && cur.draft === settled.draft && JSON.stringify(cur.results) === JSON.stringify(fits)) return
    useStore.getState().setDesignerFit({ cardId, draft: settled.draft, results: fits })
  }, [settled])

  if (!settled.draft || !fonts.ready) return null
  return (
    <div aria-hidden="true" data-designer-fit-probe="" style={{ position: 'fixed', left: -100000, top: 0, visibility: 'hidden', pointerEvents: 'none', contain: 'layout paint style' }}>
      <CardRender template={settled.draft} card={settled.card} projectId={projectId} pxPerMm={FIT_PX_PER_MM} assetVersions={assetVersions} measureOnly onFits={onFits} />
    </div>
  )
}
