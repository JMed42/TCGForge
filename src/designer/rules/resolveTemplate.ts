// Which template a card uses ("Template assignment").
//   1. the card's own choice (template_override_id), when that template exists
//   2. the first exception (template_rules, by priority) whose condition is true for the card
//   3. the card type's default template (card_types.template_id, joined as card_type_template_id)
//   4. the project default: the template with the lowest id
// Conditions are bare expressions in the sandboxed language; an empty condition always matches,
// and one that fails to evaluate counts as false and is reported.

import { condition } from '../expr/expr.ts'
import { cardScope } from '../expr/scope.ts'

export interface TemplateRule {
  id?: number
  priority?: number
  condition_expr: string
  template_id: number
}

export type ResolveReason = 'override' | 'rule' | 'type' | 'default' | 'none'

export interface Resolution {
  templateId: number | null
  reason: ResolveReason
  /** index into the priority-ordered rules when reason === 'rule' */
  ruleIndex?: number
  /** expression errors met on the way, "exception 2: unknown function foo" */
  errors: string[]
  /** the card's type name when reason === 'type' */
  typeName?: string
}

type Card = Record<string, unknown> & { template_override_id?: unknown; card_type_template_id?: unknown; card_type?: unknown }

export function orderRules(rules: TemplateRule[]): TemplateRule[] {
  return rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.priority ?? a.i) - (b.r.priority ?? b.i) || a.i - b.i)
    .map((x) => x.r)
}

export function defaultTemplateId(templateIds: number[]): number | null {
  return templateIds.length ? Math.min(...templateIds) : null
}

/** rules must already be in priority order (orderRules). */
export function resolveTemplate(card: Card, rules: TemplateRule[], templateIds: number[]): Resolution {
  const known = new Set(templateIds)
  const errors: string[] = []
  const override = Number(card.template_override_id)
  if (Number.isInteger(override) && known.has(override)) return { templateId: override, reason: 'override', errors }
  const scope = cardScope(card)
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!known.has(rule.template_id)) continue
    const c = condition(rule.condition_expr, scope)
    if (c.error) errors.push(`exception ${i + 1}: ${c.error}`)
    if (c.value) return { templateId: rule.template_id, reason: 'rule', ruleIndex: i, errors }
  }
  const typeTemplate = Number(card.card_type_template_id)
  if (Number.isInteger(typeTemplate) && known.has(typeTemplate)) {
    return { templateId: typeTemplate, reason: 'type', errors, typeName: String(card.card_type ?? '') }
  }
  const fallback = defaultTemplateId(templateIds)
  return { templateId: fallback, reason: fallback === null ? 'none' : 'default', errors }
}

export function resolveAll(cards: Card[], rules: TemplateRule[], templateIds: number[]): Map<unknown, Resolution> {
  const ordered = orderRules(rules)
  const out = new Map<unknown, Resolution>()
  for (const c of cards) out.set(c.id, resolveTemplate(c, ordered, templateIds))
  return out
}

/** How many cards each rule decides, plus overrides, defaults and cards with expression errors. */
export function ruleStats(cards: Card[], rules: TemplateRule[], templateIds: number[]) {
  const ordered = orderRules(rules)
  const perRule = ordered.map(() => 0)
  let overrides = 0
  let byType = 0
  let defaults = 0
  let withErrors = 0
  for (const c of cards) {
    const r = resolveTemplate(c, ordered, templateIds)
    if (r.reason === 'rule') perRule[r.ruleIndex!]++
    else if (r.reason === 'override') overrides++
    else if (r.reason === 'type') byType++
    else defaults++
    if (r.errors.length) withErrors++
  }
  return { perRule, overrides, byType, defaults, withErrors }
}

export function describeResolution(r: Resolution, templateName: (id: number) => string): string {
  if (r.templateId === null) return 'No template'
  const name = templateName(r.templateId)
  if (r.reason === 'override') return `${name} (chosen for this card)`
  if (r.reason === 'rule') return `${name} (exception ${r.ruleIndex! + 1})`
  if (r.reason === 'type') return `${name} (from type ${r.typeName || '?'})`
  return `${name} (default)`
}
