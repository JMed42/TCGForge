// Sandboxed expression language for template bindings (spec: "Any property can bind to data
// through a small, sandboxed expression language"). Hand-written tokenizer, Pratt parser and
// tree-walking evaluator. There is no eval / Function, no property access and no assignment:
// an expression can only read the identifiers in its scope and call whitelisted functions.
//
//   {{cost}}   {{upper(name)}}   {{if(faction == "Ember", "#c0392b", "#555")}}
//   visibleIf: rarity == 'Mythic' && power >= 3

export type Value = string | number | boolean | null

export type Node =
  | { k: 'lit'; v: Value }
  | { k: 'id'; name: string }
  | { k: 'un'; op: '!' | '-'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

export type Scope = Record<string, Value>

export type CompileResult = { ok: true; ast: Node } | { ok: false; error: string; pos: number }
export type EvalResult = { ok: true; value: Value } | { ok: false; error: string }

export const LIMITS = { maxLength: 2000, maxDepth: 64, maxSteps: 10000 }

// ---------------------------------------------------------------------------- tokenizer

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; pos: number }

const OPS = ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '=', '+', '-', '*', '/', '%', '!', '(', ')', ',']

class ExprError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i))!
      out.push({ t: 'num', v: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          j += 2
        } else {
          s += src[j++]
        }
      }
      if (j >= src.length) throw new ExprError('unterminated string', i)
      out.push({ t: 'str', v: s, pos: i })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0], pos: i })
      i += m[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new ExprError(`unexpected character "${c}"`, i)
    out.push({ t: 'op', v: op, pos: i })
    i += op.length
  }
  out.push({ t: 'eof', v: '', pos: src.length })
  return out
}

// ---------------------------------------------------------------------------- parser

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
}
const UNARY_BP = 7

function parse(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const expect = (v: string) => {
    const t = next()
    if (t.t !== 'op' || t.v !== v) throw new ExprError(`expected "${v}"`, t.pos)
  }

  const expr = (minBp: number, depth: number): Node => {
    if (depth > LIMITS.maxDepth) throw new ExprError('expression is nested too deeply', peek().pos)
    let left = prefix(depth)
    for (;;) {
      const t = peek()
      if (t.t !== 'op' || !(t.v in BINARY)) break
      const bp = BINARY[t.v]
      if (bp <= minBp) break
      next()
      const right = expr(bp, depth + 1) // left-associative
      left = { k: 'bin', op: t.v === '=' ? '==' : t.v, a: left, b: right }
    }
    return left
  }

  const prefix = (depth: number): Node => {
    const t = next()
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) }
    if (t.t === 'str') return { k: 'lit', v: t.v }
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true }
      if (t.v === 'false') return { k: 'lit', v: false }
      if (t.v === 'null') return { k: 'lit', v: null }
      if (peek().t === 'op' && peek().v === '(') {
        next()
        const fn = t.v.toLowerCase()
        if (!(fn in FUNCTIONS)) throw new ExprError(`unknown function "${t.v}"`, t.pos)
        const args: Node[] = []
        if (!(peek().t === 'op' && peek().v === ')')) {
          for (;;) {
            args.push(expr(0, depth + 1))
            if (peek().t === 'op' && peek().v === ',') { next(); continue }
            break
          }
        }
        expect(')')
        const [min, max] = FUNCTIONS[fn].arity
        if (args.length < min || args.length > max) {
          throw new ExprError(`${fn}() takes ${min === max ? min : `${min}-${max === Infinity ? 'any' : max}`} argument(s)`, t.pos)
        }
        return { k: 'call', fn, args }
      }
      return { k: 'id', name: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr(0, depth + 1)
      expect(')')
      return e
    }
    if (t.t === 'op' && (t.v === '!' || t.v === '-')) {
      return { k: 'un', op: t.v, a: expr(UNARY_BP, depth + 1) }
    }
    if (t.t === 'eof') throw new ExprError('unexpected end of expression', t.pos)
    throw new ExprError(`unexpected "${t.v}"`, t.pos)
  }

  const ast = expr(0, 0)
  if (peek().t !== 'eof') throw new ExprError(`unexpected "${peek().v}"`, peek().pos)
  return ast
}

// ---------------------------------------------------------------------------- values

export function toText(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : ''
  return String(v)
}

// Card fields are stored as text ("5"), so arithmetic and comparison treat numeric-looking
// strings as numbers.
function asNumber(v: Value): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function truthy(v: Value): boolean {
  return !(v === null || v === false || v === '' || v === 0)
}

function looseEqual(a: Value, b: Value): boolean {
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null && typeof a !== 'boolean' && typeof b !== 'boolean') return na === nb
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b)
  return toText(a) === toText(b)
}

function compare(a: Value, b: Value): number {
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na - nb
  const sa = toText(a)
  const sb = toText(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

// ---------------------------------------------------------------------------- functions

type Fn = { arity: [number, number]; lazy?: boolean; call: (args: Value[]) => Value }

const num = (v: Value, name: string): number => {
  const n = asNumber(v)
  if (n === null) throw new ExprError(`${name}() needs a number, got "${toText(v)}"`, 0)
  return n
}

const FUNCTIONS: Record<string, Fn> = {
  if: { arity: [2, 3], lazy: true, call: () => null }, // evaluated lazily in evalNode
  upper: { arity: [1, 1], call: ([s]) => toText(s).toUpperCase() },
  lower: { arity: [1, 1], call: ([s]) => toText(s).toLowerCase() },
  trim: { arity: [1, 1], call: ([s]) => toText(s).trim() },
  len: { arity: [1, 1], call: ([s]) => toText(s).length },
  concat: { arity: [0, Infinity], call: (a) => a.map(toText).join('') },
  contains: { arity: [2, 2], call: ([s, sub]) => toText(s).toLowerCase().includes(toText(sub).toLowerCase()) },
  replace: { arity: [3, 3], call: ([s, find, rep]) => (toText(find) === '' ? toText(s) : toText(s).split(toText(find)).join(toText(rep))) },
  round: {
    arity: [1, 2],
    call: ([x, d]) => {
      const digits = d === undefined || d === null ? 0 : Math.max(0, Math.min(10, Math.floor(num(d, 'round'))))
      const f = 10 ** digits
      return Math.round(num(x, 'round') * f) / f
    },
  },
  floor: { arity: [1, 1], call: ([x]) => Math.floor(num(x, 'floor')) },
  ceil: { arity: [1, 1], call: ([x]) => Math.ceil(num(x, 'ceil')) },
  min: { arity: [1, Infinity], call: (a) => Math.min(...a.map((v) => num(v, 'min'))) },
  max: { arity: [1, Infinity], call: (a) => Math.max(...a.map((v) => num(v, 'max'))) },
  number: { arity: [1, 1], call: ([v]) => asNumber(v) },
  string: { arity: [1, 1], call: ([v]) => toText(v) },
  default: { arity: [2, 2], call: ([v, fallback]) => (v === null || v === '' ? fallback : v) },
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS)

// ---------------------------------------------------------------------------- evaluator

function evalNode(node: Node, scope: Scope, budget: { steps: number }): Value {
  if (++budget.steps > LIMITS.maxSteps) throw new ExprError('expression is too expensive', 0)
  switch (node.k) {
    case 'lit':
      return node.v
    case 'id':
      return Object.prototype.hasOwnProperty.call(scope, node.name) ? scope[node.name] : null
    case 'un': {
      const v = evalNode(node.a, scope, budget)
      if (node.op === '!') return !truthy(v)
      const n = asNumber(v)
      return n === null ? null : -n
    }
    case 'bin': {
      if (node.op === '&&') return truthy(evalNode(node.a, scope, budget)) && truthy(evalNode(node.b, scope, budget))
      if (node.op === '||') return truthy(evalNode(node.a, scope, budget)) || truthy(evalNode(node.b, scope, budget))
      const a = evalNode(node.a, scope, budget)
      const b = evalNode(node.b, scope, budget)
      switch (node.op) {
        case '==': return looseEqual(a, b)
        case '!=': return !looseEqual(a, b)
        case '<': return compare(a, b) < 0
        case '>': return compare(a, b) > 0
        case '<=': return compare(a, b) <= 0
        case '>=': return compare(a, b) >= 0
        case '+': {
          const na = asNumber(a)
          const nb = asNumber(b)
          if (na !== null && nb !== null && typeof a !== 'boolean' && typeof b !== 'boolean') return na + nb
          return toText(a) + toText(b)
        }
        default: {
          const na = asNumber(a)
          const nb = asNumber(b)
          if (na === null || nb === null) return null
          if ((node.op === '/' || node.op === '%') && nb === 0) throw new ExprError('division by zero', 0)
          if (node.op === '-') return na - nb
          if (node.op === '*') return na * nb
          if (node.op === '/') return na / nb
          return na % nb
        }
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.fn]
      if (node.fn === 'if') {
        const cond = truthy(evalNode(node.args[0], scope, budget))
        if (cond) return evalNode(node.args[1], scope, budget)
        return node.args[2] ? evalNode(node.args[2], scope, budget) : null
      }
      return fn.call(node.args.map((a) => evalNode(a, scope, budget)))
    }
  }
}

// ---------------------------------------------------------------------------- public API

const compileCache = new Map<string, CompileResult>()
const CACHE_LIMIT = 2000

export function compile(src: string): CompileResult {
  const cached = compileCache.get(src)
  if (cached) return cached
  let result: CompileResult
  if (src.length > LIMITS.maxLength) {
    result = { ok: false, error: `expression is longer than ${LIMITS.maxLength} characters`, pos: 0 }
  } else {
    try {
      result = { ok: true, ast: parse(src) }
    } catch (err) {
      const e = err as ExprError
      result = { ok: false, error: e.message, pos: e.pos ?? 0 }
    }
  }
  if (compileCache.size >= CACHE_LIMIT) compileCache.clear()
  compileCache.set(src, result)
  return result
}

export function evaluate(src: string, scope: Scope): EvalResult {
  const c = compile(src)
  if (!c.ok) return { ok: false, error: c.error }
  try {
    return { ok: true, value: evalNode(c.ast, scope, { steps: 0 }) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Rename a field in a bare expression: identifier tokens equal to `from` that are not function
 * calls. String literals, function names and spacing are untouched. Source that doesn't tokenize
 * is returned unchanged.
 */
export function renameIdentifier(src: string, from: string, to: string): string {
  let toks: Tok[]
  try { toks = tokenize(src) } catch { return src }
  let out = ''
  let last = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== 'id' || t.v !== from) continue
    const after = toks[i + 1]
    if (after && after.t === 'op' && after.v === '(') continue
    out += src.slice(last, t.pos) + to
    last = t.pos + t.v.length
  }
  return out + src.slice(last)
}

/** renameIdentifier inside every "{{ … }}" span of a template string; literal text is untouched. */
export function renameInTemplateText(text: string, from: string, to: string): string {
  if (!text.includes('{{')) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      let j = i + 2
      let quote: string | null = null
      while (j < text.length) {
        const c = text[j]
        if (quote) {
          if (c === '\\') { j += 2; continue }
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") {
          quote = c
        } else if (text.startsWith('}}', j)) {
          break
        }
        j++
      }
      if (j < text.length) {
        out += `{{${renameIdentifier(text.slice(i + 2, j), from, to)}}}`
        i = j + 2
        continue
      }
    }
    out += text[i++]
  }
  return out
}

// Find "{{ … }}" spans, skipping "}}" inside string literals. Unclosed "{{" stays literal.
export function splitTemplate(text: string): Array<{ lit: string } | { expr: string }> {
  const parts: Array<{ lit: string } | { expr: string }> = []
  let i = 0
  let lit = ''
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      let j = i + 2
      let quote: string | null = null
      while (j < text.length) {
        const c = text[j]
        if (quote) {
          if (c === '\\') { j += 2; continue }
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") {
          quote = c
        } else if (text.startsWith('}}', j)) {
          break
        }
        j++
      }
      if (j < text.length) {
        if (lit) { parts.push({ lit }); lit = '' }
        parts.push({ expr: text.slice(i + 2, j).trim() })
        i = j + 2
        continue
      }
    }
    lit += text[i++]
  }
  if (lit) parts.push({ lit })
  return parts
}

// String property with {{expr}} interpolation. Errors are collected, not thrown; a failing
// expression contributes "".
export function interpolate(text: string, scope: Scope): { text: string; errors: string[] } {
  if (!text.includes('{{')) return { text, errors: [] }
  const errors: string[] = []
  let out = ''
  for (const part of splitTemplate(text)) {
    if ('lit' in part) { out += part.lit; continue }
    if (part.expr === '') continue
    const r = evaluate(part.expr, scope)
    if (r.ok) out += toText(r.value)
    else errors.push(`{{${part.expr}}}: ${r.error}`)
  }
  return { text: out, errors }
}

// Bare expression used as a condition (visibleIf). Empty means "always".
export function condition(src: string | undefined, scope: Scope): { value: boolean; error?: string } {
  if (!src || !src.trim()) return { value: true }
  const r = evaluate(src, scope)
  if (!r.ok) return { value: false, error: r.error }
  return { value: truthy(r.value) }
}
