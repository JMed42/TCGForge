import { AlertTriangle, Loader2 } from 'lucide-react'
import { useStore } from '../../store'
import CardStage from './CardStage'

const ZOOMS = [1, 2, 3]

export default function PreviewCanvas() {
  const { draft, draftError, preview, renderState, previewZoom, setPreviewZoom, previewCardId, activeTemplateId, selectLayer } = useStore()

  return (
    <div className="flex-1 min-w-[280px] flex flex-col overflow-hidden bg-surface-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-text-secondary">
        <div className="flex items-center gap-1">
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setPreviewZoom(z)}
              className={`px-2 py-1 rounded ${previewZoom === z ? 'bg-surface-3 text-accent' : 'hover:bg-surface-2'}`}
            >
              {z * 100}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {renderState === 'rendering' && <Loader2 size={14} className="animate-spin" />}
          {preview?.width && (
            <span data-testid="preview-meta">
              {preview.width}×{preview.height}px · {Math.round(preview.dpi)} dpi
            </span>
          )}
        </div>
      </div>

      {/* Clicking the empty area around the card clears the selection. */}
      <div
        className="flex-1 overflow-auto flex items-start p-6"
        onPointerDown={(e) => { if (e.target === e.currentTarget) selectLayer(null) }}
      >
        {!activeTemplateId && <p className="mx-auto text-sm text-text-muted mt-16">Create or pick a template to preview.</p>}
        {activeTemplateId && !previewCardId && <p className="mx-auto text-sm text-text-muted mt-16">Pick a card on the left.</p>}
        {draftError && (
          <div className="mx-auto mt-16 max-w-md flex gap-2 text-sm text-danger">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>This template's JSON can't be opened ({draftError}). Fix it in the JSON tab.</span>
          </div>
        )}
        {draft && previewCardId && activeTemplateId && <CardStage />}
      </div>

      {(preview?.error || preview?.warnings?.length > 0) && (
        <div className="border-t border-border px-4 py-2 max-h-28 overflow-y-auto space-y-0.5">
          {preview.error && (
            <p className="text-xs text-danger flex gap-2" data-testid="render-error">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              Not rendered: {preview.error}
            </p>
          )}
          {preview.warnings?.map((w, i) => (
            <p key={i} className="text-xs text-warning flex gap-2">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
