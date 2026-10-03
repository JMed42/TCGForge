// The Designer's sample cards: by default only the cards that the open template draws (by their
// own choice, an exception, their type's default or the project default), so a "Unit Frame" is
// designed against Units. Falls back to every card when none use the template yet.

import { orderRules, resolveTemplate } from '../../designer/rules/resolveTemplate.ts'

export function sampleCards({ cards, templates, templateRules, activeTemplateId, sampleScope }) {
  if (sampleScope === 'all' || !activeTemplateId) return { list: cards, scoped: false, none: false }
  const ids = templates.map((t) => t.id)
  const ordered = orderRules(templateRules || [])
  const list = cards.filter((c) => resolveTemplate(c, ordered, ids).templateId === activeTemplateId)
  return list.length ? { list, scoped: true, none: false } : { list: cards, scoped: false, none: true }
}
