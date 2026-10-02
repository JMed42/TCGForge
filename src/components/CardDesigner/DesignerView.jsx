import { useEffect, useState } from 'react'
import { Undo2, Redo2, Save, RotateCcw } from 'lucide-react'
import { useStore } from '../../store'
import TopBar from '../Layout/TopBar'
import TemplatePicker from './TemplatePicker'
import PreviewCanvas from './PreviewCanvas'
import TemplateJsonPanel from './TemplateJsonPanel'
import ExportControls from './ExportControls'

const isTypingTarget = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

export default function DesignerView() {
  const {
    cards,
    draft,
    dirty,
    history,
    activeTemplateId,
    previewCardId,
    loadTemplates,
    setPreviewCard,
    activeProjectId,
    bumpAsset,
    undo,
    redo,
    saveDraft,
    discardDraft,
  } = useStore()
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  // Default the preview card to the first card in the list.
  useEffect(() => {
    if (!cards.some((c) => c.id === previewCardId)) setPreviewCard(cards[0]?.id ?? null)
  }, [cards, previewCardId, setPreviewCard])

  // Files replaced on disk re-render immediately.
  useEffect(() => window.api?.onAssetChanged?.((c) => bumpAsset(c.projectId, c.relPath)), [bumpAsset])

  const handleSave = async () => {
    setSaveError(await saveDraft())
  }

  // Editor-wide shortcuts. Ctrl+S works everywhere; the rest leave text fields alone.
  useEffect(() => {
    const onKeyDown = (e) => {
      const state = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        if (state.dirty) handleSave()
        return
      }
      if (isTypingTarget(document.activeElement)) return
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) { e.preventDefault(); redo(); return }

    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const canEdit = Boolean(draft && activeTemplateId)
  const iconButton = 'p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title={`Card Designer${dirty ? ' — unsaved changes' : ''}`}>
        <button onClick={undo} disabled={!canEdit || history.past.length === 0} title="Undo (Ctrl+Z)" className={iconButton}>
          <Undo2 size={16} />
        </button>
        <button onClick={redo} disabled={!canEdit || history.future.length === 0} title="Redo (Ctrl+Shift+Z)" className={iconButton}>
          <Redo2 size={16} />
        </button>
        <button onClick={discardDraft} disabled={!dirty} title="Discard unsaved changes" className={iconButton}>
          <RotateCcw size={16} />
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty}
          title="Save template (Ctrl+S)"
          className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded-lg text-sm text-text-primary"
        >
          <Save size={16} />
          Save
        </button>
        <div className="w-px h-6 bg-border mx-1" />
        <ExportControls />
      </TopBar>
      {saveError && (
        <div className="px-4 py-2 bg-surface-1 border-b border-border text-xs text-danger flex justify-between">
          <span>Could not save: {saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-text-muted hover:text-text-primary">Dismiss</button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <TemplatePicker />
        <PreviewCanvas />
        <div className="w-80 min-w-[260px] flex-shrink bg-surface-1 border-l border-border flex flex-col overflow-hidden">
          <TemplateJsonPanel />
        </div>
      </div>
    </div>
  )
}
