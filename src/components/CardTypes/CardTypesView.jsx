import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, Library, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../../store'
import TopBar from '../Layout/TopBar'
import { KIND_LABELS, NAME_FIELD, fieldMap, typesUsing } from '../../cardModel/model'
import FieldEditor from './FieldEditor'
import { DeleteFieldDialog, DeleteTypeDialog, NewFieldDialog, NewTypeDialog } from './dialogs'

const input = 'px-2 py-1.5 bg-surface-2 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'
const COLORS = ['#7c6ef0', '#e0794a', '#3fa7d6', '#59c26d', '#d65b8f', '#c9a227', '#8a8f98']

// Card Types: the project's data model. Types say which fields a card has (and which template
// draws it by default); the field library defines each field once. Templates only display it.
export default function CardTypesView() {
  const model = useStore((s) => s.cardModel)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [selected, setSelected] = useState(null) // type id, or 'fields'
  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    const s = useStore.getState()
    s.loadCardModel()
    s.loadTemplates()
  }, [activeProjectId])

  useEffect(() => {
    if (selected === 'fields') return
    if (!model.types.some((t) => t.id === selected) && model.types.length) setSelected(model.types[0].id)
  }, [model.types, selected])

  const move = async (index, delta) => {
    const ids = model.types.map((t) => t.id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    await useStore.getState().reorderCardTypes(ids)
  }

  const type = model.types.find((t) => t.id === selected) || null
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Card Types" />
      <div className="px-6 py-2 text-xs text-text-muted border-b border-border">
        A card type decides which fields a card has. Templates (in the Designer) decide how a type looks.
      </div>
      <div className="flex-1 flex min-h-0">
        <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-surface-1" data-testid="type-list">
          <div className="flex-1 overflow-auto py-2">
            {model.types.map((t, i) => (
              <div
                key={t.id}
                data-type-row={t.name}
                onClick={() => setSelected(t.id)}
                className={`group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer ${selected === t.id ? 'bg-accent/15 text-text-primary' : 'hover:bg-surface-2 text-text-secondary'}`}
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                <span className="flex-1 truncate text-sm">{t.name}</span>
                <span className="text-[11px] text-text-muted">{t.card_count}</span>
                <span className="hidden group-hover:flex">
                  <button title="Move up" className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1) }}><ArrowUp size={12} /></button>
                  <button title="Move down" className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30" disabled={i === model.types.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1) }}><ArrowDown size={12} /></button>
                </span>
              </div>
            ))}
            <button data-testid="new-type" onClick={() => setDialog({ kind: 'newType' })} className="flex items-center gap-2 px-3 py-2 mx-2 text-sm text-accent hover:bg-surface-2 rounded-lg w-[calc(100%-1rem)]">
              <Plus size={14} /> New type
            </button>
          </div>
          <button
            data-testid="all-fields"
            onClick={() => setSelected('fields')}
            className={`flex items-center gap-2 px-4 py-3 border-t border-border text-sm ${selected === 'fields' ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-surface-2'}`}
          >
            <Library size={14} /> All fields ({model.fields.length})
          </button>
        </aside>
        <main className="flex-1 overflow-auto">
          {selected === 'fields' ? <AllFields onDelete={(f) => setDialog({ kind: 'deleteField', field: f })} /> : type ? (
            <TypeEditor key={type.id} type={type} onDialog={setDialog} />
          ) : null}
        </main>
      </div>
      {dialog?.kind === 'newType' && <NewTypeDialog onClose={(id) => { setDialog(null); if (id) setSelected(id) }} />}
      {dialog?.kind === 'newField' && <NewFieldDialog typeId={dialog.typeId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deleteType' && <DeleteTypeDialog type={dialog.type} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deleteField' && <DeleteFieldDialog field={dialog.field} onClose={() => setDialog(null)} />}
    </div>
  )
}

function TypeEditor({ type, onDialog }) {
  const model = useStore((s) => s.cardModel)
  const templates = useStore((s) => s.templates)
  const [name, setName] = useState(type.name)
  const [open, setOpen] = useState(null) // field key whose editor is open
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => setName(type.name), [type.name])

  const fields = useMemo(() => fieldMap(model), [model])
  const save = async (patch) => {
    setError(null)
    const res = await useStore.getState().saveCardType({ ...type, ...patch })
    if (res.error) setError(res.error)
    return res
  }
  const moveField = (i, d) => {
    const keys = [...type.field_keys]
    const j = i + d
    if (j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    save({ field_keys: keys })
  }
  const addExisting = async (key) => {
    setAddOpen(false)
    await save({ field_keys: [...type.field_keys, key] })
  }
  const addStandard = async (std) => {
    setAddOpen(false)
    const res = await useStore.getState().saveCardField({ create: true, key: std.key, label: std.label, kind: std.kind, options: std.options || [], help: std.help || '' })
    if (res.error) { setError(res.error); return }
    await save({ field_keys: [...type.field_keys, std.key] })
  }

  const notInType = model.fields.filter((f) => !type.field_keys.includes(f.key))
  const standardMissing = model.standardFields.filter((f) => !fields.has(f.key))
  const openInDesigner = () => {
    const s = useStore.getState()
    s.guardUnsaved(() => { s.setActiveView('designer'); s.openTemplate(type.template_id) })
  }

  return (
    <div className="max-w-3xl p-6 space-y-6" data-testid="type-editor">
      <section className="flex flex-wrap items-end gap-4">
        <label className="space-y-1">
          <span className="block text-xs text-text-secondary">Type name</span>
          <input data-testid="type-name" className={`${input} w-56`} value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== type.name && save({ name })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </label>
        <div className="space-y-1">
          <span className="block text-xs text-text-secondary">Colour</span>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} title={c} onClick={() => save({ color: c })} className={`w-6 h-6 rounded-full border-2 ${type.color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-text-secondary">Template (how this type looks)</span>
          <span className="flex gap-2 items-center">
            <select data-testid="type-template" className={`${input} w-52`} value={type.template_id ?? ''} onChange={(e) => save({ template_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Project default</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {type.template_id && (
              <button onClick={openInDesigner} className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><ExternalLink size={12} /> Open in Designer</button>
            )}
          </span>
        </label>
        <button onClick={() => onDialog({ kind: 'deleteType', type })} className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded text-text-muted hover:text-danger hover:bg-surface-2" data-testid="delete-type">
          <Trash2 size={13} /> Delete type
        </button>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-text-primary">Fields</h3>
          <span className="text-xs text-text-muted">In the order the card form shows them. Click a field to edit it.</span>
        </div>
        <div className="rounded-lg border border-border divide-y divide-border bg-surface-1" data-testid="type-fields">
          <FieldRow field={NAME_FIELD} fixed />
          {type.field_keys.map((key, i) => {
            const f = fields.get(key)
            if (!f) return null
            return (
              <div key={key}>
                <FieldRow
                  field={f}
                  open={open === key}
                  onToggle={() => setOpen(open === key ? null : key)}
                  onUp={i > 0 ? () => moveField(i, -1) : null}
                  onDown={i < type.field_keys.length - 1 ? () => moveField(i, 1) : null}
                  onRemove={() => save({ field_keys: type.field_keys.filter((k) => k !== key) })}
                />
                {open === key && <div className="px-3 pb-3"><FieldEditor field={f} /></div>}
              </div>
            )
          })}
        </div>
        <div className="relative">
          <button data-testid="add-field" onClick={() => setAddOpen((o) => !o)} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-surface-2 hover:bg-surface-3 text-text-primary">
            <Plus size={14} /> Add field <ChevronDown size={13} />
          </button>
          {addOpen && (
            <div className="absolute z-20 mt-1 w-72 max-h-96 overflow-auto bg-surface-2 border border-border rounded-lg shadow-xl py-1" onMouseLeave={() => setAddOpen(false)}>
              <button data-testid="add-new-field" onClick={() => { setAddOpen(false); onDialog({ kind: 'newField', typeId: type.id }) }} className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-3">New field…</button>
              {notInType.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Fields from other types</p>}
              {notInType.map((f) => (
                <button key={f.key} data-add-existing={f.key} onClick={() => addExisting(f.key)} className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary">
                  {f.label} <span className="text-[11px] text-text-muted">{KIND_LABELS[f.kind]}</span>
                </button>
              ))}
              {standardMissing.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Standard fields</p>}
              {standardMissing.map((f) => (
                <button key={f.key} data-add-standard={f.key} onClick={() => addStandard(f)} className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary">
                  {f.label} <span className="text-[11px] text-text-muted">{KIND_LABELS[f.kind]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-text-muted">Removing a field from a type keeps the values already typed into its cards; add the field back and they reappear.</p>
        {error && <p className="text-xs text-danger" data-testid="type-error">{error}</p>}
      </section>
    </div>
  )
}

function FieldRow({ field, fixed = false, open = false, onToggle, onUp, onDown, onRemove }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${fixed ? '' : 'cursor-pointer hover:bg-surface-2'}`} data-field-row={field.key} onClick={fixed ? undefined : onToggle}>
      {fixed ? <span className="w-4" /> : open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
      <span className="flex-1 text-sm text-text-primary">{field.label}{fixed && <span className="ml-2 text-[11px] text-text-muted">always first</span>}</span>
      <span className="w-20 text-[11px] text-text-muted">{KIND_LABELS[field.kind]}</span>
      <code className="w-36 truncate text-[11px] text-accent/80">{`{{${field.key}}}`}</code>
      {!fixed && (
        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <button title="Move up" disabled={!onUp} onClick={onUp} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-25"><ArrowUp size={13} /></button>
          <button title="Move down" disabled={!onDown} onClick={onDown} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-25"><ArrowDown size={13} /></button>
          <button title="Remove from this type (values are kept)" data-remove-field={field.key} onClick={onRemove} className="p-1 text-text-muted hover:text-danger"><X size={13} /></button>
        </span>
      )}
      {fixed && <span className="w-[4.5rem]" />}
    </div>
  )
}

function AllFields({ onDelete }) {
  const model = useStore((s) => s.cardModel)
  const [open, setOpen] = useState(null)
  return (
    <div className="max-w-3xl p-6 space-y-3" data-testid="all-fields-view">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">All fields</h3>
        <p className="text-xs text-text-muted">Every field in this project. A field can be used by several types (one "Cost" for Units and Spells). Delete only works for fields no type uses.</p>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border bg-surface-1">
        {model.fields.map((f) => {
          const users = typesUsing(model, f.key)
          return (
            <div key={f.key}>
              <div className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2" onClick={() => setOpen(open === f.key ? null : f.key)} data-library-row={f.key}>
                {open === f.key ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                <span className="flex-1 text-sm text-text-primary">{f.label}</span>
                <span className="w-20 text-[11px] text-text-muted">{KIND_LABELS[f.kind]}</span>
                <span className="w-40 truncate text-[11px] text-text-muted">{users.length ? users.map((t) => t.name).join(', ') : 'unused'}</span>
                <button
                  title={users.length ? 'Remove it from every type first' : 'Delete field'}
                  disabled={users.length > 0}
                  onClick={(e) => { e.stopPropagation(); onDelete(f) }}
                  className="p-1 text-text-muted hover:text-danger disabled:opacity-25"
                  data-delete-field={f.key}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {open === f.key && <div className="px-3 pb-3"><FieldEditor field={f} /></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
