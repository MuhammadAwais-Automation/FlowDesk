import { describe, expect, it } from 'vitest'
import { changedSince, orphanPaths, overlayPaths, readInEvents } from './atlasOverlays'
import type { BrainEvent, KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

const node = (path: string, degree: number, updatedAt: string, type: KnowledgeDocType = 'note') => ({
  path, title: path, type, degree, updatedAt,
})

const STORE: KnowledgeGraph = {
  nodes: [
    node('old.md', 3, '2026-09-01T00:00:00.000Z'),
    node('fresh.md', 2, '2026-09-18T09:00:00.000Z'),
    node('alone.md', 0, '2026-09-02T00:00:00.000Z'),
  ],
  edges: [],
  unresolvedCount: 12,
}

const turn = (documentsRead: unknown): BrainEvent => ({
  id: 'e1', scopeId: 's', action: 'agent.turn', targetId: 't',
  metadata: { documentsRead }, createdAt: '2026-09-18T10:00:00.000Z',
})

describe('changedSince', () => {
  it('finds documents touched after the given moment', () => {
    expect([...changedSince(STORE, '2026-09-10T00:00:00.000Z')]).toEqual(['fresh.md'])
  })

  // A first visit has no previous one. Ringing all 163 documents says nothing,
  // so nothing is ringed.
  it('highlights nothing when there is no previous visit', () => {
    expect(changedSince(STORE, null).size).toBe(0)
  })

  it('ignores an unparseable timestamp rather than highlighting everything', () => {
    expect(changedSince(STORE, 'not a date').size).toBe(0)
  })
})

describe('readInEvents', () => {
  it('collects the documents the agent read, without repeats', () => {
    const events = [turn(['a.md', 'b.md']), turn(['b.md', 'c.md'])]
    expect([...readInEvents(events)].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  // A turn in temporary mode stores no documentsRead at all.
  it('skips a turn that recorded nothing', () => {
    expect(readInEvents([turn(undefined), turn('nope'), turn([1, null])]).size).toBe(0)
  })

  it('is empty for no events', () => {
    expect(readInEvents([]).size).toBe(0)
  })
})

describe('orphanPaths', () => {
  it('finds the documents nothing links to or from', () => {
    expect([...orphanPaths(STORE)]).toEqual(['alone.md'])
  })
})

describe('overlayPaths', () => {
  const input = { graph: STORE, since: '2026-09-10T00:00:00.000Z', events: [turn(['old.md'])] }

  it('routes each overlay to its own rule', () => {
    expect([...overlayPaths('new', input)]).toEqual(['fresh.md'])
    expect([...overlayPaths('trail', input)]).toEqual(['old.md'])
    expect([...overlayPaths('orphans', input)]).toEqual(['alone.md'])
  })
})
