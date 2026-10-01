import { useState } from 'react'
import { Plus, Trash2, LayoutTemplate } from 'lucide-react'
import { useStore } from '../../store'

export default function TemplatePicker() {
  const {
    templates,
    activeTemplateId,
    setActiveTemplate,
    createTemplate,
    deleteTemplate,
    cards,
    previewCardId,
    setPreviewCard,
  } = useStore()
  const [newName, setNewName] = useState(null)
  const [error, setError] = useState(null)

  const handleCreate = async (e) => {
    e.preventDefault()
    const name = (newName || '').trim()
    if (!name) return
    const err = await createTemplate(name)
    setError(err)
    if (!err) setNewName(null)
  }

  return (
    <div className="w-64 flex-shrink-0 bg-surface-1 border-r border-border flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border space-y-2">
        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide">
          Template
        </label>
        <select
          value={activeTemplateId || ''}
          onChange={(e) => setActiveTemplate(e.target.value ? Number(e.target.value) : null)}
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
                onClick={() => deleteTemplate(activeTemplateId)}
                title="Delete template file"
                className="px-2 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-2">
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
