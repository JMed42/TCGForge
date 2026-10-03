import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../../store'
import BindingInput from '../CardDesigner/BindingInput'
import { bindableFields } from '../../designer/expr/scope.ts'
import { ruleStats } from '../../designer/rules/resolveTemplate.ts'

// Template rules (spec: "Template picked by rule, e.g. type = "Unit" uses the Unit frame").
// First matching rule wins; a card's own template choice beats every rule; no match → the
// default template (the oldest one). Edited as a local copy and saved in one go.
export default function TemplateRulesDialog({ onClose }) {
  const templates = useStore((s) => s.templates)
  const cards = useStore((s) => s.cards)
  const stored = useStore((s) => s.templateRules)
  const activeCard = useStore((s) => s.cards.find((c) => c.id === s.activeCardId) || s.cards[0] || null)
  const [rules, setRules] = useState(() => stored.map((r) => ({ condition_expr: r.condition_expr, template_id: r.template_id })))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const fields = useMemo(() => bindableFields(cards), [cards])
  const templateIds = useMemo(() => templates.map((t) => t.id), [templates])
  const stats = useMemo(() => ruleStats(cards, rules, templateIds), [cards, rules, templateIds])
  const defaultName = templates.length ? templates.reduce((a, b) => (b.id < a.id ? b : a)).name : null

  const update = (i, patch) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const moveRule = (i, d) => setRules((rs) => {
    const j = i + d
    if (j < 0 || j >= rs.length) return rs
    const next = [...rs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const save = async () => {
    setSaving(true)
    const err = await useStore.getState().saveTemplateRules(rules)
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="template-rules-dialog">
      <div className="w-[760px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-1 border border-border rounded-xl shadow-2xl">
        <div className="flex items-center px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary flex-1">Template rules</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-muted"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 text-xs text-text-muted border-b border-border">
          The first rule whose condition is true picks a card's template. A template chosen on the card itself wins over every rule.
          Conditions use card fields, e.g. <code className="text-text-secondary">type == "Unit"</code> or <code className="text-text-secondary">rarity == "Mythic" && number(cost) &gt;= 5</code>.
          An empty condition matches every card.
        </div>

        <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
          {!templates.length && <p className="text-sm text-text-muted">This project has no templates yet.</p>}
          {rules.map((rule, i) => (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-surface-2/60 border border-border" data-rule-row={i}>
              <span className="text-xs font-semibold text-text-muted pt-1.5 w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <BindingInput
                  bare
                  testid={`rule-condition-${i}`}
                  value={rule.condition_expr}
                  onChange={(v) => update(i, { condition_expr: v })}
                  fields={fields}
                  card={activeCard}
                  placeholder='e.g. type == "Unit"'
                />
              </div>
              <div className="w-48 space-y-1">
                <select
                  data-testid={`rule-template-${i}`}
                  className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary"
                  value={rule.template_id}
                  onChange={(e) => update(i, { template_id: Number(e.target.value) })}
                >
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="text-[11px] text-text-muted" data-testid={`rule-count-${i}`}>
                  {stats.perRule[i]} card{stats.perRule[i] === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => moveRule(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30" title="Move up"><ArrowUp size={14} /></button>
                <button onClick={() => moveRule(i, 1)} disabled={i === rules.length - 1} className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30" title="Move down"><ArrowDown size={14} /></button>
                <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-red-500" title="Delete rule"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {templates.length > 0 && (
            <button
              data-testid="add-rule"
              onClick={() => setRules((rs) => [...rs, { condition_expr: '', template_id: templates[0].id }])}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary"
            >
              <Plus size={14} /> Add rule
            </button>
          )}
          <div className="text-xs text-text-muted space-y-0.5 pt-2" data-testid="rule-summary">
            <p>No rule matched → default "{defaultName ?? '—'}": {stats.defaults} card{stats.defaults === 1 ? '' : 's'}</p>
            <p>Template chosen on the card: {stats.overrides}</p>
            {stats.withErrors > 0 && <p className="text-danger">{stats.withErrors} card(s) hit a condition error (counted as false)</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border">
          {error && <p className="text-xs text-danger flex-1">{error}</p>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">Cancel</button>
          <button onClick={save} disabled={saving} data-testid="save-rules" className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save rules'}
          </button>
        </div>
      </div>
    </div>
  )
}
