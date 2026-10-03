import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../store'
import { VARIABLE_KEY } from '../../designer/library/variables.ts'
import { useParsedTemplates } from '../Fit/templates'
import WhereUsedDialog from './WhereUsedDialog'
import { usesCount, variableRename, variableWhereUsed } from './whereUsed'

const input = 'w-full px-2 py-1 bg-surface-2 border border-transparent hover:border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'

// One variable: key, value and description, saved when a field is left. Changing the key of a
// variable that is used asks first, and can rename it in cards, templates and exceptions.
function VariableRow({ row, uses, onDialog, onError }) {
  const [key, setKey] = useState(row.key)
  const [value, setValue] = useState(row.value)
  const [description, setDescription] = useState(row.description || '')
  const s = () => useStore.getState()
  const save = async (patch) => {
    onError(null)
    try { await s().saveVariable({ id: row.id, key: row.key, value, description, ...patch }) } catch (e) { onError(e.message) }
  }
  const commitKey = () => {
    const to = key.trim().toUpperCase()
    if (to === row.key) return
    if (!VARIABLE_KEY.test(to)) { onError('A variable name is UPPER_CASE letters, digits and _ (like HAND_SIZE).'); setKey(row.key); return }
    if (!usesCount(uses.all)) { save({ key: to }); return }
    onDialog({
      mode: 'rename', title: `Rename ${row.key} to ${to}`, what: row.key, uses: uses.all,
      onConfirm: async (everywhere) => {
        await s().renameLibraryItem({ change: { kind: 'variable', id: row.id, to }, ...(everywhere ? variableRename(uses.all, uses.templates, row.key, to) : { cards: [], templates: [], rules: [] }) })
      },
      onCancel: () => setKey(row.key),
    })
  }
  const remove = () => onDialog({
    mode: 'delete', title: `Delete ${row.key}`, what: row.key, uses: uses.all,
    onConfirm: () => s().deleteLibraryItem('variable', row.id),
  })
  return (
    <tr className="border-b border-border" data-variable-row={row.key}>
      <td className="px-2 py-1 w-56"><input data-testid="variable-key" className={`${input} font-mono`} value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} onBlur={commitKey} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></td>
      <td className="px-2 py-1 w-56"><input data-testid="variable-value" className={input} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== row.value && save({ value })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></td>
      <td className="px-2 py-1"><input className={input} value={description} placeholder="What it is for" onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== (row.description || '') && save({ description })} /></td>
      <td className="px-2 py-1 w-40 text-xs text-text-muted" data-variable-uses={row.key}>
        {usesCount(uses.all) ? [uses.all.cards.length && `${uses.all.cards.length} card${uses.all.cards.length === 1 ? '' : 's'}`, uses.all.templates.length && `${uses.all.templates.length} template${uses.all.templates.length === 1 ? '' : 's'}`].filter(Boolean).join(', ') : 'not used yet'}
      </td>
      <td className="px-2 py-1 w-10"><button title="Delete" onClick={remove} className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-2"><Trash2 size={14} /></button></td>
    </tr>
  )
}

export default function VariablesTab() {
  const rows = useStore((s) => s.library)
  const cards = useStore((s) => s.cards)
  const documents = useStore((s) => s.documents)
  const rules = useStore((s) => s.templateRules)
  const templates = useParsedTemplates()
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const uses = useMemo(() => new Map(rows.variables.map((v) => [v.key, { all: variableWhereUsed({ cards, documents, templates, rules }, v.key), templates }])), [rows, cards, documents, templates, rules])
  const add = async () => {
    setError(null)
    try {
      await useStore.getState().saveVariable({ key: newKey.trim().toUpperCase(), value: newValue })
      setNewKey('')
      setNewValue('')
    } catch (e) { setError(e.message) }
  }
  return (
    <div className="h-full overflow-auto p-6 space-y-4">
      <p className="max-w-2xl text-sm text-text-muted">
        A variable is a value you use on many cards. Write <code className="text-text-secondary">{'{{HAND_SIZE}}'}</code> in a card's text
        or in a template, and it shows the value; change the value here and every card updates.
      </p>
      <table className="w-full max-w-5xl text-sm" data-testid="variables-table">
        <thead>
          <tr className="text-left text-xs text-text-muted border-b border-border">
            <th className="px-2 py-1 font-medium">Name</th><th className="px-2 py-1 font-medium">Value</th><th className="px-2 py-1 font-medium">Description</th><th className="px-2 py-1 font-medium">Used in</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.variables.map((v) => <VariableRow key={`${v.id}:${v.key}`} row={v} uses={uses.get(v.key)} onDialog={setDialog} onError={setError} />)}
          <tr>
            <td className="px-2 py-2"><input data-testid="new-variable-key" className={`${input} font-mono border-border`} placeholder="NEW_NAME" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && add()} /></td>
            <td className="px-2 py-2"><input data-testid="new-variable-value" className={`${input} border-border`} placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></td>
            <td className="px-2 py-2" colSpan={3}>
              <button data-testid="add-variable" disabled={!newKey.trim()} onClick={add} className="inline-flex items-center gap-1 px-3 py-1 rounded bg-accent text-white text-sm disabled:opacity-40"><Plus size={14} /> Add variable</button>
            </td>
          </tr>
        </tbody>
      </table>
      {error && <p className="text-xs text-danger" data-testid="variable-error">{error}</p>}
      {dialog && <WhereUsedDialog {...dialog} onClose={() => { dialog.onCancel?.(); setDialog(null) }} />}
    </div>
  )
}
