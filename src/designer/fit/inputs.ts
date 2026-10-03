// What a card's fit results depend on, as one hash (the fit_cache key, electron/fitCache.js).
// Change any input and the hash changes, so the card is checked again: nothing has to
// remember to invalidate the cache.
//
//   the card's values as the template sees them (cardScope, which includes card_type)
//   which template the card gets (own choice, exception, card type, project default) and that
//     template's saved content
//   the project font files the template's text uses, and the project's image files when the
//     template lets an image size itself by the file inside a stack (its height moves the text)
//   the fit engine's version and the browser engine's version

import { cardScope } from '../expr/scope.ts'
import type { Layer, Template } from '../schema/types.ts'
import { hashOf } from './hash.ts'

// Bump when the fit engine (fitText, fitStack, CardRender's measuring) would report differently:
// every cached result is then checked again.
export const FIT_ENGINE_VERSION = 1

// Fit checks measure at 300 dpi, the default export resolution.
export const FIT_PX_PER_MM = 300 / 25.4

export interface AssetRow {
  rel_path: string
  kind: string
  sha256: string
}

const filesSignature = (rows: AssetRow[]) => hashOf(rows.map((a) => [a.rel_path, a.sha256]).sort())
export const fontsSignature = (assets: AssetRow[]) => filesSignature(assets.filter((a) => a.kind === 'font'))
export const imagesSignature = (assets: AssetRow[]) => filesSignature(assets.filter((a) => a.kind !== 'font'))

export interface FontFile {
  rel: string
  sha: string
  family: string // lower case
}

// A project font file's family, named the way electron/cardDesigner/projectFonts.js names it:
// "Cinzel-Bold.ttf" -> "cinzel".
export const fontFamilyOf = (rel: string) => (rel.split('/').pop() || '').replace(/\.(ttf|otf|woff2?)$/i, '').split('-')[0].trim().toLowerCase()

export const fontFiles = (assets: AssetRow[]): FontFile[] =>
  assets.filter((a) => a.kind === 'font').map((a) => ({ rel: a.rel_path, sha: a.sha256, family: fontFamilyOf(a.rel_path) }))

/** Font families the template's text asks for (lower case). */
export function templateFamilies(t: Template): Set<string> {
  const out = new Set<string>()
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if ((l.type === 'text' || l.type === 'richText') && l.style?.font) out.add(l.style.font.trim().toLowerCase())
      if (l.type === 'stack' || l.type === 'group') walk(l.children)
    }
  }
  walk(t.layers)
  return out
}

/** The project font files this template uses: replacing another font doesn't re-check its cards. */
export function templateFontsSignature(t: Template, files: FontFile[]): string {
  const families = templateFamilies(t)
  return hashOf(files.filter((f) => families.has(f.family)).map((f) => [f.rel, f.sha]).sort())
}

/** Does the template have an image inside a stack with no length of its own along the stack? */
export function sizesImagesByFile(t: Template): boolean {
  const walk = (layers: Layer[], direction: 'vertical' | 'horizontal' | null): boolean => layers.some((l) => {
    if (l.type === 'image' && direction) return (direction === 'vertical' ? l.frame?.height : l.frame?.width) === undefined
    if (l.type === 'stack') return walk(l.children, l.direction === 'horizontal' ? 'horizontal' : 'vertical')
    if (l.type === 'group') return walk(l.children, null)
    return false
  })
  return walk(t.layers, null)
}

/** The engine part of every key: this engine and the browser that lays the text out. */
export const engineKey = (browser: string) => `${FIT_ENGINE_VERSION}|${browser}`

export interface FitInputs {
  card: Record<string, unknown>
  templateId: number | null
  templateHash: string | null // hashOf(the template's saved content); null: no template
  fontsSig: string
  imagesSig?: string | null // only for templates that size images by their file
  engine: string
}

export function fitInputHash(i: FitInputs): string {
  return hashOf([i.engine, i.templateId, i.templateHash, i.fontsSig, i.imagesSig ?? null, cardScope(i.card)])
}
