// Which card fields each text layer shows: the identifiers its "{{ … }}" expressions read,
// from the syntax tree (function names and string literals are not fields). Used to name fit
// results by field ("Effect: shrunk to 7.25 pt") and to show a field's fit budget beside it.

import { compile, splitTemplate } from '../expr/expr.ts'
import type { Node } from '../expr/expr.ts'
import type { Layer, Template } from '../schema/types.ts'

function collect(node: Node, out: Set<string>) {
  switch (node.k) {
    case 'id': out.add(node.name); break
    case 'un': collect(node.a, out); break
    case 'bin': collect(node.a, out); collect(node.b, out); break
    case 'call': for (const a of node.args) collect(a, out); break
    default: break
  }
}

/** Field names read by the "{{ … }}" spans of a string, in order of first use. */
export function fieldsInText(text: string): string[] {
  const out = new Set<string>()
  for (const part of splitTemplate(text)) {
    if (!('expr' in part) || !part.expr) continue
    const c = compile(part.expr)
    if (c.ok) collect(c.ast, out)
  }
  return [...out]
}

/** Every text layer of the template by id, with the fields its text shows. */
export function textLayerFields(t: Template): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === 'text' || l.type === 'richText') out.set(l.id, fieldsInText(l.text))
      else if (l.type === 'stack' || l.type === 'group') walk(l.children)
    }
  }
  walk(t.layers)
  return out
}

/** A text layer's name for people: the field it shows ("Effect"), two joined, or its id. */
export function layerLabel(layerId: string, fields: string[] | undefined, labelOf: (key: string) => string | undefined): string {
  const names = (fields || []).map((k) => labelOf(k) || k)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} + ${names[1]}`
  if (names.length > 2) return `${names[0]} + ${names.length - 1} more`
  return layerId
}
