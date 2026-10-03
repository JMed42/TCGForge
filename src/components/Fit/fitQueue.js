// Fit measurements asked for directly (the Designer's worst case): FitRunner measures these
// before its background work, a few at a time, with the same renderer and scale.
//
//   measureFits([{ key, card, template }], { onProgress, signal }) -> Promise<{ [key]: fits }>

const requests = []
const listeners = new Set()

export function measureFits(items, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!items.length) { resolve({}); return }
    const req = { items: [...items], next: 0, done: 0, results: {}, onProgress, resolve, reject }
    signal?.addEventListener('abort', () => {
      const i = requests.indexOf(req)
      if (i >= 0) requests.splice(i, 1)
      reject(new DOMException('Cancelled', 'AbortError'))
    }, { once: true })
    requests.push(req)
    for (const l of listeners) l()
  })
}

/** Up to `max` items not handed out yet, oldest request first: [{ req, item }] */
export function takeRequested(max) {
  const out = []
  for (const req of requests) {
    while (req.next < req.items.length && out.length < max) out.push({ req, item: req.items[req.next++] })
    if (out.length >= max) break
  }
  return out
}

export function hasRequested() {
  return requests.some((r) => r.next < r.items.length)
}

/** One measured item; resolves its request when it was the last one. */
export function deliver(req, key, fits) {
  if (!requests.includes(req) || key in req.results) return
  req.results[key] = fits
  req.done++
  req.onProgress?.(req.done, req.items.length)
  if (req.done >= req.items.length) {
    requests.splice(requests.indexOf(req), 1)
    req.resolve(req.results)
  }
}

export function onRequested(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
