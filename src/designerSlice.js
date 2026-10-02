// Card Designer state, composed into the main store (src/store.js).
//
// The editor works on `draft`, a template in schema v1 (src/designer/schema). Edits are pure
// functions over the draft and go through `edit` (one undo step, optionally merged by key) or
// `beginGesture` + `editLive` (one undo step for a whole drag). Nothing is written to the
// database until `saveDraft`, which validates with the zod schema first.
//
// The canvas renders the draft directly with CardRender (same component as the exports), so
// there is no preview round-trip here.

import { createHistory, pushHistory, undoHistory, redoHistory } from './components/CardDesigner/editor/history'
import { validateTemplate } from './designer/schema/schema.ts'
import { assetKey } from './designer/render/assetUrl.ts'

export const designerInitialState = {
  templates: [], // rows: { id, project_id, name, content, version, error, updated_at }
  activeTemplateId: null,
  previewCardId: null,
  draft: null,
  draftError: null, // stored JSON could not be opened
  savedJson: null, // JSON.stringify of the last saved template, for `dirty`
  dirty: false,
  selectedIds: [], // layer ids; multi-select on the canvas and in the layer list
  history: createHistory(),
  unsavedPrompt: null, // { proceed, resolve, error } while UnsavedChangesDialog is open
  assetVersions: {}, // `${projectId}/${relPath}` -> counter, bumped when the file changes on disk
}

function parseStored(content) {
  const obj = JSON.parse(content)
  const r = validateTemplate(obj)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.template
}

const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createDesignerSlice(set, get) {
  const setDraft = (draft, extra = {}) => {
    set({ draft, dirty: JSON.stringify(draft) !== get().savedJson, ...extra })
  }

  return {
    ...designerInitialState,

    resetDesigner: () => {
      set({ ...designerInitialState, history: createHistory(), assetVersions: get().assetVersions })
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
      const base = { activeTemplateId: row ? row.id : null, selectedIds: [], history: createHistory(), dirty: false }
      if (!row) {
        set({ ...base, draft: null, draftError: null, savedJson: null })
        return
      }
      try {
        const draft = parseStored(row.content)
        set({ ...base, draft, draftError: null, savedJson: JSON.stringify(draft) })
      } catch (error) {
        set({ ...base, draft: null, draftError: error.message, savedJson: null })
      }
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
        return ipcMessage(error)
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

    // ----- .tcgtemplate -----
    // Export the template as the editor shows it (draft). Returns { message } or { error }.
    exportTemplateFile: async (options = {}) => {
      const { activeTemplateId, draft } = get()
      if (!activeTemplateId || !draft) return { error: 'No template open' }
      try {
        const res = await window.api.exportTemplateFile(activeTemplateId, { ...options, draft })
        if (res.canceled) return {}
        return { message: `Exported with ${res.assets.length} file${res.assets.length === 1 ? '' : 's'}`, path: res.path }
      } catch (error) {
        return { error: ipcMessage(error) }
      }
    },

    // Read a .tcgtemplate, validate it with the zod schema, then import it as a new template.
    // Returns { message } or { error }.
    importTemplateFile: async (options = {}) => {
      const { activeProjectId } = get()
      if (!activeProjectId) return { error: 'No project open' }
      try {
        const read = await window.api.readTemplateFile(activeProjectId, options)
        if (read.canceled) return {}
        const r = validateTemplate(read.template)
        if (!r.ok) return { error: `This template can't be imported: ${r.errors.slice(0, 3).join('; ')}` }
        let result = null
        const proceeded = await get().guardUnsaved(() => {})
        if (!proceeded) return {}
        result = await window.api.importTemplateFile(read.token)
        await get().loadTemplates()
        get().openTemplate(result.template.id)
        const parts = [`Imported "${result.template.name}"`]
        if (result.written.length) parts.push(`${result.written.length} new file${result.written.length === 1 ? '' : 's'}`)
        if (result.reused.length) parts.push(`${result.reused.length} already present`)
        if (result.renamed.length) parts.push(`${result.renamed.length} renamed to avoid overwriting`)
        return { message: parts.join(' · '), warnings: result.warnings }
      } catch (error) {
        return { error: ipcMessage(error) }
      }
    },

    // ----- sample card -----
    setPreviewCard: (id) => {
      set({ previewCardId: id })
    },

    // Step through the cards in the current list (Card Database filter). delta: +1 / -1.
    stepPreviewCard: (delta) => {
      const { cards, previewCardId } = get()
      if (!cards.length) return
      const i = cards.findIndex((c) => c.id === previewCardId)
      const next = cards[((i < 0 ? 0 : i + delta) % cards.length + cards.length) % cards.length]
      set({ previewCardId: next.id })
    },

    // ----- assets -----
    // A file under the project folder changed on disk: bump its version so <img> and fonts reload.
    bumpAsset: (projectId, relPath) => {
      const key = assetKey(projectId, relPath)
      set((s) => ({ assetVersions: { ...s.assetVersions, [key]: (s.assetVersions[key] || 0) + 1 } }))
    },

    // ----- selection -----
    setSelection: (ids) => set({ selectedIds: ids }),
    selectLayer: (id) => set({ selectedIds: id ? [id] : [] }),
    toggleSelection: (id) => set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
    })),

    // ----- editing -----
    // One undoable edit. `key` merges rapid edits of the same field into one undo step.
    edit: (mutator, { key = null, select } = {}) => {
      const { draft, history } = get()
      if (!draft) return
      const next = mutator(draft)
      if (!next || next === draft) return
      setDraft(next, {
        history: pushHistory(history, draft, { key }),
        ...(select !== undefined ? { selectedIds: select } : {}),
      })
    },

    // Drags: one history entry at the first movement, then live updates without history.
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
        obj = JSON.parse(text)
      } catch (error) {
        return `Invalid JSON: ${error.message}`
      }
      const r = validateTemplate(obj)
      if (!r.ok) return r.errors.join('\n')
      const { draft, history } = get()
      if (!draft) {
        set({ draftError: null, history: createHistory() })
        setDraft(r.template)
        return null
      }
      setDraft(r.template, { history: pushHistory(history, draft) })
      return null
    },

    // Validates with the zod schema, then saves. Returns an error message or null.
    saveDraft: async () => {
      const { activeProjectId, activeTemplateId, draft } = get()
      if (!activeProjectId || !activeTemplateId || !draft) return 'Nothing to save'
      const r = validateTemplate(draft)
      if (!r.ok) return r.errors.join('\n')
      try {
        const row = await window.api.saveTemplate(activeProjectId, r.template, activeTemplateId)
        const saved = JSON.parse(row.content)
        set((s) => ({
          templates: s.templates.map((t) => (t.id === row.id ? row : t)),
          savedJson: JSON.stringify(saved),
          dirty: JSON.stringify(s.draft) !== JSON.stringify(saved),
        }))
        return null
      } catch (error) {
        console.error('Failed to save template:', error)
        return ipcMessage(error)
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
