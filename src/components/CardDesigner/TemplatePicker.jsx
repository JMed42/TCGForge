import { useState } from 'react'
import { Plus, Trash2, LayoutTemplate, FileDown, FileUp, ListOrdered } from 'lucide-react'
import { useStore } from '../../store'
import TemplateAssignmentDialog from '../Cards/TemplateAssignmentDialog'

export default function TemplatePicker() {
  const {
    templates,
    activeTemplateId,
    setActiveTemplate,
    createTemplate,
    deleteTemplate,
    guardUnsaved,
    cards,
    previewCardId,
    setPreviewCard,
    exportTemplateFile,
    importTemplateFile,
  } = useStore()
  const [fileStatus, setFileStatus] = useState(null) // { message } | { error }
  const [newName, setNewName] = useState(null)
  const [error, setError] = useState(null)
  const [rulesOpen, setRulesOpen] = useState(false)

  const handleCreate = async (e) => {
    e.preventDefault()
    const name = (newName || '').trim()
    if (!name) return
    await guardUnsaved(async () => {
      const err = await createTemplate(name)
      setError(err)
      if (!err) setNewName(null)
    })
  }

  return (
    <div className="w-64 flex-shrink-0 bg-surface-1 border-r border-border flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border space-y-2">
        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide">
          Template
        </label>
        <select
          value={activeTemplateId || ''}
          onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; guardUnsaved(() => setActiveTemplate(id)) }}
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          {templates.length === 0 && <option value="">No templates yet</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.error ? ' (invalid JSON)' : ''}
            </option>
          ))}
        </select>

        {newName === null ? (
          <div className="flex gap-2">
            <button
              onClick={() => { setNewName(''); setError(null) }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm text-text-secondary hover:text-text-primary"
            >
              <Plus size={16} />
              New Template
            </button>
            {activeTemplateId && (
              <button
                onClick={() => {
                  const name = templates.find((t) => t.id === activeTemplateId)?.name || 'this template'
                  if (window.confirm(`Delete "${name}"? This can't be undone.`)) deleteTemplate(activeTemplateId)
                }}
                title="Delete template file"
                className="px-2 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-2" data-testid="new-template-form">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Template name"
              className="w-full px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg text-white text-sm font-medium">
                Create
              </button>
              <button type="button" onClick={() => setNewName(null)} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm text-text-secondary">
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="flex gap-2">
          <button
            data-testid="export-tcgtemplate"
            disabled={!activeTemplateId}
            onClick={async () => setFileStatus(await exportTemplateFile())}
            title="Export this template with its frames, icons and fonts (.tcgtemplate)"
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded-lg text-xs text-text-secondary hover:text-text-primary"
          >
            <FileDown size={14} /> Export
          </button>
          <button
            data-testid="import-tcgtemplate"
            onClick={async () => setFileStatus(await importTemplateFile())}
            title="Import a .tcgtemplate as a new template"
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-text-secondary hover:text-text-primary"
          >
            <FileUp size={14} /> Import
          </button>
          <button
            data-testid="designer-template-rules"
            onClick={async () => { const s = useStore.getState(); await Promise.all([s.loadTemplateRules(), s.loadCardModel()]); setRulesOpen(true) }}
            title="Template assignment: which template each card type and card uses"
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-text-secondary hover:text-text-primary"
          >
            <ListOrdered size={14} /> Assign
          </button>
        </div>
        {rulesOpen && <TemplateAssignmentDialog onClose={() => setRulesOpen(false)} />}
        {fileStatus?.message && <p className="text-[11px] text-success" data-testid="file-status">{fileStatus.message}</p>}
        {fileStatus?.error && <p className="text-[11px] text-danger" data-testid="file-status">{fileStatus.error}</p>}
        {fileStatus?.warnings?.map((w) => <p key={w} className="text-[11px] text-warning">{w}</p>)}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <div className="px-4 pt-4 pb-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
        Preview card
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {cards.length === 0 && (
          <p className="px-2 text-sm text-text-muted">No cards in this project.</p>
        )}
        {cards.map((card) => (
          <button
            key={card.id}
            onClick={() => setPreviewCard(card.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate ${
              previewCardId === card.id
                ? 'bg-surface-3 text-accent'
                : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            {card.name}
          </button>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="p-4 border-t border-border text-xs text-text-muted flex gap-2">
          <LayoutTemplate size={14} className="flex-shrink-0 mt-0.5" />
          Templates are JSON files in this project's templates folder.
        </div>
      )}
    </div>
  )
}
