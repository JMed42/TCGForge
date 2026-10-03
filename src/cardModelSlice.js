// Card types and fields (the project's data model), composed into the main store. Every change
// is saved at once through the main process (electron/cardModel.js), which returns the new model.

import { emptyModel } from './cardModel/model'
import { renameFieldInTemplate, renameFieldInCondition } from './designer/model/renameField.ts'

const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createCardModelSlice(set, get) {
  // Run a model change; on success take the returned model. Returns { error } or the result.
  const change = async (fn) => {
    try {
      const res = await fn(get().activeProjectId)
      const model = res && res.model ? res.model : res
      if (model && Array.isArray(model.types)) set({ cardModel: model })
      return res || {}
    } catch (error) {
      return { error: ipcMessage(error) }
    }
  }

  return {
    cardModel: emptyModel(),

    loadCardModel: async () => {
      const { activeProjectId } = get()
      if (!activeProjectId) { set({ cardModel: emptyModel() }); return }
      try {
        const model = await window.api.getCardModel(activeProjectId)
        if (get().activeProjectId === activeProjectId) set({ cardModel: model })
      } catch (error) {
        console.error('Failed to load card types:', error)
      }
    },

    saveCardField: (field) => change((pid) => window.api.saveCardField(pid, field)),
    saveCardType: async (type) => {
      const res = await change((pid) => window.api.saveCardType(pid, type))
      if (!res.error && type.id) get().loadCards?.() // card rows carry the type name and template
      return res
    },
    deleteCardType: async (id, options) => {
      const res = await change((pid) => window.api.deleteCardType(pid, id, options))
      if (!res.error) await get().loadCards?.()
      return res
    },
    reorderCardTypes: (ids) => change((pid) => window.api.reorderCardTypes(pid, ids)),
    deleteCardField: async (key, options) => {
      const res = await change((pid) => window.api.deleteCardField(pid, key, options))
      if (!res.error && options?.purgeValues) await get().loadCards?.()
      return res
    },

    /**
     * Rename a custom field's key everywhere: card values (main process), and every binding in
     * templates and template exceptions (rewritten here with the token-aware renamer).
     */
    renameCardField: async (oldKey, newKey) => {
      if (get().dirty) return { error: 'Save or discard your Designer changes first; the rename updates templates.' }
      const pid = get().activeProjectId
      try {
        const rows = (await window.api.getTemplates(pid)) || []
        const templates = []
        for (const row of rows) {
          let t
          try { t = JSON.parse(row.content) } catch { continue }
          const next = renameFieldInTemplate(t, oldKey, newKey)
          if (next !== t) templates.push({ id: row.id, content: JSON.stringify(next, null, 2) })
        }
        const rules = ((await window.api.getTemplateRules(pid)) || [])
          .map((r) => ({ id: r.id, condition_expr: renameFieldInCondition(r.condition_expr, oldKey, newKey), before: r.condition_expr }))
          .filter((r) => r.condition_expr !== r.before)
          .map(({ id, condition_expr }) => ({ id, condition_expr }))
        const res = await window.api.renameCardField(pid, oldKey, newKey, { templates, rules })
        set({ cardModel: res.model })
        const s = get()
        await Promise.all([s.loadCards?.(), s.loadTemplateRules?.(), s.loadTemplates?.()])
        if (s.activeTemplateId && templates.some((t) => t.id === s.activeTemplateId)) get().openTemplate(s.activeTemplateId)
        return { moved: res.moved, templates: templates.length, rules: rules.length }
      } catch (error) {
        return { error: ipcMessage(error) }
      }
    },
  }
}
