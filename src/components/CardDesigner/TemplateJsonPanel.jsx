import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useStore } from '../../store'

// Advanced: edit the draft as raw template JSON. Apply replaces the draft as one undo step;
// saving is the editor's normal Save.
export default function TemplateJsonPanel() {
  const { draft, draftError, templates, activeTemplateId, applyJson } = useStore()
  const active = templates.find((t) => t.id === activeTemplateId)
  const source = draft ? JSON.stringify(draft, null, 2) : active?.content || ''
  const [text, setText] = useState(source)
  const [error, setError] = useState(null)
  const [edited, setEdited] = useState(false)

  // Follow the draft (visual edits, undo) unless the user has unapplied typing here.
  useEffect(() => {
    if (!edited) setText(source)
  }, [source, edited])

  useEffect(() => {
    setEdited(false)
    setError(draftError ? `Stored template has invalid JSON: ${draftError}` : null)
  }, [activeTemplateId, draftError])

  const handleApply = () => {
    const err = applyJson(text)
    setError(err)
    if (!err) setEdited(false)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleApply()
    }
    e.stopPropagation() // keep editor shortcuts (Delete, arrows, Ctrl+Z) out of the textarea
  }

  if (!active) return null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs text-text-muted">{edited ? 'Unapplied changes' : 'In sync with the editor'}</span>
        <button
          onClick={handleApply}
          disabled={!edited}
          title="Apply (Ctrl+Enter)"
          className="flex items-center gap-1.5 px-2.5 py-1 bg-accent hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 rounded text-white text-xs font-medium"
        >
          <Check size={14} />
          Apply
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setEdited(true) }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="flex-1 p-4 bg-surface-1 text-text-primary font-mono text-xs leading-5 resize-none focus:outline-none"
      />
      {error && <div className="px-4 py-2 border-t border-border text-xs text-danger">{error}</div>}
    </div>
  )
}
