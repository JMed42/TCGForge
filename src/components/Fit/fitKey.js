import { resolveTemplate } from '../../designer/rules/resolveTemplate.ts'
import { engineKey, fitInputHash, sizesImagesByFile } from '../../designer/fit/inputs.ts'

// A card's fit-check key: the template it gets and the hash of every fit input
// (src/designer/fit/inputs.ts). Shared by the background check (FitRunner) and the live probe
// (LiveFitProbe), so a result either one measures fits the other's cache entry.

const BROWSER = (navigator.userAgent.match(/Chrome\/[\d.]+/) || [navigator.userAgent])[0]
export const FIT_ENGINE = engineKey(BROWSER)

// Hashes by card object (a card that changes is a new object).
const memo = new WeakMap()

/**
 * templates: Map id -> { row, template, hash } (useParsedTemplates); orderedRules: orderRules(rules);
 * sigs: { fonts, images }. Returns { templateId, templateVersion, template, hash } or null when the
 * card has no template that opens.
 */
export function fitKeyFor(card, templates, orderedRules, sigs) {
  const { templateId } = resolveTemplate(card, orderedRules, [...templates.keys()])
  const entry = templateId ? templates.get(templateId) : null
  if (!entry?.template) return null
  const imagesSig = sizesImagesByFile(entry.template) ? sigs.images : null
  const key = `${templateId}|${entry.hash}|${sigs.fonts}|${imagesSig}`
  let m = memo.get(card)
  if (!m || m.key !== key) {
    m = { key, hash: fitInputHash({ card, templateId, templateHash: entry.hash, fontsSig: sigs.fonts, imagesSig, engine: FIT_ENGINE }) }
    memo.set(card, m)
  }
  return { templateId, templateVersion: entry.row.version, template: entry.template, hash: m.hash }
}
