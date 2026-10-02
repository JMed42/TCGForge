import { useCallback, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'

const ZOOMS = [1, 2, 3]
const CSS_PX_PER_MM = 96 / 25.4

// Live render of the draft for the sample card, through the same CardRender the exports use.
export default function PreviewCanvas() {
  const { draft, draftError, cards, previewCardId, activeTemplateId, activeProjectId, assetVersions } = useStore()
  const [zoom, setZoom] = useState(2)
  const [report, setReport] = useState(null)
  const fonts = useProjectFonts(activeProjectId, assetVersions)
  const card = cards.find((c) => c.id === previewCardId) || null
  const onReady = useCallback((r) => setReport(r), [])
  const pxPerMm = CSS_PX_PER_MM * zoom
  const stageRef = useRef(null)

  return (
    <div className="flex-1 min-w-[280px] flex flex-col overflow-hidden bg-surface-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-text-secondary">
        <div className="flex items-center gap-1">
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-2 py-1 rounded ${zoom === z ? 'bg-surface-3 text-accent' : 'hover:bg-surface-2'}`}
            >
              {z * 100}%
            </button>
          ))}
        </div>
        {draft && (
          <span data-testid="preview-meta">
            {draft.size.widthMm} × {draft.size.heightMm} mm · bleed {draft.size.bleedMm} mm
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto flex items-start p-6" data-note="card stays at whole-pixel x/y (no centring) so it rasterises exactly like the export">
        {!activeTemplateId && <p className="mx-auto text-sm text-text-muted mt-16">Create or pick a template to preview.</p>}
        {draftError && (
          <div className="mx-auto mt-16 max-w-md flex gap-2 text-sm text-danger">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>This template can't be opened ({draftError}). Fix it in the JSON tab.</span>
          </div>
        )}
        {draft && fonts.ready && (
          <div id="card-stage" ref={stageRef} className="relative flex-none shadow-2xl" data-px-per-mm={pxPerMm}>
            <CardRender
              template={draft}
              card={card}
              projectId={activeProjectId}
              pxPerMm={pxPerMm}
              showBleed
              assetVersions={assetVersions}
              onReady={onReady}
            />
            {/* Trim line and safe zone. */}
            <div
              className="absolute pointer-events-none border border-white/70"
              style={{
                left: draft.size.bleedMm * pxPerMm, top: draft.size.bleedMm * pxPerMm,
                width: draft.size.widthMm * pxPerMm, height: draft.size.heightMm * pxPerMm,
                borderRadius: (draft.size.cornerRadiusMm || 0) * pxPerMm,
              }}
            />
            <div
              className="absolute pointer-events-none border border-dashed border-sky-400/80"
              style={{
                left: (draft.size.bleedMm + draft.size.safeMm) * pxPerMm, top: (draft.size.bleedMm + draft.size.safeMm) * pxPerMm,
                width: (draft.size.widthMm - 2 * draft.size.safeMm) * pxPerMm, height: (draft.size.heightMm - 2 * draft.size.safeMm) * pxPerMm,
              }}
            />
          </div>
        )}
      </div>

      {report?.warnings?.length > 0 && (
        <div className="border-t border-border px-4 py-2 max-h-28 overflow-y-auto space-y-0.5" data-testid="render-warnings">
          {report.warnings.map((w, i) => (
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
