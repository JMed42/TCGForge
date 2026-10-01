import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // Projects
  projects: [],
  activeProjectId: null,

  // Navigation
  activeView: 'cards', // 'cards' | 'designer' | 'rules' | 'settings'

  // Card Designer
  templates: [],
  activeTemplateId: null,
  previewCardId: null,
  preview: null, // { dataUrl, width, height, warnings } | { error }
  previewZoom: 2,
  renderState: 'idle', // 'idle' | 'rendering' | 'error'

  // Cards
  cards: [],
  selectedCardIds: [],
  cardFilters: {
    search: '',
    type: '',
    set: '',
    rarity: '',
    tags: '',
    sortBy: 'name',
    sortDir: 'ASC',
  },
  editingCard: null,

  // Documents
  documents: [],
  activeDocumentId: null,
  expandedFolders: new Set(),

  // ===== Projects =====
  loadProjects: async () => {
    try {
      const projects = await window.api?.getProjects?.()
      set({ projects: projects || [] })
    } catch (error) {
      console.error('Failed to load projects:', error)
      set({ projects: [] })
    }
  },

  setActiveProject: async (id) => {
    set({
      activeProjectId: id,
      activeView: 'cards',
      templates: [],
      activeTemplateId: null,
      previewCardId: null,
      preview: null,
    })
    await get().loadCards()
    await get().loadDocuments()
  },

  createProject: async (data) => {
    try {
      await window.api?.createProject?.(data)
      await get().loadProjects()
      const { projects } = get()
      if (projects.length > 0) {
        await get().setActiveProject(projects[projects.length - 1].id)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  },

  updateProject: async (id, data) => {
    try {
      await window.api?.updateProject?.(id, data)
      await get().loadProjects()
    } catch (error) {
      console.error('Failed to update project:', error)
    }
  },

  deleteProject: async (id) => {
    try {
      await window.api?.deleteProject?.(id)
      await get().loadProjects()
      const { activeProjectId } = get()
      if (activeProjectId === id) {
        set({ activeProjectId: null, activeView: 'cards' })
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  },

  // ===== Cards =====
  loadCards: async () => {
    try {
      const { activeProjectId, cardFilters } = get()
      if (!activeProjectId) {
        set({ cards: [] })
        return
      }
      const cards = await window.api?.getCards?.(activeProjectId, cardFilters)
      set({ cards: cards || [] })
    } catch (error) {
      console.error('Failed to load cards:', error)
      set({ cards: [] })
    }
  },

  setCardFilters: async (filters) => {
    const { cardFilters } = get()
    set({ cardFilters: { ...cardFilters, ...filters } })
    await get().loadCards()
  },

  setEditingCard: (card) => {
    set({ editingCard: card })
  },

  createCard: async (data) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.createCard?.(activeProjectId, data)
      await get().loadCards()
    } catch (error) {
      console.error('Failed to create card:', error)
    }
  },

  updateCard: async (id, data) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.updateCard?.(id, data)
      await get().loadCards()
      set({ editingCard: null })
    } catch (error) {
      console.error('Failed to update card:', error)
    }
  },

  deleteCard: async (id) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.deleteCard?.(id)
      await get().loadCards()
    } catch (error) {
      console.error('Failed to delete card:', error)
    }
  },

  bulkDeleteCards: async () => {
    try {
      const { activeProjectId, selectedCardIds } = get()
      if (!activeProjectId || selectedCardIds.length === 0) return
      await window.api?.bulkDeleteCards?.(selectedCardIds)
      await get().loadCards()
      set({ selectedCardIds: [] })
    } catch (error) {
      console.error('Failed to bulk delete cards:', error)
    }
  },

  duplicateCard: async (id) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.duplicateCard?.(id)
      await get().loadCards()
    } catch (error) {
      console.error('Failed to duplicate card:', error)
    }
  },

  toggleCardSelection: (id) => {
    const { selectedCardIds } = get()
    const newSelection = selectedCardIds.includes(id)
      ? selectedCardIds.filter((cardId) => cardId !== id)
      : [...selectedCardIds, id]
    set({ selectedCardIds: newSelection })
  },

  selectAllCards: () => {
    const { cards } = get()
    set({ selectedCardIds: cards.map((c) => c.id) })
  },

  clearCardSelection: () => {
    set({ selectedCardIds: [] })
  },

  // ===== Documents =====
  loadDocuments: async () => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) {
        set({ documents: [] })
        return
      }
      const documents = await window.api?.getDocuments?.(activeProjectId)
      set({ documents: documents || [] })
    } catch (error) {
      console.error('Failed to load documents:', error)
      set({ documents: [] })
    }
  },

  setActiveDocument: (id) => {
    set({ activeDocumentId: id })
  },

  createDocument: async (data) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      const doc = await window.api?.createDocument?.(activeProjectId, data)
      await get().loadDocuments()
      if (doc?.id) {
        set({ activeDocumentId: doc.id })
      }
    } catch (error) {
      console.error('Failed to create document:', error)
    }
  },

  updateDocument: async (id, data) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.updateDocument?.(id, data)
      await get().loadDocuments()
    } catch (error) {
      console.error('Failed to update document:', error)
    }
  },

  deleteDocument: async (id) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.deleteDocument?.(id)
      await get().loadDocuments()
      const { activeDocumentId } = get()
      if (activeDocumentId === id) {
        set({ activeDocumentId: null })
      }
    } catch (error) {
      console.error('Failed to delete document:', error)
    }
  },

  moveDocument: async (id, newParentId) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.moveDocument?.(id, newParentId)
      await get().loadDocuments()
    } catch (error) {
      console.error('Failed to move document:', error)
    }
  },

  toggleFolder: (id) => {
    const { expandedFolders } = get()
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    set({ expandedFolders: newExpanded })
  },

  // ===== Card Designer =====
  loadTemplates: async () => {
    try {
      const { activeProjectId, activeTemplateId } = get()
      if (!activeProjectId) {
        set({ templates: [] })
        return
      }
      const templates = (await window.api?.getTemplates?.(activeProjectId)) || []
      const stillThere = templates.some((t) => t.id === activeTemplateId)
      set({
        templates,
        activeTemplateId: stillThere ? activeTemplateId : templates[0]?.id ?? null,
      })
    } catch (error) {
      console.error('Failed to load templates:', error)
      set({ templates: [] })
    }
  },

  setActiveTemplate: (id) => {
    set({ activeTemplateId: id })
  },

  setPreviewCard: (id) => {
    set({ previewCardId: id })
  },

  setPreviewZoom: (zoom) => {
    set({ previewZoom: zoom })
  },

  createTemplate: async (name) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return null
      const saved = await window.api?.createTemplate?.(activeProjectId, name)
      await get().loadTemplates()
      if (saved?.id) set({ activeTemplateId: saved.id })
      return null
    } catch (error) {
      console.error('Failed to create template:', error)
      return error.message
    }
  },

  // content is the raw JSON text from the editor. Returns an error message or null.
  saveTemplate: async (content) => {
    const { activeProjectId, activeTemplateId } = get()
    if (!activeProjectId || !activeTemplateId) return 'No template selected'
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      return `Invalid JSON: ${error.message}`
    }
    try {
      await window.api?.saveTemplate?.(activeProjectId, parsed, activeTemplateId)
      await get().loadTemplates()
      await get().renderPreview()
      return null
    } catch (error) {
      console.error('Failed to save template:', error)
      return error.message
    }
  },

  deleteTemplate: async (id) => {
    try {
      const { activeProjectId } = get()
      if (!activeProjectId) return
      await window.api?.deleteTemplate?.(activeProjectId, id)
      await get().loadTemplates()
    } catch (error) {
      console.error('Failed to delete template:', error)
    }
  },

  // Renders the preview card through the main-process renderer (same path as export).
  // dpi = 96 × zoom × devicePixelRatio so the <img> is shown at its natural pixel size.
  renderPreview: async () => {
    const { activeTemplateId, previewCardId, previewZoom } = get()
    if (!activeTemplateId || !previewCardId) {
      set({ preview: null, renderState: 'idle' })
      return
    }
    set({ renderState: 'rendering' })
    try {
      const dpi = 96 * previewZoom * (window.devicePixelRatio || 1)
      const result = await window.api?.renderCard?.(previewCardId, activeTemplateId, { dpi })
      // Ignore stale results if the selection changed mid-render.
      const now = get()
      if (now.activeTemplateId !== activeTemplateId || now.previewCardId !== previewCardId || now.previewZoom !== previewZoom) return
      set({ preview: { ...result, dpi }, renderState: 'idle' })
    } catch (error) {
      console.error('Failed to render card:', error)
      set({ preview: { error: error.message }, renderState: 'error' })
    }
  },

  // ===== Navigation =====
  setActiveView: (view) => {
    set({ activeView: view })
  },
}))
