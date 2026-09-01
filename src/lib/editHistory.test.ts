import { describe, expect, it } from 'vitest'
import { emptyHistory, record, undo, redo, type EditEntry } from './editHistory'

const A: EditEntry = { artboardId: 'a1', before: '<p>0</p>', after: '<p>1</p>' }
const B: EditEntry = { artboardId: 'a1', before: '<p>1</p>', after: '<p>2</p>' }

describe('editHistory', () => {
  it('has nothing to undo when empty', () => {
    expect(undo(emptyHistory())).toBeNull()
    expect(redo(emptyHistory())).toBeNull()
  })

  it('undoes the most recent edit first', () => {
    const history = record(record(emptyHistory(), A), B)
    const step = undo(history)
    expect(step?.entry).toEqual(B)
    expect(undo(step!.history)?.entry).toEqual(A)
  })

  it('redoes what was undone, in order', () => {
    const history = record(record(emptyHistory(), A), B)
    const undone = undo(history)!
    const step = redo(undone.history)
    expect(step?.entry).toEqual(B)
    expect(redo(step!.history)).toBeNull()
  })

  // Otherwise a redo after new work would resurrect an edit that no longer
  // has anything to apply to, silently reverting the user's newest change.
  it('drops the redo branch once a new edit is recorded', () => {
    const history = record(record(emptyHistory(), A), B)
    const undone = undo(history)!
    const next = record(undone.history, { artboardId: 'a1', before: '<p>1</p>', after: '<p>9</p>' })
    expect(redo(next)).toBeNull()
  })

  it('does not mutate the history it is given', () => {
    const history = record(emptyHistory(), A)
    const snapshot = JSON.stringify(history)
    undo(history)
    record(history, B)
    expect(JSON.stringify(history)).toBe(snapshot)
  })
})
