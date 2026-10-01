// Card Designer state, composed into the main store (src/store.js).
//
// The editor works on `draft`, a template object. Edits are pure functions over the draft
// (components/CardDesigner/editor/templateOps.js) and go through `edit` (one undo step) or
// `beginGesture` + `editLive` (one undo step for a whole drag). Nothing is written to the
// database until `saveDraft`.
//
// Previews always render the draft through the main-process renderer (the same code as
// export), throttled to one render in flight plus the latest queued request.

import { createHistory, pushHistory, undoHistory, redoHistory } from './components/CardDesigner/editor/history'

const RENDER_INTERVAL_MS = 100

let renderInFlight = false
let renderQueued = false
let renderTimer = null
let lastRenderStart = 0

export const designerInitialState = {
  templates: [], // rows: { id, project_id, name, content, error, updated_at }
  activeTemplateId: null,
  previewCardId: null,
  preview: null, // { dataUrl, width, height, dpi, warnings, error? }
  previewZoom: 2,
  renderState: 'idle', // 'idle' | 'rendering' | 'error'
  draft: null,
  draftError: null, // stored JSON could not be opened
  savedJson: null, // JSON.stringify of the last saved template, for `dirty`
  dirty: false,
  selectedLayerId: null,
  history: createHistory(),
  unsavedPrompt: null, // { proceed, resolve, error } while UnsavedChangesDialog is open
}

function parseTemplate(content) {
  const obj = JSON.parse(content)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.meta) throw new Error('template must be an object with meta')
  return obj
}

export function createDesignerSlice(set, get) {
  const setDraft = (draft, extra = {}) => {
    set({ draft, dirty: JSON.stringify(draft) !== get().savedJson, ...extra })
    get().requestRender()
  }

  const runRender = async () => {
    const { activeTemplateId, previewCardId, previewZoom, draft } = get()
    if (!activeTemplateId || !previewCardId || !draft) {
      set({ preview: null, renderState: 'idle' })
      return
    }
    renderInFlight = true
    lastRenderStart = Date.now()
    set({ renderState: 'rendering' })
    const dpi = 96 * previewZoom * (window.devicePixelRatio || 1)
    try {
      const result = await window.api.renderCard(previewCardId, activeTemplateId, { dpi, draft })
      const now = get()
      if (now.activeTemplateId === activeTemplateId && now.previewCardId === previewCardId && now.previewZoom === previewZoom) {
        set({ preview: { ...result, dpi }, renderState: 'idle' })
      }
    } catch (error) {
      // Keep the last good image on screen; show why the latest edit didn't render.
      const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      set((s) => ({ preview: { ...(s.preview || {}), error: message }, renderState: 'error' }))
    } finally {
      renderInFlight = false
      if (renderQueued) {
        renderQueued = false
        get().requestRender()
      }
    }
  }

  return {
    ...designerInitialState,

    resetDesigner: () => {
      set({ ...designerInitialState, history: createHistory() })
    },

    // ----- templates -----
    loadTemplates: async () => {
      const { activeProjectId, activeTemplateId, draft } = get()
      if (!activeProjectId) {
        set({ templates: [] })
        return
      }
      try {
        const templates = (await window.api?.getTemplates?.(activeProjectId)) || []
        set({ templates })
        const keep = templates.some((t) => t.id === activeTemplateId)
        const nextId = keep ? activeTemplateId : templates[0]?.id ?? null
        if (nextId !== activeTemplateId || (!draft && nextId !== null)) get().openTemplate(nextId)
      } catch (error) {
        console.error('Failed to load templates:', error)
        set({ templates: [] })
      }
    },

    // Open a template into the editor, discarding any draft (callers guard unsaved changes).
    openTemplate: (id) => {
      const row = get().templates.find((t) => t.id === id) || null
      const base = { activeTemplateId: row ? row.id : null, selectedLayerId: null, history: createHistory(), dirty: false }
      if (!row) {
        set({ ...base, draft: null, draftError: null, savedJson: null, preview: null })
        return
      }
      try {
        const draft = parseTemplate(row.content)
        set({ ...base, draft, draftError: null, savedJson: JSON.stringify(draft) })
      } catch (error) {
        set({ ...base, draft: null, draftError: error.message, savedJson: null, preview: null })
      }
      get().requestRender()
    },

    setActiveTemplate: (id) => get().openTemplate(id),

    createTemplate: async (name) => {
      try {
        const { activeProjectId } = get()
        if (!activeProjectId) return 'No project open'
        const row = await window.api.createTemplate(activeProjectId, name)
        await get().loadTemplates()
        get().openTemplate(row.id)
        return null
      } catch (error) {
        console.error('Failed to create template:', error)
        return error.message
      }
    },

    deleteTemplate: async (id) => {
      try {
        await window.api.deleteTemplate(id)
        if (get().activeTemplateId === id) set({ activeTemplateId: null, draft: null })
        await get().loadTemplates()
      } catch (error) {
        console.error('Failed to delete template:', error)
      }
    },

    // ----- preview -----
    setPreviewCard: (id) => {
      set({ previewCardId: id })
      get().requestRender()
    },

    setPreviewZoom: (zoom) => {
      set({ previewZoom: zoom })
      get().requestRender()
    },

    requestRender: () => {
      if (renderInFlight) {
        renderQueued = true
        return
      }
      const wait = lastRenderStart + RENDER_INTERVAL_MS - Date.now()
      if (wait > 0) {
        if (!renderTimer) {
          renderTimer = setTimeout(() => {
            renderTimer = null
            get().requestRender()
          }, wait)
        }
        return
      }
      runRender()
    },

    // Phase 0 name, still used by the view when cards change.
    renderPreview: () => get().requestRender(),

    // ----- editing -----
    selectLayer: (id) => {
      set({ selectedLayerId: id })
    },

    // One undoable edit. `key` merges rapid edits of the same field into one undo step.
    edit: (mutator, { key = null, select } = {}) => {
      const { draft, history } = get()
      if (!draft) return
      const next = mutator(draft)
      if (!next || next === draft) return
      setDraft(next, {
        history: pushHistory(history, draft, { key }),
        ...(select !== undefined ? { selectedLayerId: select } : {}),
      })
    },

    // Drags: one history entry at pointer-down, then live updates without history.
    beginGesture: () => {
      const { draft, history } = get()
      if (draft) set({ history: pushHistory(history, draft) })
    },

    editLive: (mutator) => {
      const { draft } = get()
      if (!draft) return
      const next = mutator(draft)
      if (next && next !== draft) setDraft(next)
    },

    undo: () => {
      const { draft, history } = get()
      const result = draft && undoHistory(history, draft)
      if (result) setDraft(result.snapshot, { history: result.history })
    },

    redo: () => {
      const { draft, history } = get()
      const result = draft && redoHistory(history, draft)
      if (result) setDraft(result.snapshot, { history: result.history })
    },

    // Advanced JSON tab: replace the whole draft as one undo step. Returns an error or null.
    applyJson: (text) => {
      let obj
      try {
        obj = parseTemplate(text)
      } catch (error) {
        return `Invalid template JSON: ${error.message}`
      }
      const { draft, history } = get()
      if (!draft) {
        set({ draftError: null, history: createHistory() })
        setDraft(obj)
        return null
      }
      setDraft(obj, { history: pushHistory(history, draft) })
      return null
    },

    // Returns an error message or null.
    saveDraft: async () => {
      const { activeProjectId, activeTemplateId, draft } = get()
      if (!activeProjectId || !activeTemplateId || !draft) return 'Nothing to save'
      try {
        const row = await window.api.saveTemplate(activeProjectId, draft, activeTemplateId)
        const saved = parseTemplate(row.content)
        set((s) => ({
          templates: s.templates.map((t) => (t.id === row.id ? row : t)),
          savedJson: JSON.stringify(saved),
          dirty: JSON.stringify(s.draft) !== JSON.stringify(saved),
        }))
        return null
      } catch (error) {
        console.error('Failed to save template:', error)
        return String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
    },

    discardDraft: () => {
      get().openTemplate(get().activeTemplateId)
    },

    // ----- unsaved-changes guard -----
    // Runs `proceed` now if the draft is clean; otherwise asks via UnsavedChangesDialog.
    // Resolves to true if `proceed` ran, false if the user cancelled.
    guardUnsaved: (proceed) => {
      if (!get().dirty) {
        proceed()
        return Promise.resolve(true)
      }
      return new Promise((resolve) => {
        set({ unsavedPrompt: { proceed, resolve, error: null } })
      })
    },

    // choice: 'save' | 'discard' | 'cancel'
    resolveUnsaved: async (choice) => {
      const prompt = get().unsavedPrompt
      if (!prompt) return
      if (choice === 'cancel') {
        set({ unsavedPrompt: null })
        prompt.resolve(false)
        return
      }
      if (choice === 'save') {
        const error = await get().saveDraft()
        if (error) {
          set({ unsavedPrompt: { ...prompt, error } })
          return
        }
      } else {
        get().discardDraft()
      }
      set({ unsavedPrompt: null })
      prompt.proceed()
      prompt.resolve(true)
    },
  }
}
