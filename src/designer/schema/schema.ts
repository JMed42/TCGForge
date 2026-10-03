// zod validator for template schema v1. Used before saving, on import of .tcgtemplate files,
// and when a template is opened.

import { z } from 'zod'
import { compile } from '../expr/expr.ts'
import type { Layer, Template } from './types.ts'

export const LIMITS = { maxSizeMm: 500, maxLayers: 2000, maxDepth: 16 }

const length = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d+)?%$/, 'use a number (mm) or a percentage like "50%"'),
])

const frame = z
  .object({
    left: length.optional(), right: length.optional(), width: length.optional(),
    top: length.optional(), bottom: length.optional(), height: length.optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const h = ['left', 'right', 'width'].filter((k) => f[k as keyof typeof f] !== undefined).length
    const v = ['top', 'bottom', 'height'].filter((k) => f[k as keyof typeof f] !== undefined).length
    if (h > 2) ctx.addIssue({ code: 'custom', message: 'set at most two of left / right / width' })
    if (v > 2) ctx.addIssue({ code: 'custom', message: 'set at most two of top / bottom / height' })
  })

const expression = z.string().max(2000).superRefine((src, ctx) => {
  if (!src.trim()) return
  const c = compile(src)
  if (!c.ok) ctx.addIssue({ code: 'custom', message: `expression: ${c.error}` })
})

const color = z.string().max(64)

const base = {
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'ids start with a letter: letters, digits, - and _'),
  frame: frame.optional(),
  visibleIf: expression.optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
}

const style = z
  .object({
    font: z.string().max(200).optional(),
    sizePt: z.number().positive().max(500).optional(),
    weight: z.number().int().min(100).max(1000).optional(),
    italic: z.boolean().optional(),
    color: color.optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    valign: z.enum(['top', 'middle', 'bottom']).optional(),
    lineHeight: z.number().positive().max(10).optional(),
    letterSpacingPt: z.number().min(-50).max(50).optional(),
    wrap: z.boolean().optional(),
  })
  .strict()

const fit = z
  .object({
    minPt: z.number().positive().max(500).optional(),
    maxPt: z.number().positive().max(500).optional(),
    strategy: z.array(z.enum(['shrink', 'tightenLeading', 'hide'])).max(3).optional(),
  })
  .strict()

const textLayer = z.object({ ...base, type: z.enum(['text', 'richText']), text: z.string().max(20000), style: style.optional(), fit: fit.optional(), keywords: z.boolean().optional() }).strict()
const imageLayer = z
  .object({
    ...base,
    type: z.literal('image'),
    src: z.string().max(2000),
    objectFit: z.enum(['cover', 'contain', 'fill', 'tile']).optional(),
    objectPosition: z.string().max(64).optional(),
    placeholder: z.enum(['proxy', 'none']).optional(),
    radiusMm: z.number().min(0).max(500).optional(),
  })
  .strict()
const shapeLayer = z
  .object({
    ...base,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'roundRect', 'ellipse']),
    fill: color.optional(),
    stroke: color.optional(),
    strokeMm: z.number().min(0).max(100).optional(),
    radiusMm: z.number().min(0).max(500).optional(),
  })
  .strict()
const iconRepeatLayer = z
  .object({
    ...base, type: z.literal('iconRepeat'), count: expression, icon: z.string().max(200),
    direction: z.enum(['ltr', 'rtl', 'ttb', 'btt']).optional(), gapMm: z.number().min(0).max(100).optional(),
  })
  .strict()

// Recursive containers: zod 4 getters keep the type lazy.
const stackLayer = z
  .object({
    ...base,
    type: z.literal('stack'),
    direction: z.enum(['vertical', 'horizontal']).optional(),
    gapMm: z.number().min(0).max(500).optional(),
    fitOrder: z.enum(['shrinkFirst', 'hideFirst']).optional(),
    get children() { return z.array(layer) },
  })
  .strict()
const groupLayer = z
  .object({ ...base, type: z.literal('group'), get children() { return z.array(layer) } })
  .strict()

export const layer: z.ZodType<Layer> = z.discriminatedUnion('type', [
  textLayer, imageLayer, shapeLayer, iconRepeatLayer, stackLayer, groupLayer,
]) as unknown as z.ZodType<Layer>

export const templateSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().max(200).optional(),
    size: z
      .object({
        widthMm: z.number().positive().max(LIMITS.maxSizeMm),
        heightMm: z.number().positive().max(LIMITS.maxSizeMm),
        bleedMm: z.number().min(0).max(50),
        safeMm: z.number().min(0).max(100),
        cornerRadiusMm: z.number().min(0).max(100).optional(),
      })
      .strict(),
    layers: z.array(layer),
  })
  .strict()
  .superRefine((t, ctx) => {
    const ids = new Set<string>()
    let count = 0
    const walk = (layers: Layer[], depth: number) => {
      if (depth > LIMITS.maxDepth) ctx.addIssue({ code: 'custom', message: `layers nest deeper than ${LIMITS.maxDepth}` })
      for (const l of layers) {
        count++
        if (ids.has(l.id)) ctx.addIssue({ code: 'custom', message: `duplicate layer id "${l.id}"` })
        ids.add(l.id)
        if (l.type === 'stack' || l.type === 'group') walk(l.children, depth + 1)
      }
    }
    walk(t.layers, 1)
    if (count > LIMITS.maxLayers) ctx.addIssue({ code: 'custom', message: `more than ${LIMITS.maxLayers} layers` })
  })

export type ValidationResult = { ok: true; template: Template } | { ok: false; errors: string[] }

// Duplicate ids, checked on the raw input so they are reported even when other parts of the
// template fail (zod skips whole-object refinements once a nested check has failed).
function duplicateIds(input: unknown): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  const walk = (layers: unknown, depth: number) => {
    if (!Array.isArray(layers) || depth > LIMITS.maxDepth) return
    for (const l of layers) {
      if (!l || typeof l !== 'object') continue
      const id = (l as { id?: unknown }).id
      if (typeof id === 'string') { if (seen.has(id)) dups.add(id); seen.add(id) }
      walk((l as { children?: unknown }).children, depth + 1)
    }
  }
  if (input && typeof input === 'object') walk((input as { layers?: unknown }).layers, 1)
  return [...dups]
}

export function validateTemplate(input: unknown): ValidationResult {
  const r = templateSchema.safeParse(input)
  if (r.success) return { ok: true, template: r.data as Template }
  const errors = r.error.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
  for (const id of duplicateIds(input)) {
    const msg = `duplicate layer id "${id}"`
    if (!errors.includes(msg)) errors.push(msg)
  }
  return { ok: false, errors: errors.slice(0, 20) }
}
