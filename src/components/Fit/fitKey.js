import { resolveTemplate } from '../../designer/rules/resolveTemplate.ts'
import { engineKey, fitInputHash, sizesImagesByFile, templateFontsSignature } from '../../designer/fit/inputs.ts'

// A card's fit-check key: the template it gets and the hash of every fit input
// (src/designer/fit/inputs.ts). Shared by the background check (FitRunner) and the live probe
// (LiveFitProbe), so a result either one measures fits the other's cache entry.

const BROWSER = (navigator.userAgent.match(/Chrome\/[\d.]+/) || [navigator.userAgent])[0]
export const FIT_ENGINE = engineKey(BROWSER)

// Hashes by card object (a card that changes is a new object); file signatures by template.
const memo = new WeakMap()
const templateSigs = new WeakMap()

function filesSigFor(template, sigs) {
  let s = templateSigs.get(template)
  if (!s || s.fontFiles !== sigs.fontFiles || s.images !== sigs.images) {
    s = {
      fontFiles: sigs.fontFiles, images: sigs.images,
      fonts: templateFontsSignature(template, sigs.fontFiles || []),
      imagesSig: sizesImagesByFile(template) ? sigs.images : null,
    }
    templateSigs.set(template, s)
  }
  return s
}

/**
 * templates: Map id -> { row, template, hash } (useParsedTemplates); orderedRules: orderRules(rules);
 * sigs: { fontFiles, images } (store.fitSignatures); library: the library's signature
 * (RenderLibrary.signature). Returns { templateId, templateVersion, template, hash } or null when
 * the card has no template that opens.
 */
export function fitKeyFor(card, templates, orderedRules, sigs, library = '') {
  const { templateId } = resolveTemplate(card, orderedRules, [...templates.keys()])
  const entry = templateId ? templates.get(templateId) : null
  if (!entry?.template) return null
  const files = filesSigFor(entry.template, sigs)
  const key = `${templateId}|${entry.hash}|${files.fonts}|${files.imagesSig}|${library}`
  let m = memo.get(card)
  if (!m || m.key !== key) {
    m = { key, hash: fitInputHash({ card, templateId, templateHash: entry.hash, fontsSig: files.fonts, imagesSig: files.imagesSig, library, engine: FIT_ENGINE }) }
    memo.set(card, m)
  }
  return { templateId, templateVersion: entry.row.version, template: entry.template, hash: m.hash }
}
