import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store'
import { KIND_LABELS, KIND_HELP, keyFromLabel, fieldMap } from '../../cardModel/model'

const input = 'w-full px-2 py-1.5 bg-surface-2 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'

function Modal({ title, onClose, children, footer, testid }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid={testid}>
      <div className="w-[30rem] max-w-[95vw] bg-surface-1 border border-border rounded-xl shadow-2xl">
        <div className="flex items-center px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary flex-1">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-muted"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">{footer}</div>
      </div>
    </div>
  )
}

const btn = 'px-3 py-1.5 text-sm rounded'

/** New field: created in the library and added to `typeId`. */
export function NewFieldDialog({ typeId, onClose }) {
  const model = useStore((s) => s.cardModel)
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [kind, setKind] = useState('text')
  const [options, setOptions] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!keyTouched) setKey(keyFromLabel(label)) }, [label, keyTouched])

  const create = async () => {
    setBusy(true)
    setError(null)
    const s = useStore.getState()
    const res = await s.saveCardField({ create: true, label, key, kind, options: options.split('\n') })
    if (res.error) { setError(res.error); setBusy(false); return }
    const type = s.cardModel.types.find((t) => t.id === typeId) || useStore.getState().cardModel.types.find((t) => t.id === typeId)
    const r2 = await useStore.getState().saveCardType({ ...type, field_keys: [...type.field_keys, res.key] })
    setBusy(false)
    if (r2.error) setError(r2.error)
    else onClose(res.key)
  }

  const exists = key && fieldMap(model).has(key)
  return (
    <Modal title="New field" onClose={() => onClose(null)} testid="new-field-dialog" footer={(
      <>
        <button className={`${btn} bg-surface-2 hover:bg-surface-3 text-text-secondary`} onClick={() => onClose(null)}>Cancel</button>
        <button data-testid="create-field" className={`${btn} bg-accent text-white disabled:opacity-40`} disabled={busy || !label.trim() || !key || exists} onClick={create}>Add field</button>
      </>
    )}>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Label</span>
        <input data-testid="new-field-label" className={input} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="e.g. Attunement cost" onKeyDown={(e) => e.key === 'Enter' && label.trim() && !exists && create()} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Key, used in templates as {`{{${key || 'key'}}}`}</span>
        <input data-testid="new-field-key" className={`${input} font-mono`} value={key} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toLowerCase()) }} />
        {exists && <span className="block text-[11px] text-danger">A field with this key exists; add it from "Fields from other types" instead.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Kind</span>
        <select data-testid="new-field-kind" className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
          {['text', 'longText', 'number', 'choice', 'yesNo', 'image'].map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <span className="block text-[11px] text-text-muted">{KIND_HELP[kind]}</span>
      </label>
      {kind === 'choice' && (
        <label className="block space-y-1">
          <span className="text-xs text-text-secondary">Options (one per line)</span>
          <textarea rows={4} className={`${input} resize-y`} value={options} onChange={(e) => setOptions(e.target.value)} />
        </label>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </Modal>
  )
}

/** New card type, optionally starting with another type's fields. */
export function NewTypeDialog({ onClose }) {
  const model = useStore((s) => s.cardModel)
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [error, setError] = useState(null)
  const create = async () => {
    const from = model.types.find((t) => t.id === Number(copyFrom))
    const colors = ['#7c6ef0', '#e0794a', '#3fa7d6', '#59c26d', '#d65b8f', '#c9a227', '#8a8f98']
    const res = await useStore.getState().saveCardType({ name, color: colors[model.types.length % colors.length], field_keys: from ? from.field_keys : [], template_id: from ? from.template_id : null })
    if (res.error) setError(res.error)
    else onClose(res.id)
  }
  return (
    <Modal title="New card type" onClose={() => onClose(null)} testid="new-type-dialog" footer={(
      <>
        <button className={`${btn} bg-surface-2 hover:bg-surface-3 text-text-secondary`} onClick={() => onClose(null)}>Cancel</button>
        <button data-testid="create-type" className={`${btn} bg-accent text-white disabled:opacity-40`} disabled={!name.trim()} onClick={create}>Create type</button>
      </>
    )}>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Name</span>
        <input data-testid="new-type-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Unit, Spell, Equipment" onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Start with the fields of</span>
        <select data-testid="new-type-copy" className={input} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">Nothing (just Name)</option>
          {model.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
    </Modal>
  )
}

/** Delete a type; its cards move to another type first. */
export function DeleteTypeDialog({ type, onClose }) {
  const model = useStore((s) => s.cardModel)
  const others = model.types.filter((t) => t.id !== type.id)
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '')
  const [error, setError] = useState(null)
  const remove = async () => {
    const res = await useStore.getState().deleteCardType(type.id, { moveTo: Number(moveTo) })
    if (res.error) setError(res.error)
    else onClose(true)
  }
  return (
    <Modal title={`Delete "${type.name}"`} onClose={() => onClose(false)} testid="delete-type-dialog" footer={(
      <>
        <button className={`${btn} bg-surface-2 hover:bg-surface-3 text-text-secondary`} onClick={() => onClose(false)}>Cancel</button>
        <button data-testid="confirm-delete-type" className={`${btn} bg-red-600 text-white disabled:opacity-40`} disabled={!others.length} onClick={remove}>Delete type</button>
      </>
    )}>
      {!others.length ? (
        <p className="text-sm text-text-secondary">A project needs at least one card type.</p>
      ) : type.card_count > 0 ? (
        <label className="block space-y-1">
          <span className="text-sm text-text-secondary">Its {type.card_count} card(s) move to</span>
          <select className={input} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="block text-[11px] text-text-muted">Their values are kept. Fields the new type doesn't use stay stored but hidden.</span>
        </label>
      ) : (
        <p className="text-sm text-text-secondary">No cards use this type. The fields stay in the library.</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </Modal>
  )
}

/** Delete a field from the library (no type may use it), optionally clearing stored values. */
export function DeleteFieldDialog({ field, onClose }) {
  const projectId = useStore((s) => s.activeProjectId)
  const [count, setCount] = useState(null)
  const [purge, setPurge] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => { window.api.cardFieldValueCount(projectId, field.key).then(setCount).catch(() => setCount(0)) }, [projectId, field.key])
  const remove = async () => {
    const res = await useStore.getState().deleteCardField(field.key, { purgeValues: purge })
    if (res.error) setError(res.error)
    else onClose(true)
  }
  return (
    <Modal title={`Delete the field "${field.label}"`} onClose={() => onClose(false)} testid="delete-field-dialog" footer={(
      <>
        <button className={`${btn} bg-surface-2 hover:bg-surface-3 text-text-secondary`} onClick={() => onClose(false)}>Cancel</button>
        <button data-testid="confirm-delete-field" className={`${btn} bg-red-600 text-white`} onClick={remove}>Delete field</button>
      </>
    )}>
      <p className="text-sm text-text-secondary">
        {count === null ? 'Counting…' : count === 0 ? 'No card has a value for it.' : `${count} card(s) have a value for it.`}
      </p>
      {count > 0 && (
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} className="accent-accent" />
          Also delete those values
        </label>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </Modal>
  )
}
