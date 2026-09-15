import { describe, expect, it } from 'vitest'
import type { BrainEvent } from '../../../src/types/brainKnowledge'
import { dailyNotePath, localDayBounds, localDayOf, renderDailyNote } from './dailyNote'

function event(overrides: Partial<BrainEvent> & Pick<BrainEvent, 'action'>): BrainEvent {
  return {
    id: 'e1',
    scopeId: 'scope-1',
    targetId: null,
    metadata: {},
    createdAt: '2026-09-15T09:30:00.000Z',
    ...overrides,
  }
}

describe('daily note', () => {
  it('derives the local calendar day, not the UTC one', () => {
    // A late-evening local instant must stay on its own day.
    const at = new Date(2026, 8, 15, 23, 30)
    expect(localDayOf(at.toISOString())).toBe('2026-09-15')
  })

  it('bounds a day half-open so midnight belongs to the next day', () => {
    const { from, to } = localDayBounds('2026-09-15')
    expect(localDayOf(from)).toBe('2026-09-15')
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(86_400_000)
  })

  it('names the document by date', () => {
    expect(dailyNotePath('2026-09-15')).toBe('daily/2026-09-15.md')
  })

  it('reports a day with no activity as empty', () => {
    expect(renderDailyNote('2026-09-15', []).isEmpty).toBe(true)
  })

  it('lists conversations with the documents each turn actually read', () => {
    const note = renderDailyNote('2026-09-15', [
      event({
        action: 'agent.turn',
        metadata: {
          prompt: 'Yasir ka retainer kitna hai?',
          documentsRead: ['wiki/clients/yasir-bhai.md'],
          inputTokens: 1200,
          outputTokens: 300,
          totalCostUsd: 0.0123,
        },
      }),
    ])

    expect(note.body).toContain('Yasir ka retainer kitna hai?')
    // Wiki-linked so the daily note joins the same link graph as everything else.
    expect(note.body).toContain('[[wiki/clients/yasir-bhai.md]]')
    expect(note.body).toContain('1,500 tokens')
    expect(note.body).toContain('$0.0123')
  })

  it('renders each kind of event under its own heading', () => {
    const note = renderDailyNote('2026-09-15', [
      event({ action: 'knowledge.accepted', metadata: { path: 'wiki/notes/a.md', title: 'A note' } }),
      event({ action: 'knowledge.imported', metadata: { imported: 156 } }),
      event({ action: 'knowledge.compacted', metadata: { merged: 3 } }),
      event({ action: 'job.completed', metadata: { recipeId: 'notebooklm.research', status: 'ready' } }),
    ])

    expect(note.body).toContain('## Added to the Library')
    expect(note.body).toContain('Imported 156 documents')
    expect(note.body).toContain('folded 3 captures')
    expect(note.body).toContain('notebooklm.research')
    // No conversations that day, so no cost section to render.
    expect(note.body).not.toContain('## Cost')
  })

  it('is byte-identical when re-rendered, so an unchanged day never rewrites the document', () => {
    const events = [event({ action: 'agent.turn', metadata: { prompt: 'same question' } })]
    expect(renderDailyNote('2026-09-15', events).body).toBe(renderDailyNote('2026-09-15', events).body)
  })

  it('collapses a multi-line prompt onto one line and truncates a long one', () => {
    const note = renderDailyNote('2026-09-15', [
      event({ action: 'agent.turn', metadata: { prompt: `line one\nline two ${'x'.repeat(300)}` } }),
    ])

    const promptLine = note.body.split('\n').find(line => line.includes('line one'))
    expect(promptLine).toBeDefined()
    expect(promptLine).toContain('line one line two')
    expect(promptLine!.length).toBeLessThan(180)
  })

  it('survives metadata of the wrong shape rather than rendering NaN or undefined', () => {
    const note = renderDailyNote('2026-09-15', [
      event({ action: 'agent.turn', metadata: { prompt: 42, documentsRead: 'not-an-array', inputTokens: null } }),
    ])

    expect(note.body).toContain('(no prompt recorded)')
    expect(note.body).not.toMatch(/NaN|undefined/)
  })
})
