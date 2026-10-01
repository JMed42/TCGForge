import { useEffect, useState } from 'react'
import { X, FolderOpen, Printer } from 'lucide-react'
import { useStore } from '../../store'

const selectClass = 'w-full px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent'

// Print-and-play sheets: N cards per Letter/A4 page at physical size, optional 3 mm bleed and
// crop marks. Uses the Card Database filter, like Export All Cards.
export default function PrintSheetsDialog({ onClose }) {
  const { activeProjectId, activeTemplateId, draft, cards, cardFilters } = useStore()
  const [paper, setPaper] = useState('letter')
  const [bleedMm, setBleedMm] = useState(3)
  const [cropMarks, setCropMarks] = useState(true)
  const [copies, setCopies] = useState(1)
  const [layout, setLayout] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    window.api.getSheetLayout(activeTemplateId, { paper, bleedMm, draft })
      .then((l) => { if (!cancelled) setLayout(l) })
      .catch((err) => { if (!cancelled) setLayout({ error: err.message }) })
    return () => { cancelled = true }
  }, [activeTemplateId, paper, bleedMm, draft])

  useEffect(() => window.api?.onExportProgress?.((p) => setProgress((cur) => (cur ? p : cur))), [])

  const slots = cards.length * Math.max(1, copies)
  const pages = layout?.perPage ? Math.ceil(slots / layout.perPage) : 0

  const run = async () => {
    setResult(null)
    setProgress({ current: 0, total: slots })
    try {
      const res = await window.api.exportPrintSheets(activeProjectId, activeTemplateId, {
        paper, bleedMm, cropMarks, copies, filter: cardFilters, draft,
      })
      setResult(res.canceled ? null : res)
    } catch (err) {
      setResult({ error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center" data-testid="print-sheets-dialog">
      <div className="w-[26rem] bg-surface-1 border border-border rounded-xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><Printer size={16} /> Print sheets</h3>
          <button onClick={onClose} disabled={!!progress} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-text-secondary">Paper</span>
            <select className={selectClass} value={paper} onChange={(e) => setPaper(e.target.value)}>
              <option value="letter">Letter (8.5 × 11 in)</option>
              <option value="a4">A4 (210 × 297 mm)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-text-secondary">Bleed</span>
            <select className={selectClass} value={bleedMm} onChange={(e) => setBleedMm(Number(e.target.value))}>
              <option value={3}>3 mm</option>
              <option value={0}>None</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-text-secondary">Copies of each card</span>
            <input type="number" min={1} max={99} className={selectClass} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
          </label>
          <label className="flex items-center gap-2 pt-5 text-sm text-text-primary">
            <input type="checkbox" checked={cropMarks} onChange={(e) => setCropMarks(e.target.checked)} />
            Crop marks
          </label>
        </div>

        <div className="text-sm text-text-secondary bg-surface-2 rounded-lg px-3 py-2" data-testid="sheet-summary">
          {layout?.error && <span className="text-danger">{layout.error}</span>}
          {layout && !layout.error && (layout.perPage > 0 ? (
            <>
              <strong className="text-text-primary">{layout.perPage} per page</strong> ({layout.cols} × {layout.rows}, {layout.orientation}) ·{' '}
              {slots} card{slots === 1 ? '' : 's'} · <strong className="text-text-primary">{pages} page{pages === 1 ? '' : 's'}</strong>
              <div className="text-xs text-text-muted mt-1">
                Card {layout.cardWidthMm.toFixed(1)} × {layout.cardHeightMm.toFixed(1)} mm{bleedMm ? ` + ${bleedMm} mm bleed` : ''}. Uses the current card filter. Print at 100% / actual size.
              </div>
            </>
          ) : <span className="text-danger">This card size doesn't fit on {paper === 'a4' ? 'A4' : 'Letter'}.</span>)}
        </div>

        {progress && (
          <div className="space-y-1">
            <p className="text-xs text-text-secondary">Rendering card {progress.current} of {progress.total}…</p>
            <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%' }} />
            </div>
          </div>
        )}

        {result?.error && <p className="text-xs text-danger">{result.error}</p>}
        {result?.path && (
          <div className="text-xs text-text-secondary space-y-1" data-testid="sheet-result">
            <p>Saved {result.pages} page{result.pages === 1 ? '' : 's'} ({result.cards} cards{result.copies > 1 ? ` × ${result.copies}` : ''}) in {(result.elapsedMs / 1000).toFixed(1)} s.</p>
            {result.errors.length > 0 && <p className="text-warning">{result.errors.length} warning(s): {result.errors[0]}</p>}
            <button onClick={() => window.api.showInFolder(result.path)} className="flex items-center gap-1 text-accent hover:underline">
              <FolderOpen size={12} /> Show in Folder
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={!!progress} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded-lg text-sm text-text-primary">
            Close
          </button>
          <button
            onClick={run}
            disabled={!!progress || !layout?.perPage || cards.length === 0}
            className="px-3 py-1.5 bg-accent hover:brightness-110 disabled:opacity-40 rounded-lg text-sm text-white font-medium"
          >
            Export PDF…
          </button>
        </div>
      </div>
    </div>
  )
}
