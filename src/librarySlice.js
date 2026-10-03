// Library state (symbols, keywords, variables, reminder settings), composed into the main store
// (src/store.js). `library` holds the rows from electron/library.js; components/Library/
// LibraryProvider compiles them for CardRender. Save actions return the new library or throw
// with a message the screen shows.

export const libraryInitialState = {
  library: null, // { symbols, keywords, variables, settings }
  libraryTab: 'symbols', // symbols | keywords | variables | fonts
  libraryFocus: null, // { kind, id }: open this item (e.g. a keyword chip in Game Docs)
}

const message = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createLibrarySlice(set, get) {
  const call = async (fn) => {
    try {
      const lib = await fn(get().activeProjectId)
      set({ library: lib })
      return lib
    } catch (error) {
      throw new Error(message(error))
    }
  }

  return {
    ...libraryInitialState,

    resetLibrary: () => set({ ...libraryInitialState }),

    setLibraryTab: (tab) => set({ libraryTab: tab }),
    openLibrary: (tab, focus = null) => set({ activeView: 'library', libraryTab: tab, libraryFocus: focus }),
    clearLibraryFocus: () => set({ libraryFocus: null }),

    loadLibrary: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) { set({ library: null }); return }
      try {
        const lib = await window.api.getLibrary(activeProjectId)
        if (get().activeProjectId === activeProjectId) set({ library: lib })
      } catch (error) {
        console.error('Failed to load the library:', error)
      }
    },

    saveSymbol: (symbol) => call((pid) => window.api.saveSymbol(pid, symbol)),
    saveKeyword: (keyword) => call((pid) => window.api.saveKeyword(pid, keyword)),
    saveVariable: (variable) => call((pid) => window.api.saveVariable(pid, variable)),
    deleteLibraryItem: (kind, id) => call((pid) => window.api.deleteLibraryItem(pid, kind, id)),
    saveLibrarySettings: (settings) => call((pid) => window.api.saveLibrarySettings(pid, settings)),

    // Rename with the rewrites from "where used" (components/Library/whereUsed.js), one
    // transaction; then the cards, templates and exceptions it touched are reloaded.
    renameLibraryItem: async (request) => {
      const pid = get().activeProjectId
      let res
      try {
        res = await window.api.renameLibraryItem(pid, request)
      } catch (error) {
        throw new Error(message(error))
      }
      set({ library: res.library })
      if (request.cards?.length) await get().loadCards()
      if (request.templates?.length) {
        await get().loadTemplates()
        if (!get().dirty && get().activeTemplateId) get().openTemplate(get().activeTemplateId)
      }
      if (request.rules?.length) await get().loadTemplateRules()
      return res
    },
  }
}
