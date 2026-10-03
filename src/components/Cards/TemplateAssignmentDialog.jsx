import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../../store'
import BindingInput from '../CardDesigner/BindingInput'
import { ruleStats } from '../../designer/rules/resolveTemplate.ts'
import { bindingFields } from '../../cardModel/model'

const select = 'px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary'

// Template assignment: which template draws each card.
//   1. a template chosen on the card itself
//   2. exceptions, top to bottom (first true condition wins), e.g. foil frame for Mythic cards
//   3. the card type's template
//   4. the project default (the oldest template)
// Edited as a local copy and saved together.
export default function TemplateAssignmentDialog({ onClose }) {
  const templates = useStore((s) => s.templates)
  const cards = useStore((s) => s.cards)
  const model = useStore((s) => s.cardModel)
  const stored = useStore((s) => s.templateRules)
  const activeCard = useStore((s) => s.cards.find((c) => c.id === s.activeCardId) || s.cards[0] || null)
  const [rules, setRules] = useState(() => stored.map((r) => ({ condition_expr: r.condition_expr, template_id: r.template_id })))
  const [typeTemplates, setTypeTemplates] = useState(() => Object.fromEntries(model.types.map((t) => [t.id, t.template_id ?? null])))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const fields = useMemo(() => bindingFields(model), [model])
  const templateIds = useMemo(() => templates.map((t) => t.id), [templates])
  // Counts reflect unsaved type choices too.
  const previewCards = useMemo(() => cards.map((c) => ({ ...c, card_type_template_id: c.card_type_id in typeTemplates ? typeTemplates[c.card_type_id] : c.card_type_template_id })), [cards, typeTemplates])
  const stats = useMemo(() => ruleStats(previewCards, rules, templateIds), [previewCards, rules, templateIds])
  const defaultName = templates.length ? templates.reduce((a, b) => (b.id < a.id ? b : a)).name : null
  const typeCount = (id) => cards.filter((c) => c.card_type_id === id).length

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
    setError(null)
    const s = useStore.getState()
    for (const t of model.types) {
      const want = typeTemplates[t.id] ?? null
      if ((t.template_id ?? null) === want) continue
      const res = await s.saveCardType({ ...t, template_id: want })
      if (res.error) { setError(`${t.name}: ${res.error}`); setSaving(false); return }
    }
    const err = await s.saveTemplateRules(rules)
    if (!err) await s.loadCards()
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="template-assignment-dialog">
      <div className="w-[780px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-1 border border-border rounded-xl shadow-2xl">
        <div className="flex items-center px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary flex-1">Template assignment</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-muted"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 text-xs text-text-muted border-b border-border">
          Decides which template draws each card. A template chosen on the card itself always wins; then the exceptions below, top to bottom;
          then the card type's template; then the project default.
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
          {!templates.length && <p className="text-sm text-text-muted">This project has no templates yet. Create one in the Designer.</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-text-primary">By card type</h3>
            <div className="rounded-lg border border-border divide-y divide-border">
              {model.types.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2" data-type-template={t.name}>
                  <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 text-sm text-text-primary">{t.name} <span className="text-[11px] text-text-muted">({typeCount(t.id)} cards)</span></span>
                  <select className={`${select} w-56`} value={typeTemplates[t.id] ?? ''} onChange={(e) => setTypeTemplates((m) => ({ ...m, [t.id]: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">Project default{defaultName ? ` (${defaultName})` : ''}</option>
                    {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Exceptions</h3>
              <p className="text-xs text-text-muted">
                For cards that need a different template than their type, e.g. <code className="text-text-secondary">rarity == "Mythic"</code> → a foil frame,
                or <code className="text-text-secondary">card_type == "Unit" && number(cost) &gt;= 5</code>. An empty condition matches every card.
              </p>
            </div>
            {rules.map((rule, i) => (
              <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-surface-2/60 border border-border" data-rule-row={i}>
                <span className="text-xs font-semibold text-text-muted pt-1.5 w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <BindingInput bare testid={`rule-condition-${i}`} value={rule.condition_expr} onChange={(v) => update(i, { condition_expr: v })} fields={fields} card={activeCard} placeholder='e.g. rarity == "Mythic"' />
                </div>
                <div className="w-48 space-y-1">
                  <select data-testid={`rule-template-${i}`} className={`${select} w-full`} value={rule.template_id} onChange={(e) => update(i, { template_id: Number(e.target.value) })}>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <p className="text-[11px] text-text-muted" data-testid={`rule-count-${i}`}>{stats.perRule[i]} card{stats.perRule[i] === 1 ? '' : 's'}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => moveRule(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30" title="Move up"><ArrowUp size={14} /></button>
                  <button onClick={() => moveRule(i, 1)} disabled={i === rules.length - 1} className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30" title="Move down"><ArrowDown size={14} /></button>
                  <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-red-500" title="Delete exception"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {templates.length > 0 && (
              <button data-testid="add-rule" onClick={() => setRules((rs) => [...rs, { condition_expr: '', template_id: templates[0].id }])}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">
                <Plus size={14} /> Add exception
              </button>
            )}
          </section>

          <div className="text-xs text-text-muted space-y-0.5" data-testid="rule-summary">
            <p>From their card type: {stats.byType} · Project default: {stats.defaults} · Chosen on the card: {stats.overrides}</p>
            {stats.withErrors > 0 && <p className="text-danger">{stats.withErrors} card(s) hit a condition error (counted as false)</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border">
          {error && <p className="text-xs text-danger flex-1">{error}</p>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">Cancel</button>
          <button onClick={save} disabled={saving} data-testid="save-rules" className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
