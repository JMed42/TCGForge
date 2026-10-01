import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useStore } from '../../store'

// Phase 0 editor: raw template JSON. Replaced by the layer editor in Phase 1.
export default function TemplateJsonPanel() {
  const { templates, activeTemplateId, saveTemplate } = useStore()
  const active = templates.find((t) => t.id === activeTemplateId)
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setText(active?.content || '')
    setError(active?.error ? `File has invalid JSON: ${active.error}` : null)
    setDirty(false)
  }, [active?.id, active?.content])

  const handleSave = async () => {
    const err = await saveTemplate(text)
    setError(err)
    if (!err) setDirty(false)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  if (!active) {
    return <div className="w-80 min-w-[220px] flex-shrink bg-surface-1 border-l border-border" />
  }

  return (
    <div className="w-80 min-w-[220px] flex-shrink bg-surface-1 border-l border-border flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          {active.id}.json{dirty ? ' •' : ''}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-accent hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 rounded text-white text-xs font-medium"
        >
          <Save size={14} />
          Save &amp; render
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true) }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="flex-1 p-4 bg-surface-1 text-text-primary font-mono text-xs leading-5 resize-none focus:outline-none"
      />
      {error && <div className="px-4 py-2 border-t border-border text-xs text-danger">{error}</div>}
    </div>
  )
}
