// Light markup (spec: "Plain text with shortcodes and light markup"):
//   **bold**   *italic*   {shortcode} symbols   line breaks
// Rich Text reads all of it; plain Text reads symbols only. \* and \{ write the character, and
// "{{" is never a symbol. Markup never produces HTML: the result is runs that the renderer turns
// into React nodes (text, or a symbol image).

export interface Run {
  text: string
  bold: boolean
  italic: boolean
  symbol?: string // shortcode, for a symbol run (text is then '')
}

export interface MarkupOptions {
  symbols?: { has(code: string): boolean } // known shortcodes
  unknown?: string[] // receives {codes} that look like symbols but aren't defined
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_+\-/]{0,23}$/

// At line[i] === '{': a symbol's code and where it ends, or null.
function symbolAt(line: string, i: number, opts: MarkupOptions): { code: string; end: number } | null {
  if (line[i + 1] === '{') return null
  const close = line.indexOf('}', i + 1)
  if (close < 0 || close - i > 25) return null
  const code = line.slice(i + 1, close)
  if (!CODE.test(code)) return null
  if (opts.symbols?.has(code)) return { code, end: close }
  if (opts.unknown && !opts.unknown.includes(code)) opts.unknown.push(code)
  return null
}

function parseLine(line: string, markup: boolean, opts: MarkupOptions): Run[] {
  const runs: Run[] = []
  let bold = false
  let italic = false
  let buf = ''
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic })
    buf = ''
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    // Escapes: \{ everywhere; \* and \\ where markup is read (plain text keeps other backslashes).
    if (c === '\\' && (line[i + 1] === '{' || (markup && (line[i + 1] === '\\' || line[i + 1] === '*')))) {
      buf += line[i + 1]
      i++
      continue
    }
    if (c === '{') {
      if (line[i + 1] === '{') { buf += '{{'; i++; continue }
      const sym = symbolAt(line, i, opts)
      if (sym) {
        flush()
        runs.push({ text: '', bold, italic, symbol: sym.code })
        i = sym.end
        continue
      }
    }
    if (markup && line.startsWith('**', i)) {
      flush()
      bold = !bold
      i++
      continue
    }
    if (markup && c === '*') {
      flush()
      italic = !italic
      continue
    }
    buf += c
  }
  flush()
  return runs
}

/** Rich Text: one list of runs per line. */
export function parseRichText(src: string, opts: MarkupOptions = {}): Run[][] {
  return src.split('\n').map((line) => parseLine(line, true, opts))
}

/** Plain Text: symbols only; newlines stay in the text. */
export function parseSymbols(src: string, opts: MarkupOptions = {}): Run[] {
  return parseLine(src, false, opts)
}

export function plainText(src: string): string {
  return parseRichText(src).map((runs) => runs.map((r) => r.text).join('')).join('\n')
}
