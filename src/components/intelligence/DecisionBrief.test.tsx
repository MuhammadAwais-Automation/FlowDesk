/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrainDecisionBrief } from '@/types/brain'
import { DecisionBrief } from './DecisionBrief'

function brief(sourceRef: string): BrainDecisionBrief {
  return {
    question: 'Should we pursue React work?',
    recommendation: 'Prioritize review of Needs React help; current cited signals are stronger than counter-signals.',
    supportingSignals: [{ text: 'Need React help', citation: { id: 'evidence-1', memoryId: 'lead-1', text: 'Need React help', kind: 'opportunity', scopeId: 'client-a', sourceRef, score: 0.7 } }],
    counterSignals: [], risks: [], nextActions: [], estimatedTokens: 90,
  }
}

afterEach(cleanup)

describe('DecisionBrief citation safety', () => {
  it('renders a hostile citation source as inert text', () => {
    render(<DecisionBrief brief={brief('javascript:window.electronAPI.brainImportBackup()')} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Source link unavailable')).toBeTruthy()
  })

  it('links an http(s) citation source', () => {
    render(<DecisionBrief brief={brief('https://example.test/lead')} />)
    expect(screen.getByRole('link', { name: 'Open source 1' }).getAttribute('href')).toBe('https://example.test/lead')
  })
})
