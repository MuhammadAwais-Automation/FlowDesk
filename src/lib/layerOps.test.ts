import { describe, it, expect } from 'vitest'
import {
  moveUp,
  moveDown,
  moveToFront,
  moveToBack,
  reorder,
  isLayerCommand,
  type LayerCommand,
} from './layerOps'

// Front/back convention under test: index 0 = back-most, last index = front-most.

describe('moveUp', () => {
  it('swaps the id with its neighbour towards the front (end of array)', () => {
    expect(moveUp(['a', 'b', 'c'], 'a')).toEqual(['b', 'a', 'c'])
  })
  it('is a no-op on the last (front-most) item and returns the same reference', () => {
    const ids = ['a', 'b', 'c']
    expect(moveUp(ids, 'c')).toBe(ids)
  })
  it('is a no-op for an id not in the list', () => {
    const ids = ['a', 'b', 'c']
    expect(moveUp(ids, 'z')).toBe(ids)
  })
  it('does not mutate the input', () => {
    const ids = ['a', 'b', 'c']
    moveUp(ids, 'a')
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('moveDown', () => {
  it('swaps the id with its neighbour towards the back (start of array)', () => {
    expect(moveDown(['a', 'b', 'c'], 'c')).toEqual(['a', 'c', 'b'])
  })
  it('is a no-op on the first (back-most) item and returns the same reference', () => {
    const ids = ['a', 'b', 'c']
    expect(moveDown(ids, 'a')).toBe(ids)
  })
  it('is a no-op for an id not in the list', () => {
    const ids = ['a', 'b', 'c']
    expect(moveDown(ids, 'z')).toBe(ids)
  })
  it('does not mutate the input', () => {
    const ids = ['a', 'b', 'c']
    moveDown(ids, 'c')
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('moveToFront', () => {
  it('moves the id to the end of the array', () => {
    expect(moveToFront(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })
  it('is a no-op when already front-most and returns the same reference', () => {
    const ids = ['a', 'b', 'c']
    expect(moveToFront(ids, 'c')).toBe(ids)
  })
  it('is a no-op for an id not in the list', () => {
    const ids = ['a', 'b', 'c']
    expect(moveToFront(ids, 'z')).toBe(ids)
  })
})

describe('moveToBack', () => {
  it('moves the id to the start of the array', () => {
    expect(moveToBack(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when already back-most and returns the same reference', () => {
    const ids = ['a', 'b', 'c']
    expect(moveToBack(ids, 'a')).toBe(ids)
  })
  it('is a no-op for an id not in the list', () => {
    const ids = ['a', 'b', 'c']
    expect(moveToBack(ids, 'z')).toBe(ids)
  })
})

describe('reorder', () => {
  it('moves the item at `from` to index `to`, shifting the rest', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('moves an item backwards too', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('is a no-op when from === to and returns the same reference', () => {
    const ids = ['a', 'b', 'c']
    expect(reorder(ids, 1, 1)).toBe(ids)
  })
  it('is a no-op for a negative index', () => {
    const ids = ['a', 'b', 'c']
    expect(reorder(ids, -1, 1)).toBe(ids)
  })
  it('is a no-op for an out-of-range `from`', () => {
    const ids = ['a', 'b', 'c']
    expect(reorder(ids, 5, 1)).toBe(ids)
  })
  it('is a no-op for an out-of-range `to`', () => {
    const ids = ['a', 'b', 'c']
    expect(reorder(ids, 0, 5)).toBe(ids)
  })
  it('does not mutate the input', () => {
    const ids = ['a', 'b', 'c', 'd']
    reorder(ids, 0, 2)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('isLayerCommand', () => {
  const valid: LayerCommand[] = [
    { cmd: 'reorder', elementId: 'a', beforeId: 'b' },
    { cmd: 'reorder', elementId: 'a', beforeId: null },
    { cmd: 'group', elementIds: ['a', 'b'] },
    { cmd: 'ungroup', elementId: 'a' },
    { cmd: 'setHidden', elementId: 'a', hidden: true },
    { cmd: 'setLocked', elementId: 'a', locked: false },
    { cmd: 'rename', elementId: 'a', name: 'Layer 1' },
    { cmd: 'delete', elementId: 'a' },
    { cmd: 'duplicate', elementId: 'a' },
  ]

  it.each(valid)('accepts a well-formed $cmd command', (cmd) => {
    expect(isLayerCommand(cmd)).toBe(true)
  })

  it('rejects null', () => {
    expect(isLayerCommand(null)).toBe(false)
  })

  it('rejects a non-object', () => {
    expect(isLayerCommand('reorder')).toBe(false)
    expect(isLayerCommand(42)).toBe(false)
  })

  it('rejects an unknown cmd', () => {
    expect(isLayerCommand({ cmd: 'teleport', elementId: 'a' })).toBe(false)
  })

  it('rejects a reorder missing elementId', () => {
    expect(isLayerCommand({ cmd: 'reorder', beforeId: null })).toBe(false)
  })

  it('rejects a reorder with a non-string, non-null beforeId', () => {
    expect(isLayerCommand({ cmd: 'reorder', elementId: 'a', beforeId: 5 })).toBe(false)
  })

  it('rejects a group with a non-array elementIds', () => {
    expect(isLayerCommand({ cmd: 'group', elementIds: 'a' })).toBe(false)
  })

  it('rejects a group with a non-string entry in elementIds', () => {
    expect(isLayerCommand({ cmd: 'group', elementIds: ['a', 1] })).toBe(false)
  })

  it('rejects a setHidden missing hidden', () => {
    expect(isLayerCommand({ cmd: 'setHidden', elementId: 'a' })).toBe(false)
  })

  it('rejects a setLocked with a non-boolean locked', () => {
    expect(isLayerCommand({ cmd: 'setLocked', elementId: 'a', locked: 'yes' })).toBe(false)
  })

  it('rejects a rename missing name', () => {
    expect(isLayerCommand({ cmd: 'rename', elementId: 'a' })).toBe(false)
  })

  it('rejects a delete missing elementId', () => {
    expect(isLayerCommand({ cmd: 'delete' })).toBe(false)
  })

  it('rejects a duplicate missing elementId', () => {
    expect(isLayerCommand({ cmd: 'duplicate' })).toBe(false)
  })
})
