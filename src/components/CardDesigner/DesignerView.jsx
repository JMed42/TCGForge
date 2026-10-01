import { useEffect } from 'react'
import { useStore } from '../../store'
import TopBar from '../Layout/TopBar'
import TemplatePicker from './TemplatePicker'
import PreviewCanvas from './PreviewCanvas'
import TemplateJsonPanel from './TemplateJsonPanel'
import ExportControls from './ExportControls'

export default function DesignerView() {
  const {
    cards,
    activeTemplateId,
    previewCardId,
    previewZoom,
    loadTemplates,
    setPreviewCard,
    renderPreview,
  } = useStore()

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  // Default the preview card to the first card in the list.
  useEffect(() => {
    if (!cards.some((c) => c.id === previewCardId)) setPreviewCard(cards[0]?.id ?? null)
  }, [cards, previewCardId, setPreviewCard])

  // `cards` is replaced after every card edit, so field changes re-render the preview too.
  useEffect(() => {
    renderPreview()
  }, [cards, activeTemplateId, previewCardId, previewZoom, renderPreview])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Card Designer">
        <ExportControls />
      </TopBar>
      <div className="flex-1 flex overflow-hidden">
        <TemplatePicker />
        <PreviewCanvas />
        <TemplateJsonPanel />
      </div>
    </div>
  )
}
