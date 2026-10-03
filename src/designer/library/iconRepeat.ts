// Icon repeat (spec: "draws N copies of an icon from a number field, for cost or health pips").
// Icons sit along the layer's direction, each as big as the frame's short side, a gap apart;
// when they don't fit they move closer (overlapping if they must) to stay inside the frame.

export const MAX_REPEAT = 50

/** Offsets (px from the frame's start edge) of n icons of length `icon` along a line of length `line`. */
export function repeatPositions(n: number, line: number, icon: number, gap: number, reverse = false): number[] {
  if (n <= 0) return []
  const room = Math.max(0, line - icon)
  const step = n === 1 ? 0 : Math.max(0, Math.min(icon + gap, room / (n - 1)))
  return Array.from({ length: n }, (_, i) => (reverse ? room - i * step : i * step))
}

/** The count expression's value as a whole number from 0 to MAX_REPEAT (null: not a number). */
export function repeatCount(text: string): number | null {
  if (text.trim() === '') return 0
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(MAX_REPEAT, Math.floor(n)))
}
