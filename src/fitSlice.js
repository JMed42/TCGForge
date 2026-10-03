// Fit check state, composed into the main store (src/store.js): each card's cached fit results
// (fit_cache, electron/fitCache.js), the project signatures that are fit inputs, the background
// check's progress, and the live result of the card being edited.

import { fontsSignature, imagesSignature } from './designer/fit/inputs.ts'

const SAVE_EVERY_MS = 2000

export const fitInitialState = {
  fitCache: {}, // cardId -> { hash, templateId, templateVersion, results: { layerId: FitResult } }
  fitSignatures: null, // { fonts, images }: the project's font and image files (assets index)
  fitReady: false, // the project's cards, templates, exceptions, signatures and cache are loaded
  fitProgress: { total: 0, pending: 0 }, // background check
  liveFit: null, // { cardId, templateId, results } for the active card, as typed
}

export function createFitSlice(set, get) {
  // Results wait here and are written together (each write saves the whole database file).
  let pending = new Map() // cardId -> row
  let pendingProject = null
  let timer = null
  const flush = async () => {
    clearTimeout(timer)
    timer = null
    if (!pending.size) return
    const rows = [...pending.values()]
    const projectId = pendingProject
    pending = new Map()
    try {
      await window.api.saveFitResults(projectId, rows)
    } catch (error) {
      console.error('Failed to save fit results:', error)
    }
  }

  return {
    ...fitInitialState,

    resetFit: () => {
      flush()
      set({ ...fitInitialState })
    },

    loadFitCache: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      try {
        const rows = (await window.api.getFitCache(activeProjectId)) || []
        if (get().activeProjectId !== activeProjectId) return
        set({ fitCache: Object.fromEntries(rows.map((r) => [r.cardId, { hash: r.hash, templateId: r.templateId, templateVersion: r.templateVersion, results: r.results }])) })
      } catch (error) {
        console.error('Failed to load fit results:', error)
      }
    },

    // Font and image files are fit inputs (src/designer/fit/inputs.ts); their hashes come from
    // the assets index, which the file watcher keeps current.
    loadFitSignatures: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      try {
        const assets = (await window.api.getAssets(activeProjectId)) || []
        if (get().activeProjectId !== activeProjectId) return
        const next = { fonts: fontsSignature(assets), images: imagesSignature(assets) }
        const cur = get().fitSignatures
        if (!cur || cur.fonts !== next.fonts || cur.images !== next.images) set({ fitSignatures: next })
      } catch (error) {
        console.error('Failed to read project files for fit checks:', error)
        if (!get().fitSignatures) set({ fitSignatures: { fonts: '', images: '' } })
      }
    },

    // entries: [{ cardId, hash, templateId, templateVersion, results }]
    recordFits: (entries) => {
      if (!entries.length) return
      const projectId = get().activeProjectId
      set((s) => {
        const next = { ...s.fitCache }
        for (const e of entries) next[e.cardId] = { hash: e.hash, templateId: e.templateId, templateVersion: e.templateVersion, results: e.results }
        return { fitCache: next }
      })
      if (pendingProject !== projectId) { flush(); pendingProject = projectId }
      for (const e of entries) pending.set(e.cardId, { cardId: e.cardId, hash: e.hash, templateId: e.templateId, templateVersion: e.templateVersion, results: e.results })
      if (!timer) timer = setTimeout(flush, SAVE_EVERY_MS)
    },

    flushFitResults: flush,

    // "Re-check all": forget every result (after installing or removing a system font).
    recheckAllFits: async () => {
      const { activeProjectId } = get()
      pending = new Map()
      try {
        await window.api.clearFitCache(activeProjectId)
      } catch (error) {
        console.error('Failed to clear fit results:', error)
      }
      set({ fitCache: {} })
    },

    setFitProgress: (p) => {
      const cur = get().fitProgress
      if (cur.total !== p.total || cur.pending !== p.pending) set({ fitProgress: p })
    },

    setLiveFit: (liveFit) => set({ liveFit }),
  }
}
