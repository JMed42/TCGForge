import { useMemo } from 'react'
import { useStore } from '../../../store'
import { allFieldsInOrder, fieldsForType } from '../../../cardModel/model'
import { cellKey, getFieldValue } from './cardFields'
import { filterCards } from './gridOps'
import { plainFitOf } from '../../Fit/useFit'

const WIDTH = { text: 140, longText: 280, number: 72, choice: 120, yesNo: 70, image: 150, tags: 150, cardType: 120, fit: 180 }

/**
 * Database columns from the card model. With a type filter: that type's fields. Without: a
 * "Card type" column, then every field (type by type, each once). After Name: the read-only Fit
 * column (src/components/Fit).
 * Column: { key (cell key), fieldKey (model key, null for name/type/fit), label, kind, options, width, readOnly? }
 */
export function gridColumns(model, cardTypeId) {
  const fields = cardTypeId ? fieldsForType(model, Number(cardTypeId)) : allFieldsInOrder(model)
  const cols = fields.map((f) => ({
    key: cellKey(f.key),
    fieldKey: f.key === 'name' ? null : f.key,
    label: f.label,
    kind: f.key === 'name' ? 'text' : f.kind,
    options: f.options || [],
    width: f.key === 'name' ? 190 : Math.max(WIDTH[f.kind] || 130, Math.round(f.label.length * 7.5 + 30)), // fit the header
  }))
  const extra = [{ key: 'fit', fieldKey: null, label: 'Fit', kind: 'fit', options: [], width: WIDTH.fit, readOnly: true }]
  if (!cardTypeId) extra.push({ key: 'card_type_id', fieldKey: null, label: 'Card type', kind: 'cardType', options: model.types.map((t) => t.name), width: WIDTH.cardType })
  cols.splice(1, 0, ...extra)
  return cols
}

/** (card, column) -> does the card's type use this column? Name and type always apply. */
export function makeApplicable(model) {
  const keysByType = new Map(model.types.map((t) => [t.id, new Set(t.field_keys)]))
  return (card, col) => !col.fieldKey || Boolean(keysByType.get(card.card_type_id)?.has(col.fieldKey))
}

const textOf = (card, fieldKey) => getFieldValue(card, cellKey(fieldKey))

// The Fit filter uses saved results (not what is being typed), so a row doesn't vanish mid-edit.
export function filteredCardsOf(state) {
  const missing = state.missingArtOnly && state.missingArt ? new Set(state.missingArt.cardIds) : null
  const fitOf = state.cardFilters.fit ? plainFitOf(state.fitCache) : null
  return filterCards(state.cards, state.cardFilters, textOf, { missingIds: missing, fitOf })
}

/** The cards the Database tab shows (filters applied), memoised. */
export function useFilteredCards() {
  const cards = useStore((s) => s.cards)
  const filters = useStore((s) => s.cardFilters)
  const missingOnly = useStore((s) => s.missingArtOnly)
  const missing = useStore((s) => s.missingArt)
  const fitCache = useStore((s) => (s.cardFilters.fit ? s.fitCache : null))
  return useMemo(
    () => filteredCardsOf({ cards, cardFilters: filters, missingArtOnly: missingOnly, missingArt: missing, fitCache }),
    [cards, filters, missingOnly, missing, fitCache],
  )
}
