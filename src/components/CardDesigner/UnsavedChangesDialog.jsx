import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../../store'

// Shown whenever an action would throw away an unsaved template draft (switching template or
// project, closing the window). Mounted once in App.
export default function UnsavedChangesDialog() {
  const { unsavedPrompt, resolveUnsaved, draft, guardUnsaved } = useStore()

  // Window close: main.js asks first; proceed means "really close".
  useEffect(() => {
    return window.api?.onCloseRequested?.(() => {
      guardUnsaved(() => window.api.confirmClose())
    })
  }, [guardUnsaved])

  useEffect(() => {
    if (!unsavedPrompt) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); resolveUnsaved('cancel') }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [unsavedPrompt, resolveUnsaved])

  if (!unsavedPrompt) return null
  const name = draft?.meta?.name || 'this template'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" role="dialog" aria-modal="true" data-testid="unsaved-dialog">
      <div className="w-[26rem] bg-surface-1 border border-border rounded-xl p-6 space-y-4 shadow-2xl">
        <div className="flex gap-3">
          <AlertTriangle size={20} className="text-warning flex-none mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Save changes to “{name}”?</h3>
            <p className="text-sm text-text-secondary mt-1">Your template edits haven't been saved. They'll be lost if you don't save them.</p>
          </div>
        </div>
        {unsavedPrompt.error && <p className="text-xs text-danger">Could not save: {unsavedPrompt.error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => resolveUnsaved('cancel')} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm text-text-primary">
            Cancel
          </button>
          <button onClick={() => resolveUnsaved('discard')} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm text-danger">
            Don't save
          </button>
          <button autoFocus onClick={() => resolveUnsaved('save')} className="px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg text-sm text-white font-medium">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
