import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, popSelection, pushSelection, sameSelection } from './brainSelection'

const doc = { kind: 'document', path: 'wiki/a.md' } as const
const turn = { kind: 'turn', eventId: 'event-1' } as const

describe('brainSelection', () => {
  it('starts empty', () => {
    expect(EMPTY_SELECTION).toEqual({ current: null, history: [] })
  })

  it('pushes onto an empty stack without recording history', () => {
    expect(pushSelection(EMPTY_SELECTION, doc)).toEqual({ current: doc, history: [] })
  })

  it('records the previous selection when pushing over one', () => {
    const stack = pushSelection(pushSelection(EMPTY_SELECTION, turn), doc)
    expect(stack).toEqual({ current: doc, history: [turn] })
  })

  it('does not grow the stack when the same thing is selected twice', () => {
    const once = pushSelection(EMPTY_SELECTION, doc)
    expect(pushSelection(once, { kind: 'document', path: 'wiki/a.md' })).toEqual(once)
  })

  it('pops back to the previous selection', () => {
    const stack = pushSelection(pushSelection(EMPTY_SELECTION, turn), doc)
    expect(popSelection(stack)).toEqual({ current: turn, history: [] })
  })

  it('popping an empty history clears the selection', () => {
    expect(popSelection(pushSelection(EMPTY_SELECTION, doc))).toEqual(EMPTY_SELECTION)
  })

  it('compares selections by kind and identity', () => {
    expect(sameSelection(doc, { kind: 'document', path: 'wiki/a.md' })).toBe(true)
    expect(sameSelection(doc, { kind: 'document', path: 'wiki/b.md' })).toBe(false)
    expect(sameSelection(doc, turn)).toBe(false)
    expect(sameSelection(null, null)).toBe(true)
    expect(sameSelection(null, doc)).toBe(false)
  })
})
