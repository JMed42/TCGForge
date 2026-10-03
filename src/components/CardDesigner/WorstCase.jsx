import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Flame, Loader2, X } from 'lucide-react'
import { useStore } from '../../store'
import { measureFits } from '../Fit/fitQueue'
import { compareHardness, describeFit } from '../../designer/fit/summary.ts'
import { layerLabel, textLayerFields } from '../../designer/fit/bindings.ts'
import { fieldMap, NAME_FIELD } from '../../cardModel/model'

// Worst case (spec: "one click in the template editor jumps to the card with the longest content
// for the selected element"): measures the template as it is on screen against the sample cards,
// the same way as the Fit column, and jumps to the card where the selected text (or the text in
// the selected stack) is hardest to fit: overflowing most, then hidden, then shrunk furthest,
// then fullest. A menu lists the five hardest. With the template saved and every sample card's
// result current, the cached results answer at once.

export function textIdsOf(layer) {
  if (!layer) return []
  if (layer.type === 'text' || layer.type === 'richText') return [layer.id]
  if (layer.type === 'stack' || layer.type === 'group') return layer.children.flatMap(textIdsOf)
  return []
}

/** Cards ranked hardest first for the given text layers: [{ card, layerId, result }] */
export function rankHardest(cards, fitsByCard, ids) {
  const out = []
  for (const card of cards) {
    const fits = fitsByCard[card.id]
    if (!fits) continue
    let worst = null
    for (const id of ids) {
      const r = fits[id]
      if (r && (!worst || compareHardness(r, worst.result) > 0)) worst = { layerId: id, result: r }
    }
    if (worst) out.push({ card, ...worst })
  }
  return out.sort((a, b) => compareHardness(b.result, a.result) || a.card.name.localeCompare(b.card.name))
}

const TONE = { overflow: 'text-danger', hidden: 'text-text-muted', shrunk: 'text-amber-400', fits: 'text-text-muted' }

export default function WorstCase({ draft, layer, samples, onPick }) {
  const model = useStore((s) => s.cardModel)
  const [state, setState] = useState(null) // { running: { done, total } } | { list, checked, cached }
  const [open, setOpen] = useState(false)
  const abort = useRef(null)
  const ids = useMemo(() => textIdsOf(layer), [layer])
  const fields = useMemo(() => (draft ? textLayerFields(draft) : new Map()), [draft])
  const labelOf = useMemo(() => {
    const map = fieldMap(model)
    return (id) => layerLabel(id, fields.get(id), (key) => (key === 'name' ? NAME_FIELD.label : map.get(key)?.label))
  }, [model, fields])

  // A different layer or an edited template makes the ranking out of date.
  useEffect(() => {
    abort.current?.abort()
    setState(null)
    setOpen(false)
  }, [layer?.id, draft])

  const running = state?.running
  const enabled = ids.length > 0 && samples.length > 0 && !running

  const run = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const s = useStore.getState()
    const cached = !s.dirty && samples.every((c) => s.fitCache[c.id]?.templateId === s.activeTemplateId && !s.fitProgress.staleIds.has(c.id))
    let fitsByCard
    if (cached) {
      fitsByCard = Object.fromEntries(samples.map((c) => [c.id, s.fitCache[c.id].results]))
    } else {
      setState({ running: { done: 0, total: samples.length } })
      try {
        fitsByCard = await measureFits(samples.map((c) => ({ key: c.id, card: c, template: draft })), {
          signal: controller.signal,
          onProgress: (done, total) => setState({ running: { done, total } }),
        })
      } catch (error) {
        if (error.name === 'AbortError') return
        setState(null)
        throw error
      }
    }
    if (controller.signal.aborted) return
    const list = rankHardest(samples, fitsByCard, ids)
    setState({ list: list.slice(0, 5), checked: samples.length, cached })
    if (list[0]) onPick(list[0].card.id)
  }

  const title = !ids.length
    ? 'Worst case: select a text layer or a stack first'
    : `Jump to the card where ${labelOf(ids.length === 1 ? ids[0] : layer.id)} is hardest to fit`
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        data-testid="worst-case"
        disabled={!enabled}
        onClick={run}
        title={title}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
      >
        {running ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />}
        {running ? `Checking ${running.done}/${running.total}…` : 'Worst case'}
      </button>
      {running && (
        <button type="button" title="Stop" onClick={() => { abort.current?.abort(); setState(null) }} className="p-0.5 rounded hover:bg-surface-2"><X size={12} /></button>
      )}
      {state?.list && (
        <button type="button" data-testid="worst-case-menu" title="The hardest cards" onClick={() => setOpen((o) => !o)} className="p-0.5 rounded hover:bg-surface-2">
          <ChevronDown size={13} />
        </button>
      )}
      {open && state?.list && (
        <div className="absolute left-0 top-full mt-1 z-30 w-80 bg-surface-1 border border-border rounded-lg shadow-xl p-1" onMouseLeave={() => setOpen(false)} data-testid="worst-case-list">
          <p className="px-2 py-1 text-[10px] text-text-muted">
            Hardest of {state.checked} card{state.checked === 1 ? '' : 's'} for {ids.length === 1 ? labelOf(ids[0]) : 'the text in this stack'}
          </p>
          {state.list.map((e, i) => (
            <button
              key={e.card.id}
              type="button"
              data-worst-card={e.card.id}
              onClick={() => { onPick(e.card.id); setOpen(false) }}
              className="w-full text-left px-2 py-1 rounded hover:bg-surface-2"
            >
              <span className="block text-xs text-text-primary truncate">{i + 1}. {e.card.name}</span>
              <span className={`block text-[11px] ${TONE[e.result.status]}`}>
                {ids.length > 1 ? `${labelOf(e.layerId)}: ` : ''}{describeFit(e.result)}
              </span>
            </button>
          ))}
          {!state.list.length && <p className="px-2 py-1 text-xs text-text-muted">No sample card shows this text.</p>}
        </div>
      )}
    </div>
  )
}
