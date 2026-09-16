/**
 * What the Brain page's detail pane is currently showing.
 *
 * Three kinds, because three kinds of thing can be selected, and they navigate
 * into each other: a turn names the documents it read, a document names the
 * turns that read it, an answer names the documents it quoted. The history is
 * what stops that navigation from being one-way -- without it, clicking a
 * document chip inside a turn loses the turn.
 */
export type Selection =
  | { kind: 'document'; path: string }
  | { kind: 'turn'; eventId: string }
  | { kind: 'answer'; question: string }

export interface SelectionStack {
  current: Selection | null
  history: Selection[]
}

export const EMPTY_SELECTION: SelectionStack = { current: null, history: [] }

/** True when both name the same thing, treating two nulls as equal. */
export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'document') return b.kind === 'document' && a.path === b.path
  if (a.kind === 'turn') return b.kind === 'turn' && a.eventId === b.eventId
  return b.kind === 'answer' && a.question === b.question
}

/**
 * Selects `next`, remembering what was showing.
 *
 * Re-selecting what is already open is a no-op rather than a history entry, so
 * clicking the same row twice does not require two presses of back.
 */
export function pushSelection(stack: SelectionStack, next: Selection): SelectionStack {
  if (sameSelection(stack.current, next)) return stack
  return {
    current: next,
    history: stack.current === null ? stack.history : [...stack.history, stack.current],
  }
}

/** Goes back one step; an empty history clears the pane. */
export function popSelection(stack: SelectionStack): SelectionStack {
  const previous = stack.history[stack.history.length - 1]
  if (previous === undefined) return EMPTY_SELECTION
  return { current: previous, history: stack.history.slice(0, -1) }
}
