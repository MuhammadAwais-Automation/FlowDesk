/**
 * Undo/redo for canvas edits, as snapshots of one artboard's inner HTML.
 *
 * Snapshots rather than inverse patches: artboard HTML is small, and a
 * snapshot cannot disagree with the document the way a computed inverse can
 * after a concurrent agent write.
 *
 * Agent edits are recorded here too. A user who nudges something, asks the
 * agent to restyle the section, then hits Ctrl+Z expects the agent's change
 * to come off first — one timeline, or undo is a trap.
 */

export interface EditEntry {
  artboardId: string
  /** Inner HTML before the edit — what undo restores. */
  before: string
  /** Inner HTML after the edit — what redo restores. */
  after: string
}

export interface History {
  past: EditEntry[]
  future: EditEntry[]
}

export function emptyHistory(): History {
  return { past: [], future: [] }
}

export function record(history: History, entry: EditEntry): History {
  return { past: [...history.past, entry], future: [] }
}

export function undo(history: History): { history: History; entry: EditEntry } | null {
  const entry = history.past[history.past.length - 1]
  if (!entry) return null
  return {
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
    entry,
  }
}

export function redo(history: History): { history: History; entry: EditEntry } | null {
  const entry = history.future[0]
  if (!entry) return null
  return {
    history: { past: [...history.past, entry], future: history.future.slice(1) },
    entry,
  }
}
