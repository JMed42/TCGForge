// Light markup for richText (spec: "Plain text with shortcodes and light markup"):
//   **bold**   *italic*   line breaks
// Shortcodes like {fire} are Phase 4; until then they render as typed. Markup never produces
// HTML: the result is a list of runs that the renderer turns into React text nodes.

export interface Run {
  text: string
  bold: boolean
  italic: boolean
}

export function parseRichText(src: string): Run[][] {
  const lines: Run[][] = []
  for (const line of src.split('\n')) {
    const runs: Run[] = []
    let bold = false
    let italic = false
    let buf = ''
    const flush = () => {
      if (buf) runs.push({ text: buf, bold, italic })
      buf = ''
    }
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && (line[i + 1] === '*' || line[i + 1] === '\\')) {
        buf += line[i + 1]
        i++
        continue
      }
      if (line.startsWith('**', i)) {
        flush()
        bold = !bold
        i++
        continue
      }
      if (line[i] === '*') {
        flush()
        italic = !italic
        continue
      }
      buf += line[i]
    }
    flush()
    lines.push(runs)
  }
  return lines
}

export function plainText(src: string): string {
  return parseRichText(src).map((runs) => runs.map((r) => r.text).join('')).join('\n')
}
