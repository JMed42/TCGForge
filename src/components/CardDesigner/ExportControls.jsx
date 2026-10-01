import { useEffect, useState } from 'react'
import { Download, Images, FolderOpen, X, ChevronDown } from 'lucide-react'
import { useStore } from '../../store'

const SINGLE_OPTIONS = [
  { label: 'Web preview — PNG 96 dpi', format: 'png', dpi: 96 },
  { label: 'Print ready — PNG 300 dpi', format: 'png', dpi: 300 },
  { label: 'Print — PDF 300 dpi (RGB)', format: 'pdf', dpi: 300 },
]

export default function ExportControls() {
  const { activeProjectId, activeTemplateId, previewCardId, cardFilters } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [batch, setBatch] = useState(null) // { running, current, total, result }

  useEffect(() => {
    return window.api?.onExportProgress?.((p) => setBatch((b) => (b ? { ...b, ...p } : b)))
  }, [])

  const exportOne = async (opt) => {
    setMenuOpen(false)
    setStatus(null)
    try {
      const res = await window.api.exportCard(previewCardId, activeTemplateId, { format: opt.format, dpi: opt.dpi })
      if (res?.canceled) return
      setStatus({
        path: res.path,
        note: opt.format === 'pdf' ? 'PDF embeds RGB. True CMYK needs a pre-press tool.' : null,
      })
    } catch (error) {
      setStatus({ error: error.message })
    }
  }

  const exportAll = async () => {
    setBatch({ running: true, current: 0, total: 0 })
    try {
      const result = await window.api.exportAllCards(activeProjectId, activeTemplateId, {
        format: 'png',
        dpi: 300,
        filter: cardFilters,
      })
      if (result?.canceled) { setBatch(null); return }
      setBatch({ running: false, result })
    } catch (error) {
      setBatch({ running: false, result: { error: error.message } })
    }
  }

  const disabled = !activeTemplateId
  return (
    <>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={disabled || !previewCardId}
          className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded-lg text-sm text-text-primary"
        >
          <Download size={16} />
          Export This Card
          <ChevronDown size={14} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-64 bg-surface-2 border border-border rounded-lg shadow-xl z-20 py-1">
            {SINGLE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => exportOne(opt)}
                className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={exportAll}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 bg-accent hover:brightness-110 disabled:opacity-40 rounded-lg text-sm text-white font-medium"
      >
        <Images size={16} />
        Export All Cards
      </button>

      {status && (
        <div className="fixed bottom-4 right-4 z-30 max-w-md bg-surface-2 border border-border rounded-lg shadow-xl p-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {status.error ? (
                <p className="text-danger">{status.error}</p>
              ) : (
                <>
                  <p className="text-text-primary truncate">Saved {status.path}</p>
                  {status.note && <p className="text-xs text-text-muted mt-1">{status.note}</p>}
                  <button onClick={() => window.api.showInFolder(status.path)} className="mt-2 text-xs text-accent hover:underline">
                    Show in Folder
                  </button>
                </>
              )}
            </div>
            <button onClick={() => setStatus(null)} className="text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {batch && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
          <div className="w-96 bg-surface-1 border border-border rounded-xl p-6 space-y-4">
            {batch.running ? (
              <>
                <h3 className="text-sm font-semibold text-text-primary">
                  {batch.total ? `Rendering card ${batch.current} of ${batch.total}…` : 'Choosing folder…'}
                </h3>
                <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: batch.total ? `${(batch.current / batch.total) * 100}%` : '0%' }}
                  />
                </div>
              </>
            ) : batch.result?.error ? (
              <p className="text-sm text-danger">{batch.result.error}</p>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-text-primary">Export complete</h3>
                <p className="text-sm text-text-secondary">
                  {batch.result.exported} exported, {batch.result.skipped} skipped/errored
                  {' '}in {(batch.result.elapsedMs / 1000).toFixed(1)} s.
                </p>
                {batch.result.errors.length > 0 && (
                  <p className="text-xs text-warning">
                    {batch.result.errors.length} messages written to render-errors.log
                  </p>
                )}
              </>
            )}
            {!batch.running && (
              <div className="flex justify-end gap-2">
                {batch.result?.outputDir && (
                  <button
                    onClick={() => window.api.showInFolder(batch.result.outputDir)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm text-text-primary"
                  >
                    <FolderOpen size={16} />
                    Show in Folder
                  </button>
                )}
                <button onClick={() => setBatch(null)} className="px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg text-sm text-white">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
