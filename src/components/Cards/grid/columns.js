import { useMemo } from 'react'
import { useStore } from '../../../store'
import { allFieldsInOrder, fieldsForType } from '../../../cardModel/model'
import { cellKey, getFieldValue } from './cardFields'
import { filterCards } from './gridOps'

const WIDTH = { text: 140, longText: 280, number: 72, choice: 120, yesNo: 70, image: 150, tags: 150, cardType: 120 }

/**
 * Database columns from the card model. With a type filter: that type's fields. Without: a
 * "Card type" column, then every field (type by type, each once).
 * Column: { key (cell key), fieldKey (model key, null for name/type), label, kind, options, width }
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
  if (!cardTypeId) {
    cols.splice(1, 0, { key: 'card_type_id', fieldKey: null, label: 'Card type', kind: 'cardType', options: model.types.map((t) => t.name), width: WIDTH.cardType })
  }
  return cols
}

/** (card, column) -> does the card's type use this column? Name and type always apply. */
export function makeApplicable(model) {
  const keysByType = new Map(model.types.map((t) => [t.id, new Set(t.field_keys)]))
  return (card, col) => !col.fieldKey || Boolean(keysByType.get(card.card_type_id)?.has(col.fieldKey))
}

const textOf = (card, fieldKey) => getFieldValue(card, cellKey(fieldKey))

export function filteredCardsOf(state) {
  const missing = state.missingArtOnly && state.missingArt ? new Set(state.missingArt.cardIds) : null
  return filterCards(state.cards, state.cardFilters, textOf, { missingIds: missing })
}

/** The cards the Database tab shows (filters applied), memoised. */
export function useFilteredCards() {
  const cards = useStore((s) => s.cards)
  const filters = useStore((s) => s.cardFilters)
  const missingOnly = useStore((s) => s.missingArtOnly)
  const missing = useStore((s) => s.missingArt)
  return useMemo(() => filteredCardsOf({ cards, cardFilters: filters, missingArtOnly: missingOnly, missingArt: missing }), [cards, filters, missingOnly, missing])
}
