// Cards screen state, composed into the main store (src/store.js): the active cell's card (the
// one the preview shows), the value being typed (`liveEdit`, rendered without a database
// round-trip), cell undo/redo, and the project's template rules.

import { toUiCard } from './utils/cardData'
import { getFieldValue, withField, createCellHistory, recordCellEdit, undoCell, redoCell } from './components/Cards/grid/cardFields'

export const cardsInitialState = {
  activeCardId: null,
  liveEdit: null, // { cardId, key, value } while a cell editor is open
  cellHistory: createCellHistory(),
  cellError: null,
  templateRules: [], // rows: { id, priority, condition_expr, template_id }
  missingArt: null, // { cardIds, cards: [{ id, name, image_path }], templates: [{ id, name, src }] }
  missingArtOnly: false,
}

const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createCardsSlice(set, get) {
  const replaceCard = (card) => set((s) => ({ cards: s.cards.map((c) => (c.id === card.id ? card : c)) }))

  // Write one field. Optimistic: the row changes at once, then takes the saved row.
  const writeField = async (cardId, key, value) => {
    const card = get().cards.find((c) => c.id === cardId)
    if (!card) return false
    let next
    try {
      next = withField(card, key, value)
    } catch (error) {
      set({ cellError: ipcMessage(error) })
      return false
    }
    replaceCard(next.card)
    try {
      const row = await window.api.updateCard(cardId, next.patch)
      if (row) replaceCard(toUiCard(row))
      set({ cellError: null })
      return true
    } catch (error) {
      replaceCard(card)
      set({ cellError: ipcMessage(error) })
      return false
    }
  }

  return {
    ...cardsInitialState,

    resetCardsScreen: () => set({ ...cardsInitialState, cellHistory: createCellHistory() }),

    setActiveCard: (id) => {
      if (get().activeCardId !== id) set({ activeCardId: id })
    },

    setLiveEdit: (cardId, key, value) => set({ liveEdit: { cardId, key, value } }),
    clearLiveEdit: () => set({ liveEdit: null }),

    // Commit a cell. Records an undo step when the value changed.
    commitCell: async (cardId, key, value) => {
      const card = get().cards.find((c) => c.id === cardId)
      set({ liveEdit: null })
      if (!card) return
      const before = getFieldValue(card, key)
      if (before === String(value ?? '')) return
      if (await writeField(cardId, key, value)) {
        set((s) => ({ cellHistory: recordCellEdit(s.cellHistory, { cardId, key, before, after: String(value ?? '') }) }))
      }
    },

    undoCellEdit: async () => {
      const step = undoCell(get().cellHistory)
      if (!step) return null
      set({ cellHistory: step.history, activeCardId: step.entry.cardId })
      await writeField(step.entry.cardId, step.entry.key, step.value)
      return step.entry
    },

    redoCellEdit: async () => {
      const step = redoCell(get().cellHistory)
      if (!step) return null
      set({ cellHistory: step.history, activeCardId: step.entry.cardId })
      await writeField(step.entry.cardId, step.entry.key, step.value)
      return step.entry
    },

    setTemplateOverride: async (cardId, templateId) => {
      try {
        const row = await window.api.updateCard(cardId, { template_override_id: templateId || null })
        if (row) replaceCard(toUiCard(row))
      } catch (error) {
        set({ cellError: ipcMessage(error) })
      }
    },

    // ----- template rules -----
    loadTemplateRules: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) { set({ templateRules: [] }); return }
      try {
        set({ templateRules: (await window.api.getTemplateRules(activeProjectId)) || [] })
      } catch (error) {
        console.error('Failed to load template rules:', error)
        set({ templateRules: [] })
      }
    },

    // rules: [{ condition_expr, template_id }] in priority order. Returns an error message or null.
    saveTemplateRules: async (rules) => {
      try {
        const saved = await window.api.saveTemplateRules(get().activeProjectId, rules)
        set({ templateRules: saved })
        return null
      } catch (error) {
        return ipcMessage(error)
      }
    },
  }
}
