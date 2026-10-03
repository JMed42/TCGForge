import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Redo2, Trash2, Undo2, X } from 'lucide-react'
import { useStore } from '../../store'
import CardArtField from './CardArtField'
import { cellKey, getFieldRaw, sameValue } from './grid/cardFields'
import { markEdit } from './grid/liveTiming'
import { fieldMap, fieldsForType, isNumeric, KIND_LABELS, NAME_FIELD, STANDARD_KEYS } from '../../cardModel/model'
import { FitLine } from '../Fit/FitStatus'
import { useFieldFits } from '../Fit/useFit'
import { useLibrary } from '../../designer/library/LibraryContext.ts'
import { remindersOn } from '../../designer/library/library.ts'

const SAVE_DELAY_MS = 500
const inputClass = 'w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent'

// One field. Typing shows in the preview at once (store.liveEdit) and saves itself SAVE_DELAY_MS
// after the last keystroke, on leaving the field, or when the card changes. While the field has
// focus, a save coming back from the database never overwrites what is being typed.
// fits: the text layers that show this field, with their fit budget (src/components/Fit): shown
// while the field has focus, and always when the text doesn't fit as set.
function FieldInput({ card, field, autoFocus, fits }) {
  const key = cellKey(field.key)
  const stored = getFieldRaw(card, key)
  const [value, setValue] = useState(stored)
  const focused = useRef(false)
  const [hasFocus, setHasFocus] = useState(false)
  const timer = useRef(null)
  const latest = useRef({ cardId: card.id, value: stored, stored })
  const inputRef = useRef(null)
  latest.current.stored = stored

  useEffect(() => {
    if (!focused.current) { setValue(stored); latest.current.value = stored }
  }, [card.id, stored])

  const commit = () => {
    clearTimeout(timer.current)
    timer.current = null
    const { cardId, value: v, stored: s } = latest.current
    if (sameValue(v, s)) { useStore.getState().clearLiveEdit(); return }
    if (field.key === 'name' && !String(v).trim()) {
      setValue(s)
      latest.current.value = s
      useStore.getState().clearLiveEdit()
      return
    }
    useStore.getState().commitCell(cardId, key, v)
  }

  // Save anything pending when the card changes or the form closes.
  useEffect(() => {
    latest.current.cardId = card.id
    return () => { if (timer.current) commit() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  useEffect(() => {
    if (autoFocus && inputRef.current) { inputRef.current.focus(); inputRef.current.select?.() }
  }, [autoFocus, card.id])

  const change = (v, e) => {
    if (e) markEdit(e.timeStamp)
    setValue(v)
    latest.current.value = v
    useStore.getState().setLiveEdit(card.id, key, v)
    clearTimeout(timer.current)
    timer.current = setTimeout(commit, SAVE_DELAY_MS)
  }
  const now = (v) => { setValue(v); latest.current.value = v; commit() }
  const common = {
    onFocus: () => { focused.current = true; setHasFocus(true) },
    onBlur: () => { focused.current = false; setHasFocus(false); commit() },
    'data-field-input': field.key,
  }

  let control
  switch (field.kind) {
    case 'longText':
      control = <AutoTextarea inputRef={inputRef} value={String(value ?? '')} onChange={(e) => change(e.target.value, e)} {...common} />
      break
    case 'choice': {
      const opts = field.options || []
      const v = String(value ?? '')
      control = (
        <select ref={inputRef} className={inputClass} value={v} onChange={(e) => now(e.target.value)} {...common}>
          <option value="">—</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          {v && !opts.includes(v) && <option value={v}>{v} (not an option)</option>}
        </select>
      )
      break
    }
    case 'yesNo':
      control = (
        <label className="inline-flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
          <input ref={inputRef} type="checkbox" className="w-4 h-4 accent-accent" checked={value === true || value === 'true'} onChange={(e) => now(e.target.checked)} data-field-input={field.key} />
          {value === true || value === 'true' ? 'Yes' : 'No'}
        </label>
      )
      break
    case 'image':
      control = <CardArtField projectId={card.project_id} value={String(value ?? '')} onChange={(path) => now(path)} name={card.name} />
      break
    default:
      control = <input ref={inputRef} className={inputClass} value={String(value ?? '')} onChange={(e) => change(e.target.value, e)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} {...common} />
  }

  const warn = field.kind === 'number' && String(value ?? '').trim() !== '' && !isNumeric(value)
  const budget = (fits || []).filter((item) => hasFocus || item.result.status !== 'fits').slice(0, 2)
  return (
    <div className="space-y-1" data-form-field={field.key}>
      <label className="flex items-baseline gap-2 text-sm font-medium text-text-primary">
        {field.label}
        <span className="text-[10px] font-normal text-text-muted">{KIND_LABELS[field.kind]}</span>
      </label>
      {control}
      {budget.length > 0 && <div data-testid="fit-budget">{budget.map((item) => <FitLine key={item.layerId} item={item} />)}</div>}
      {warn && <p className="text-[11px] text-amber-400">Not a number. Templates will show it as typed; sorting puts it last.</p>}
      {field.help && !warn && <p className="text-[11px] text-text-muted">{field.help}</p>}
    </div>
  )
}

function AutoTextarea({ inputRef, value, ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(400, el.scrollHeight + 2)}px`
  }, [value])
  return (
    <textarea
      ref={(el) => { ref.current = el; if (inputRef) inputRef.current = el }}
      rows={3}
      className={`${inputClass} resize-none leading-relaxed`}
      value={value}
      spellCheck
      {...props}
    />
  )
}

// Values stored on the card for fields its type doesn't use (after a type change or a field was
// removed from the type). Kept, not lost; shown here so they can be cleared.
function OtherValues({ card, typeFields }) {
  const model = useStore((s) => s.cardModel)
  const fields = fieldMap(model)
  const used = new Set(typeFields.map((f) => f.key))
  const rows = []
  for (const k of STANDARD_KEYS) {
    if (used.has(k) || k === 'tags') continue
    const v = String(card[k] ?? '')
    if (v.trim()) rows.push({ key: k, cell: k, label: fields.get(k)?.label || k, value: v })
  }
  for (const [k, v] of Object.entries(card.custom_fields || {})) {
    if (used.has(k) || v === '' || v === null || v === undefined) continue
    rows.push({ key: k, cell: `custom:${k}`, label: fields.get(k)?.label || k, value: typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v) })
  }
  if (!rows.length) return null
  return (
    <details className="rounded-lg border border-border bg-surface-1/60" data-testid="other-values">
      <summary className="px-3 py-2 text-xs text-text-secondary cursor-pointer">Other stored values ({rows.length}) — not part of this card type</summary>
      <div className="px-3 pb-3 space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className="w-32 text-text-muted truncate">{r.label}</span>
            <span className="flex-1 text-text-secondary truncate" title={r.value}>{r.value}</span>
            <button className="p-1 text-text-muted hover:text-danger" title="Clear this value" onClick={() => useStore.getState().commitCell(card.id, r.cell, '')}><X size={12} /></button>
          </div>
        ))}
      </div>
    </details>
  )
}

// Keyword reminder text for this card (Phase 4): the project/set default, or always show / hide.
// Only shown when the project has keywords; "Default" says what the default gives this card.
function ReminderChoice({ card }) {
  const library = useLibrary()
  if (!library.keywords.length) return null
  const fallback = remindersOn(library, { ...card, reminders: null })
  const set = String(card.set_name || '')
  const why = set && Object.prototype.hasOwnProperty.call(library.reminders.sets, set) ? `set ${set}` : 'project'
  const value = card.reminders === null || card.reminders === undefined ? '' : String(card.reminders ? 1 : 0)
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary" data-testid="reminder-choice">
      <span className="font-medium">Reminder text</span>
      <select
        data-testid="card-reminders"
        className="px-2 py-1 bg-surface-2 border border-border rounded text-sm text-text-primary"
        value={value}
        onChange={(e) => useStore.getState().commitCell(card.id, 'reminders', e.target.value)}
      >
        <option value="">Default ({fallback ? 'shown' : 'hidden'}, {why})</option>
        <option value="1">Show</option>
        <option value="0">Hide</option>
      </select>
      <span className="text-xs text-text-muted">for keywords in this card's text</span>
    </label>
  )
}

/** The selected card as a form with its type's fields. */
export default function CardForm({ focusName }) {
  const card = useStore((s) => s.cards.find((c) => c.id === s.activeCardId) || null)
  const model = useStore((s) => s.cardModel)
  const saving = useStore((s) => s.savingCount > 0)
  const typing = useStore((s) => Boolean(s.liveEdit))
  const error = useStore((s) => s.cellError)
  const canUndo = useStore((s) => s.cellHistory.past.length > 0)
  const canRedo = useStore((s) => s.cellHistory.future.length > 0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const typeFields = useMemo(() => (card ? fieldsForType(model, card.card_type_id) : [NAME_FIELD]), [model, card?.card_type_id])
  const fieldFits = useFieldFits(card?.id)
  useEffect(() => setConfirmDelete(false), [card?.id])

  if (!card) {
    return <div className="flex-1 flex items-center justify-center text-sm text-text-muted">Select a card, or create one with “New card”.</div>
  }
  const s = useStore.getState()
  return (
    <div className="flex-1 min-w-0 flex flex-col" data-testid="card-form">
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Card type
          <select
            data-testid="card-type-select"
            className="px-2 py-1 bg-surface-2 border border-border rounded text-sm text-text-primary"
            value={card.card_type_id ?? ''}
            onChange={(e) => s.commitCell(card.id, 'card_type_id', e.target.value)}
          >
            {model.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <span className="text-[11px] text-text-muted" data-testid="save-status">{error ? '' : typing ? 'Editing…' : saving ? 'Saving…' : 'All changes saved'}</span>
        <div className="flex-1" />
        <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => s.undoCellEdit()} className="p-1.5 rounded hover:bg-surface-2 text-text-secondary disabled:opacity-30" data-testid="form-undo"><Undo2 size={15} /></button>
        <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => s.redoCellEdit()} className="p-1.5 rounded hover:bg-surface-2 text-text-secondary disabled:opacity-30" data-testid="form-redo"><Redo2 size={15} /></button>
        <button title="Duplicate card" onClick={() => s.duplicateCardAndSelect(card.id)} className="p-1.5 rounded hover:bg-surface-2 text-text-secondary"><Copy size={15} /></button>
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="text-text-secondary">Delete this card?</span>
            <button className="px-2 py-1 rounded bg-red-600 text-white" data-testid="confirm-delete-card" onClick={() => s.deleteCardAndSelectNext(card.id)}>Delete</button>
            <button className="px-2 py-1 rounded bg-surface-2 text-text-secondary" onClick={() => setConfirmDelete(false)}>Keep</button>
          </span>
        ) : (
          <button title="Delete card" onClick={() => setConfirmDelete(true)} className="p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-danger" data-testid="delete-card"><Trash2 size={15} /></button>
        )}
      </div>
      {error && <p className="px-5 py-1.5 text-xs text-danger border-b border-border" data-testid="form-error">{error}</p>}
      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="max-w-xl space-y-4">
          {typeFields.map((f, i) => <FieldInput key={`${card.id}:${f.key}`} card={card} field={f} autoFocus={focusName === card.id && i === 0} fits={fieldFits.get(f.key)} />)}
          <ReminderChoice card={card} />
          <OtherValues card={card} typeFields={typeFields} />
        </div>
      </div>
    </div>
  )
}

