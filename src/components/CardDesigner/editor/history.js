// Snapshot undo/redo for the template draft. Templates are small JSON objects and every edit
// produces a new object (no mutation), so snapshots are just references.
//
// Coalescing: edits that pass the same `key` within COALESCE_MS of each other (typing in one
// inspector field, nudging with the arrow keys) share a single undo step. Drags push once at
// pointer-down via a key-less push.

export const HISTORY_LIMIT = 200
export const COALESCE_MS = 500

export function createHistory() {
  return { past: [], future: [], lastKey: null, lastAt: 0 }
}

// Record `snapshot` (the state *before* an edit). Returns the new history.
export function pushHistory(history, snapshot, { key = null, now = Date.now() } = {}) {
  if (key && key === history.lastKey && now - history.lastAt < COALESCE_MS) {
    return { ...history, lastAt: now }
  }
  const past = [...history.past, snapshot]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, future: [], lastKey: key, lastAt: now }
}

// Returns { history, snapshot } or null when there is nothing to undo.
export function undoHistory(history, current) {
  if (history.past.length === 0) return null
  const snapshot = history.past[history.past.length - 1]
  return {
    snapshot,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future], lastKey: null, lastAt: 0 },
  }
}

export function redoHistory(history, current) {
  if (history.future.length === 0) return null
  const [snapshot, ...future] = history.future
  return {
    snapshot,
    history: { past: [...history.past, current], future, lastKey: null, lastAt: 0 },
  }
}
