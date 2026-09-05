import { describe, expect, it } from 'vitest'
import { BRAIN_TABS, INTELLIGENCE_TABS, INTELLIGENCE_SOURCES } from './brainUi'

describe('Brain UI registry', () => {
  it('keeps Brain and Intelligence as separate complete surfaces', () => {
    expect(BRAIN_TABS).toEqual(['Overview', 'Ask Brain', 'Memories', 'Review Inbox', 'People & Organizations', 'Decisions & Goals', 'Opportunities', 'Timeline', 'Graph', 'Jobs', 'Vault', 'Settings'])
    expect(INTELLIGENCE_TABS).toEqual(['Overview', 'Sources', 'Monitors', 'Pain Points', 'Trends', 'Opportunities', 'Decision Briefs'])
  })

  it('does not pretend the Reddit connector is live', () => {
    expect(INTELLIGENCE_SOURCES.find(source => source.id === 'reddit')).toMatchObject({ status: 'not_connected', liveCapture: false })
  })
})
