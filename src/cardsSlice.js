// Cards screen state, composed into the main store (src/store.js): the active cell's card (the
// one the preview shows), the value being typed (`liveEdit`, rendered without a database
// round-trip), cell undo/redo, and the project's template rules.

import { toUiCard } from './utils/cardData'
import { getFieldRaw, sameValue, withField, createCellHistory, recordCellEdit, undoCell, redoCell } from './components/Cards/grid/cardFields'

export const cardsInitialState = {
  activeCardId: null,
  liveEdit: null, // { cardId, key, value } while a cell editor is open
  cellHistory: createCellHistory(),
  cellError: null,
  templateRules: [], // rows: { id, priority, condition_expr, template_id }
  missingArt: null, // { cardIds, cards: [{ id, name, image_path }], templates: [{ id, name, src }] }
  missingArtOnly: false,
  cardsTab: 'cards', // 'cards' (one card in a form) | 'database' (the grid)
  savingCount: 0, // saves in flight, for the "Saving…" indicator
}

const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createCardsSlice(set, get) {
  const replaceCard = (card) => set((s) => ({ cards: s.cards.map((c) => (c.id === card.id ? card : c)) }))

  // Write fields: [{ cardId, key, value }]. Optimistic: rows change at once, then take the saved
  // rows. One card goes through updateCard; several through bulkUpdateCards (one transaction).
  const writeChanges = async (writes) => {
    const before = new Map()
    const after = new Map()
    const patches = new Map()
    try {
      for (const w of writes) {
        const card = after.get(w.cardId) || get().cards.find((c) => c.id === w.cardId)
        if (!card) continue
        if (!before.has(w.cardId)) before.set(w.cardId, card)
        const next = withField(card, w.key, w.value)
        after.set(w.cardId, next.card)
        patches.set(w.cardId, { ...(patches.get(w.cardId) || {}), ...next.patch })
      }
    } catch (error) {
      set({ cellError: ipcMessage(error) })
      return false
    }
    if (!patches.size) return false
    for (const c of after.values()) replaceCard(c)
    set((s) => ({ savingCount: s.savingCount + 1 }))
    try {
      const ids = [...patches.keys()]
      const rows = ids.length === 1
        ? [await window.api.updateCard(ids[0], patches.get(ids[0]))]
        : await window.api.bulkUpdateCards(get().activeProjectId, ids.map((id) => ({ id, patch: patches.get(id) })))
      for (const row of rows) if (row) replaceCard(toUiCard(row))
      set({ cellError: null })
      if (writes.some((w) => w.key === 'image_path' || w.key.startsWith('custom:'))) get().loadMissingArt()
      return true
    } catch (error) {
      for (const c of before.values()) replaceCard(c)
      set({ cellError: ipcMessage(error) })
      return false
    } finally {
      set((s) => ({ savingCount: Math.max(0, s.savingCount - 1) }))
    }
  }

  return {
    ...cardsInitialState,

    resetCardsScreen: () => set({ ...cardsInitialState, cellHistory: createCellHistory() }),

    setActiveCard: (id) => {
      if (get().activeCardId !== id) set({ activeCardId: id })
    },

    setCardsTab: (tab) => set({ cardsTab: tab }),

    // A new card of a type, named "New <Type>" (numbered if taken), selected. Returns its id.
    createCardOfType: async (typeId) => {
      const { activeProjectId, cards, cardModel } = get()
      const type = cardModel.types.find((t) => t.id === typeId) || cardModel.types[0]
      const base = `New ${type ? type.name : 'card'}`
      const taken = new Set(cards.map((c) => c.name))
      let name = base
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
      try {
        const row = await window.api.createCard(activeProjectId, { name, ...(type ? { card_type_id: type.id } : {}) })
        await get().loadCards()
        set({ activeCardId: row.id })
        return row.id
      } catch (error) {
        set({ cellError: ipcMessage(error) })
        return null
      }
    },

    duplicateCardAndSelect: async (id) => {
      const row = await window.api.duplicateCard(id)
      await get().loadCards()
      if (row) set({ activeCardId: row.id })
    },

    // Delete a card; the selection moves to its neighbour.
    deleteCardAndSelectNext: async (id) => {
      const { cards } = get()
      const i = cards.findIndex((c) => c.id === id)
      const next = cards[i + 1] || cards[i - 1] || null
      await window.api.deleteCard(id)
      set((s) => ({ cellHistory: { past: s.cellHistory.past.filter((step) => !step.some((c) => c.cardId === id)), future: [] } }))
      await get().loadCards()
      set({ activeCardId: next ? next.id : null })
    },

    setLiveEdit: (cardId, key, value) => set({ liveEdit: { cardId, key, value } }),
    clearLiveEdit: () => set({ liveEdit: null }),

    // Commit a cell. Records an undo step when the value changed.
    commitCell: async (cardId, key, value) => {
      set({ liveEdit: null })
      return get().commitChanges([{ cardId, key, value }])
    },

    // Commit several cells as one save and one undo step. Unchanged values are skipped.
    // Returns the number of cells written (0 if nothing changed or the save failed).
    commitChanges: async (writes) => {
      const step = []
      for (const w of writes) {
        const card = get().cards.find((c) => c.id === w.cardId)
        if (!card) continue
        const before = getFieldRaw(card, w.key)
        const after = typeof w.value === 'boolean' ? w.value : String(w.value ?? '')
        if (sameValue(before, after)) continue
        step.push({ cardId: w.cardId, key: w.key, before, after })
      }
      if (!step.length) return 0
      if (!(await writeChanges(step.map((c) => ({ cardId: c.cardId, key: c.key, value: c.after }))))) return 0
      set((s) => ({ cellHistory: recordCellEdit(s.cellHistory, step) }))
      return step.length
    },

    undoCellEdit: async () => {
      const r = undoCell(get().cellHistory)
      if (!r) return null
      set({ cellHistory: r.history, activeCardId: r.step[0].cardId })
      await writeChanges(r.writes)
      return r.step[0]
    },

    redoCellEdit: async () => {
      const r = redoCell(get().cellHistory)
      if (!r) return null
      set({ cellHistory: r.history, activeCardId: r.step[0].cardId })
      await writeChanges(r.writes)
      return r.step[0]
    },

    setTemplateOverride: async (cardId, templateId) => {
      try {
        const row = await window.api.updateCard(cardId, { template_override_id: templateId || null })
        if (row) replaceCard(toUiCard(row))
      } catch (error) {
        set({ cellError: ipcMessage(error) })
      }
    },

    // ----- missing art (assets index) -----
    loadMissingArt: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) { set({ missingArt: null }); return }
      try {
        const missingArt = await window.api.getMissingArt(activeProjectId)
        if (get().activeProjectId === activeProjectId) set({ missingArt })
      } catch (error) {
        console.error('Failed to check card art:', error)
      }
    },
    setMissingArtOnly: (on) => set({ missingArtOnly: Boolean(on) }),
    // A project file changed on disk: re-check soon (the watcher fires in bursts). Fonts and
    // images are fit-check inputs too.
    assetsChanged: (() => {
      let timer = null
      return () => {
        clearTimeout(timer)
        // Symbol images too: their shape comes from the assets index.
        timer = setTimeout(() => { get().loadMissingArt(); get().loadFitSignatures?.(); get().loadLibrary?.() }, 300)
      }
    })(),

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
