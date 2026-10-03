import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { useParsedTemplates } from './templates'
import { layerLabel } from '../../designer/fit/bindings.ts'
import { summarize } from '../../designer/fit/summary.ts'
import { fieldMap, NAME_FIELD } from '../../cardModel/model'

/** (templateId, layerId) -> the layer's name for people: the field it shows ("Effect"), or its id. */
export function useLayerLabels() {
  const templates = useParsedTemplates()
  const model = useStore((s) => s.cardModel)
  return useMemo(() => {
    const fields = fieldMap(model)
    const labelOf = (key) => (key === 'name' ? NAME_FIELD.label : fields.get(key)?.label)
    const memo = new Map()
    return (templateId, layerId) => {
      const k = `${templateId}\u0000${layerId}`
      if (!memo.has(k)) memo.set(k, layerLabel(layerId, templates.get(templateId)?.fields?.get(layerId), labelOf))
      return memo.get(k)
    }
  }, [templates, model])
}

/** A cached entry or live result ({ templateId, results }) as a summary with labels; null if none. */
export function summaryOf(entry, labels) {
  return entry ? summarize(entry.results, (layerId) => labels(entry.templateId, layerId)) : null
}

/**
 * One card's fit: the live result while it is being typed, else the cached one.
 * stale: there is a newer change being checked (the summary shown is from before it).
 */
export function useCardFit(cardId, labels) {
  // One subscription per card (the Fit column has one per row).
  const [entry, live, stale] = useStore(useShallow((s) => [
    s.fitCache[cardId], s.liveFit?.cardId === cardId ? s.liveFit : null, s.fitProgress.staleIds.has(cardId),
  ]))
  const summary = useMemo(() => summaryOf(live || entry, labels), [live, entry, labels])
  return { summary, stale: stale && !live, live: Boolean(live), templateId: (live || entry)?.templateId ?? null }
}

/**
 * The fit budget by field for one card: fieldKey -> [FitItem] (the text layers that show the
 * field, hardest first), from what is being typed or else the saved result.
 */
export function useFieldFits(cardId) {
  const labels = useLayerLabels()
  const templates = useParsedTemplates()
  const { summary, templateId } = useCardFit(cardId, labels)
  return useMemo(() => {
    const out = new Map()
    const fields = templates.get(templateId)?.fields
    if (!summary || !fields) return out
    for (const item of summary.items) {
      for (const key of fields.get(item.layerId) || []) {
        if (!out.has(key)) out.set(key, [])
        out.get(key).push(item)
      }
    }
    return out
  }, [summary, templates, templateId])
}

/** Fit summaries without labels (filters, sorting): card -> summary or null. */
export const plainFitOf = (fitCache) => (card) => {
  const entry = fitCache?.[card.id]
  return entry ? summarize(entry.results, (id) => id) : null
}
