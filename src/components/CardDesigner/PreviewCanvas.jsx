import { AlertTriangle, Loader2 } from 'lucide-react'
import { useStore } from '../../store'

const ZOOMS = [1, 2, 3]

export default function PreviewCanvas() {
  const { preview, renderState, previewZoom, setPreviewZoom, previewCardId, activeTemplateId } = useStore()

  const ratio = window.devicePixelRatio || 1
  const cssWidth = preview?.width ? preview.width / ratio : 0
  const cssHeight = preview?.height ? preview.height / ratio : 0

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

      <div className="flex-1 overflow-auto flex items-start p-6">
        {!activeTemplateId && <p className="mx-auto text-sm text-text-muted mt-16">Create or pick a template to preview.</p>}
        {activeTemplateId && !previewCardId && <p className="mx-auto text-sm text-text-muted mt-16">Pick a card on the left.</p>}
        {preview?.error && (
          <div className="mx-auto mt-16 max-w-md flex gap-2 text-sm text-danger">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{preview.error}</span>
          </div>
        )}
        {preview?.dataUrl && previewCardId && activeTemplateId && (
          <img
            id="card-preview"
            src={preview.dataUrl}
            width={cssWidth}
            height={cssHeight}
            alt="Card preview"
            className="flex-none max-w-none mx-auto shadow-2xl"
            style={{ width: cssWidth, height: cssHeight }}
          />
        )}
      </div>

      {preview?.warnings?.length > 0 && (
        <div className="border-t border-border px-4 py-2 max-h-28 overflow-y-auto">
          {preview.warnings.map((w, i) => (
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
