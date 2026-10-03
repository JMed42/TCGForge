// Global variables (spec: "change {{HAND_SIZE}} once and every card updates"). Keys are
// UPPER_CASE, so they never clash with card fields (lower case). Templates read them as
// identifiers; card text may name one as {{HAND_SIZE}}, replaced once (no nesting).

export const VARIABLE_KEY = /^[A-Z][A-Z0-9_]{0,47}$/
const REF = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g

/** Replace {{KEY}} with the variable's value. Unknown keys stay as typed. */
export function expandVariables(text: string, vars: Record<string, string>): { text: string; unknown: string[] } {
  if (!text.includes('{{')) return { text, unknown: [] }
  const unknown: string[] = []
  const out = text.replace(REF, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key]
    if (!unknown.includes(key)) unknown.push(key)
    return whole
  })
  return { text: out, unknown }
}

/** Variable names still written as {{KEY}} in a text (unknown ones, after expansion). */
export function variableRefs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(REF)) if (!out.includes(m[1])) out.push(m[1])
  return out
}
