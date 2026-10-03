// Edit-to-paint timing for the Cards preview (spec: a cell edit re-renders in under 100 ms).
// The cell editor marks the input event's timestamp; the preview reports when the frame showing
// that edit has been painted. Samples are kept on window for the in-app checks.

let pending = null

export function markEdit(timeStamp) {
  pending = typeof timeStamp === 'number' && timeStamp > 0 ? timeStamp : performance.now()
}

// Call after the preview committed (layout effect). Resolves with ms, or null if nothing pending.
export function measurePaint() {
  const t0 = pending
  pending = null
  if (t0 === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    // rAF runs just before this frame is painted; a message posted from it runs right after.
    requestAnimationFrame(() => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        const ms = performance.now() - t0
        const samples = (window.__tcgEditTimings = window.__tcgEditTimings || [])
        samples.push(ms)
        if (samples.length > 1000) samples.splice(0, samples.length - 1000)
        resolve(ms)
      }
      ch.port2.postMessage(0)
    })
  })
}
