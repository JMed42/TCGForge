import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { LibraryContext } from '../../designer/library/LibraryContext.ts'
import { compileLibrary } from '../../designer/library/library.ts'
import WhereUsedDialog from './WhereUsedDialog'
import { keywordRename, keywordWhereUsed, usesCount } from './whereUsed'

const input = 'w-full px-2 py-1.5 bg-surface-2 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'
const blank = () => ({ id: null, name: '', params: [], reminder_template: '', rule_ref: null })
const example = (p) => (p.kind === 'word' ? 'Dragon' : '2')
const shownName = (k) => [k.name, ...k.params.map((p) => p.name)].join(' ')

// The keyword as it appears on a card ("Burn 2" + its reminder), drawn by the real renderer with
// the keyword as it is being edited.
function KeywordPreview({ projectId, rows, draft, values }) {
  const lib = useMemo(() => compileLibrary({
    ...rows,
    keywords: [...rows.keywords.filter((k) => k.id !== draft.id), draft].filter((k) => k.name.trim()),
  }), [rows, draft])
  const text = [draft.name, ...values].join(' ') + '. Draw a card.'
  const template = {
    schemaVersion: 1, size: { widthMm: 80, heightMm: 16, bleedMm: 0, safeMm: 0 },
    layers: [
      { id: 'bg', type: 'shape', shape: 'rect', frame: { left: 0, right: 0, top: 0, bottom: 0 }, fill: '#20232c' },
      { id: 'line', type: 'richText', keywords: true, text, frame: { left: 2, right: 2, top: 1.5, bottom: 1 }, style: { font: 'Georgia', sizePt: 8.5, color: '#f1f1f1' } },
    ],
  }
  return (
    <LibraryContext.Provider value={lib}>
      <div data-testid="keyword-preview"><CardRender template={template} card={{ reminders: 1 }} projectId={projectId} pxPerMm={5} /></div>
    </LibraryContext.Provider>
  )
}

function KeywordEditor({ projectId, rows, initial, onDone }) {
  const [draft, setDraft] = useState(initial)
  const [values, setValues] = useState(() => initial.params.map(example))
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)
  const cards = useStore((s) => s.cards)
  const documents = useStore((s) => s.documents)
  const ruleEntries = documents.filter((d) => d.type === 'rule')
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setParam = (i, patch) => set({ params: draft.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const addParam = () => {
    const name = ['X', 'Y', 'N', 'M'].find((n) => !draft.params.some((p) => p.name === n)) || 'P'
    set({ params: [...draft.params, { name, kind: 'number' }] })
    setValues((v) => [...v, '2'])
  }
  const insert = (token) => set({ reminder_template: `${draft.reminder_template}{{${token}}}` })

  const original = initial.id ? rows.keywords.find((k) => k.id === initial.id) : null
  const fields = () => ({ ...draft, name: draft.name.trim() })
  const save = async () => {
    setError(null)
    const to = draft.name.trim()
    if (original && to.toLowerCase() !== original.name.toLowerCase()) {
      const uses = keywordWhereUsed({ cards, documents }, original.name)
      if (usesCount(uses)) {
        setDialog({
          mode: 'rename', title: `Rename ${original.name} to ${to}`, what: original.name, uses,
          onConfirm: async (everywhere) => {
            const s = useStore.getState()
            await s.renameLibraryItem({ change: { kind: 'keyword', id: original.id, to }, ...(everywhere ? keywordRename(uses, original.name, to) : { cards: [], templates: [], rules: [] }) })
            await s.saveKeyword(fields())
            onDone(to)
          },
        })
        return
      }
    }
    try {
      await useStore.getState().saveKeyword(fields())
      onDone(to)
    } catch (e) { setError(e.message) }
  }
  const remove = () => setDialog({
    mode: 'delete', title: `Delete ${original.name}`, what: original.name, uses: keywordWhereUsed({ cards, documents }, original.name),
    onConfirm: async () => { await useStore.getState().deleteLibraryItem('keyword', original.id); onDone(null) },
  })
  const openRule = (id) => { const s = useStore.getState(); s.setActiveDocument(id); s.setActiveView('rules') }
  const newRule = async () => {
    setError(null)
    try {
      const doc = await window.api.createDocument(projectId, { title: draft.name.trim() || 'Keyword', type: 'rule', parentId: null })
      await useStore.getState().loadDocuments()
      set({ rule_ref: doc.id })
    } catch (e) { setError(String(e.message || e)) }
  }

  return (
    <div className="space-y-4" data-testid="keyword-editor">
      <label className="block space-y-1 text-xs text-text-muted">
        Name, as it is written on cards
        <input data-testid="keyword-name" className={input} value={draft.name} placeholder="Burn" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="space-y-1">
        <span className="text-xs text-text-muted">Parameters: values written after the name ("Burn 3"); the reminder text uses them</span>
        {draft.params.map((p, i) => (
          <div key={i} className="flex items-center gap-2" data-keyword-param={i}>
            <input data-testid={`param-name-${i}`} className={`${input} w-24 font-mono`} value={p.name} onChange={(e) => setParam(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} />
            <select data-testid={`param-kind-${i}`} className={`${input} w-28`} value={p.kind} onChange={(e) => setParam(i, { kind: e.target.value })}>
              <option value="number">a number</option>
              <option value="word">a word</option>
            </select>
            <span className="text-[11px] text-text-muted">example</span>
            <input data-testid={`param-example-${i}`} className={`${input} w-24`} value={values[i] ?? ''} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
            <button title="Remove" onClick={() => { set({ params: draft.params.filter((_, j) => j !== i) }); setValues((v) => v.filter((_, j) => j !== i)) }} className="p-1 text-text-muted hover:text-danger"><X size={13} /></button>
          </div>
        ))}
        {draft.params.length < 4 && <button data-testid="add-param" onClick={addParam} className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><Plus size={12} /> Add parameter</button>}
      </div>
      <label className="block space-y-1 text-xs text-text-muted">
        Reminder text (added in italics after the keyword; {'{{ }}'} works, e.g. {'{{if(X > 1, "s", "")}}'})
        <textarea data-testid="keyword-reminder" rows={3} className={`${input} font-mono resize-y`} value={draft.reminder_template} placeholder="(Deal {{X}} damage to a unit.)" onChange={(e) => set({ reminder_template: e.target.value })} />
      </label>
      {draft.params.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {draft.params.map((p) => <button key={p.name} onClick={() => insert(p.name)} className="px-1.5 py-0.5 rounded bg-surface-2 text-[11px] font-mono text-text-secondary hover:text-accent">{`{{${p.name}}}`}</button>)}
          {draft.params.filter((p) => p.kind === 'number').slice(0, 1).map((p) => (
            <button key="if" onClick={() => insert(`if(${p.name} > 1, "s", "")`)} className="px-1.5 py-0.5 rounded bg-surface-2 text-[11px] font-mono text-text-secondary hover:text-accent">{`plural for ${p.name}`}</button>
          ))}
        </div>
      )}
      {draft.name.trim() && <KeywordPreview projectId={projectId} rows={rows} draft={draft} values={values} />}
      <div className="space-y-1">
        <span className="text-xs text-text-muted">Rule entry in Game Docs</span>
        <div className="flex items-center gap-2">
          <select data-testid="keyword-rule" className={input} value={draft.rule_ref ?? ''} onChange={(e) => set({ rule_ref: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>
            {ruleEntries.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          {draft.rule_ref
            ? <button data-testid="keyword-open-rule" onClick={() => openRule(draft.rule_ref)} className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-xs text-text-secondary"><BookOpen size={13} /> Open</button>
            : <button data-testid="keyword-new-rule" onClick={newRule} className="flex-shrink-0 px-2 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-xs text-text-secondary">New rule entry</button>}
        </div>
      </div>
      {error && <p className="text-xs text-danger" data-testid="keyword-error">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} data-testid="keyword-save" className="px-3 py-1.5 rounded bg-accent hover:brightness-110 text-sm text-white">Save</button>
        <button onClick={() => onDone(undefined)} className="px-3 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-sm text-text-secondary">Cancel</button>
        {original && <button onClick={remove} data-testid="keyword-delete" className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm text-text-muted hover:text-danger hover:bg-surface-2"><Trash2 size={14} /> Delete</button>}
      </div>
      {dialog && <WhereUsedDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

// Reminder text on or off: for the whole project, then per set (by the cards' Set value). A
// card can still choose for itself in its form.
function ReminderSettings({ rows, cards }) {
  const settings = rows.settings.reminders
  const sets = useMemo(() => [...new Set(cards.map((c) => String(c.set_name || '').trim()).filter(Boolean))].sort(), [cards])
  const save = (patch) => useStore.getState().saveLibrarySettings({ reminders: { ...settings, ...patch } })
  const setSet = (name, value) => {
    const next = { ...settings.sets }
    if (value === '') delete next[name]
    else next[name] = value === 'show'
    save({ sets: next })
  }
  return (
    <div className="p-3 rounded-lg border border-border bg-surface-1 space-y-2 text-xs" data-testid="reminder-settings">
      <label className="flex items-center gap-2 text-text-primary">
        <input data-testid="reminders-default" type="checkbox" className="accent-accent" checked={settings.show} onChange={(e) => save({ show: e.target.checked })} />
        Show reminder text
      </label>
      {sets.length > 0 ? (
        <div className="space-y-1">
          <span className="text-text-muted">By set</span>
          {sets.map((name) => (
            <div key={name} className="flex items-center gap-2" data-reminder-set={name}>
              <span className="flex-1 truncate text-text-secondary">{name}</span>
              <select className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-primary" value={name in settings.sets ? (settings.sets[name] ? 'show' : 'hide') : ''} onChange={(e) => setSet(name, e.target.value)}>
                <option value="">As above</option>
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </div>
          ))}
        </div>
      ) : <p className="text-text-muted">Cards with a Set value can be switched per set here.</p>}
      <p className="text-text-muted">Each card can also choose for itself in its form. Text layers show reminders when their “Keywords” switch is on.</p>
    </div>
  )
}

export default function KeywordsTab() {
  const projectId = useStore((s) => s.activeProjectId)
  const rows = useStore((s) => s.library)
  const cards = useStore((s) => s.cards)
  const documents = useStore((s) => s.documents)
  const focus = useStore((s) => s.libraryFocus)
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    if (focus?.kind === 'keyword') { setSelected(focus.id); useStore.getState().clearLibraryFocus() }
  }, [focus])
  const counts = useMemo(() => new Map(rows.keywords.map((k) => [k.id, keywordWhereUsed({ cards, documents: [] }, k.name).cards.length])), [rows, cards])
  const editing = selected === 'new' ? blank() : rows.keywords.find((k) => k.id === selected) || null
  // Fixed while an item is open, so a library reload doesn't reset what is being edited.
  const initial = useMemo(() => editing && { ...editing, params: editing.params.map((p) => ({ ...p })) }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = (name) => {
    if (name === undefined) { setSelected(null); return }
    const k = useStore.getState().library.keywords.find((x) => x.name.toLowerCase() === String(name).toLowerCase())
    setSelected(k ? k.id : null)
  }
  const ruleTitle = (id) => documents.find((d) => d.id === id)?.title
  return (
    <div className="h-full flex">
      <div className="w-80 flex-shrink-0 border-r border-border overflow-auto p-4 space-y-3">
        <button data-testid="new-keyword" onClick={() => setSelected('new')} className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-sm"><Plus size={14} /> New keyword</button>
        <div className="space-y-1" data-testid="keyword-list">
          {rows.keywords.map((k) => (
            <button key={k.id} data-keyword-row={k.name} onClick={() => setSelected(k.id)} className={`w-full text-left px-3 py-2 rounded-lg ${selected === k.id ? 'bg-accent/15' : 'hover:bg-surface-2'}`}>
              <span className="block text-sm text-text-primary">{shownName(k)}</span>
              <span className="block text-[11px] text-text-muted truncate">
                {counts.get(k.id) ? `${counts.get(k.id)} card${counts.get(k.id) === 1 ? '' : 's'}` : 'not used yet'}
                {k.rule_ref && ruleTitle(k.rule_ref) ? ` · rule: ${ruleTitle(k.rule_ref)}` : ''}
              </span>
            </button>
          ))}
          {!rows.keywords.length && <p className="px-1 text-xs text-text-muted">No keywords yet.</p>}
        </div>
        <ReminderSettings rows={rows} cards={cards} />
      </div>
      <div className="flex-1 overflow-auto p-6">
        {initial ? (
          <div className="max-w-xl">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">{selected === 'new' ? 'New keyword' : shownName(initial)}</h3>
            <KeywordEditor key={selected} projectId={projectId} rows={rows} initial={initial} onDone={done} />
          </div>
        ) : (
          <p className="max-w-lg text-sm text-text-muted">
            Define a keyword once, like <span className="text-text-secondary">Burn X</span>, with reminder text that uses its
            value: <span className="text-text-secondary italic">(Deal X damage to a unit.)</span>. Cards that say “Burn 3” then get
            “(Deal 3 damage to a unit.)” after it, in text layers whose Keywords switch is on. Link it to a rule entry in Game Docs.
          </p>
        )}
      </div>
    </div>
  )
}
