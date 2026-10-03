import { useState } from 'react'
import { BookOpen, FileText, LayoutTemplate, X } from 'lucide-react'
import { useStore } from '../../store'

// Shows where a symbol, keyword or variable is used before it is renamed or deleted.
//   mode 'rename': "Also change it in these N cards (and templates)" -> onConfirm(applyEverywhere)
//   mode 'delete': the uses, then Delete -> onConfirm()
export default function WhereUsedDialog({ title, what, uses, mode, rewrites = true, onConfirm, onClose }) {
  const [apply, setApply] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const openDoc = (id) => {
    const s = useStore.getState()
    s.setActiveDocument(id)
    s.setActiveView('rules')
  }
  const editable = uses.cards.length + uses.templates.length + uses.rules.length
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(apply)
      onClose()
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="where-used-dialog">
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-surface-1 border border-border rounded-xl shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <h2 className="flex-1 text-sm font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-text-muted"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3 space-y-3 text-xs">
          {!editable && !uses.docs.length && <p className="text-text-secondary">{what} isn't used anywhere yet.</p>}
          {uses.cards.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1.5 mb-1 font-medium text-text-secondary"><FileText size={13} /> {uses.cards.length} card{uses.cards.length === 1 ? '' : 's'}</h3>
              <ul className="space-y-1" data-testid="where-used-cards">
                {uses.cards.slice(0, 50).map(({ card, fields }) => (
                  <li key={card.id} className="px-2 py-1 rounded bg-surface-2" data-where-card={card.id}>
                    <span className="text-text-primary font-medium">{card.name}</span>
                    <span className="block text-text-muted truncate" title={fields.map((f) => f.text).join('\n')}>{fields[0].text}</span>
                  </li>
                ))}
                {uses.cards.length > 50 && <li className="text-text-muted">…and {uses.cards.length - 50} more</li>}
              </ul>
            </section>
          )}
          {(uses.templates.length > 0 || uses.rules.length > 0) && (
            <section>
              <h3 className="flex items-center gap-1.5 mb-1 font-medium text-text-secondary"><LayoutTemplate size={13} /> Templates</h3>
              <ul className="space-y-1" data-testid="where-used-templates">
                {uses.templates.map((t) => <li key={t.id} className="px-2 py-1 rounded bg-surface-2 text-text-primary">{t.name}</li>)}
                {uses.rules.map((r) => <li key={`r${r.id}`} className="px-2 py-1 rounded bg-surface-2 text-text-primary font-mono">exception: {r.condition_expr}</li>)}
              </ul>
            </section>
          )}
          {uses.docs.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1.5 mb-1 font-medium text-text-secondary"><BookOpen size={13} /> Game Docs ({uses.docs.length})</h3>
              <ul className="space-y-1" data-testid="where-used-docs">
                {uses.docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-2 py-1 rounded bg-surface-2" data-where-doc={d.id}>
                    <span className="flex-1 text-text-primary">{d.title}</span>
                    <button onClick={() => openDoc(d.id)} className="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-4 text-text-secondary">Open</button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-text-muted">Documents are listed so you can update them yourself; they aren't changed.</p>
            </section>
          )}
          {mode === 'rename' && editable > 0 && rewrites && (
            <label className="flex items-center gap-2 text-text-primary" data-testid="where-used-apply">
              <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="accent-accent" />
              Also change it in {[uses.cards.length && `${uses.cards.length} card${uses.cards.length === 1 ? '' : 's'}`, uses.templates.length && `${uses.templates.length} template${uses.templates.length === 1 ? '' : 's'}`, uses.rules.length && `${uses.rules.length} exception${uses.rules.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')}
            </label>
          )}
          {mode === 'delete' && editable > 0 && <p className="text-amber-400">Cards and templates keep their text; it will show as typed.</p>}
          {error && <p className="text-danger" data-testid="where-used-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-sm text-text-secondary">Cancel</button>
          <button disabled={busy} onClick={confirm} data-testid="where-used-confirm" className={`px-3 py-1.5 rounded text-sm text-white disabled:opacity-50 ${mode === 'delete' ? 'bg-red-600 hover:bg-red-500' : 'bg-accent hover:brightness-110'}`}>
            {mode === 'delete' ? 'Delete' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  )
}
