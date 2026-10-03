import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { KIND_LABELS, KIND_HELP, STANDARD_KEYS, typesUsing } from '../../cardModel/model'

const input = 'w-full px-2 py-1 bg-surface-2 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'

// Kinds a field may take (mirrors electron/cardModel.js allowedKinds).
export function allowedKinds(key) {
  if (key === 'tags') return ['tags']
  if (key === 'image_path') return ['image']
  if (STANDARD_KEYS.has(key)) return ['text', 'longText', 'number', 'choice']
  return ['text', 'longText', 'number', 'choice', 'yesNo', 'image']
}

/** Edit one library field. Every change saves at once; errors show inline. */
export default function FieldEditor({ field }) {
  const model = useStore((s) => s.cardModel)
  const [label, setLabel] = useState(field.label)
  const [options, setOptions] = useState(field.options.join('\n'))
  const [def, setDef] = useState(field.default_value)
  const [help, setHelp] = useState(field.help)
  const [newKey, setNewKey] = useState(null) // string while renaming
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  useEffect(() => {
    setLabel(field.label); setOptions(field.options.join('\n')); setDef(field.default_value); setHelp(field.help)
    setNewKey(null); setError(null); setNote(null)
  }, [field.key, field.label, field.options, field.default_value, field.help])

  const save = async (patch) => {
    setError(null)
    const res = await useStore.getState().saveCardField({ key: field.key, ...patch })
    if (res.error) setError(res.error)
  }

  const rename = async () => {
    const to = newKey.trim()
    if (!to || to === field.key) { setNewKey(null); return }
    if (!window.confirm(`Rename {{${field.key}}} to {{${to}}}?\n\nCard values move with it, and templates and template exceptions that use {{${field.key}}} are updated.`)) return
    const res = await useStore.getState().renameCardField(field.key, to)
    if (res.error) { setError(res.error); return }
    setNote(`Renamed. Values moved on ${res.moved} card(s); ${res.templates} template(s) and ${res.rules} exception(s) updated.`)
    setNewKey(null)
  }

  const users = typesUsing(model, field.key)
  const standard = STANDARD_KEYS.has(field.key)
  return (
    <div className="space-y-3 p-3 rounded-lg bg-surface-1 border border-border" data-field-editor={field.key}>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-text-secondary">Label</span>
          <input data-testid="field-label" className={input} value={label} onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== field.label && save({ label })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </label>
        <div className="space-y-1">
          <span className="text-xs text-text-secondary">Key (used in templates)</span>
          {newKey === null ? (
            <div className="flex items-center gap-2">
              <code className="px-2 py-1 rounded bg-surface-2 text-sm text-accent" data-testid="field-key">{`{{${field.key}}}`}</code>
              {!standard && <button className="text-xs text-text-muted hover:text-accent underline decoration-dotted" onClick={() => setNewKey(field.key)}>Rename key</button>}
            </div>
          ) : (
            <div className="flex gap-1">
              <input data-testid="field-new-key" className={input} value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase())} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setNewKey(null) }} />
              <button className="px-2 text-xs rounded bg-accent text-white" onClick={rename}>Rename</button>
            </div>
          )}
        </div>
        <label className="space-y-1">
          <span className="text-xs text-text-secondary">Kind</span>
          <select data-testid="field-kind" className={input} value={field.kind} onChange={(e) => save({ kind: e.target.value })} disabled={allowedKinds(field.key).length === 1}>
            {allowedKinds(field.key).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
          <span className="block text-[11px] text-text-muted">{KIND_HELP[field.kind]}</span>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-secondary">Default for new cards</span>
          {field.kind === 'yesNo' ? (
            <select className={input} value={def} onChange={(e) => { setDef(e.target.value); save({ default_value: e.target.value }) }}>
              <option value="">No</option>
              <option value="true">Yes</option>
            </select>
          ) : field.kind === 'choice' ? (
            <select className={input} value={def} onChange={(e) => { setDef(e.target.value); save({ default_value: e.target.value }) }}>
              <option value="">(none)</option>
              {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className={input} value={def} disabled={field.kind === 'image'} onChange={(e) => setDef(e.target.value)}
              onBlur={() => def !== field.default_value && save({ default_value: def })} />
          )}
        </label>
        {field.kind === 'choice' && (
          <label className="space-y-1 col-span-2">
            <span className="text-xs text-text-secondary">Options (one per line)</span>
            <textarea data-testid="field-options" rows={4} className={`${input} resize-y`} value={options} onChange={(e) => setOptions(e.target.value)}
              onBlur={() => save({ options: options.split('\n') })} />
          </label>
        )}
        <label className="space-y-1 col-span-2">
          <span className="text-xs text-text-secondary">Hint shown in the card form</span>
          <input className={input} value={help} onChange={(e) => setHelp(e.target.value)} onBlur={() => help !== field.help && save({ help })} />
        </label>
      </div>
      <p className="text-[11px] text-text-muted">
        Used by: {users.length ? users.map((t) => t.name).join(', ') : 'no type'}{standard ? ' · standard field (stored in its own column; the key is fixed)' : ''}
      </p>
      {error && <p className="text-xs text-danger" data-testid="field-error">{error}</p>}
      {note && <p className="text-xs text-success">{note}</p>}
    </div>
  )
}
