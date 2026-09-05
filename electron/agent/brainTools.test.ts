import { describe, expect, it } from 'vitest'
import { BRAIN_TOOL_NAMES } from './brainTools'

describe('Brain agent tools', () => {
  it('publishes the complete narrow tool contract', () => {
    expect(BRAIN_TOOL_NAMES).toEqual([
      'mcp__workers__brain_search',
      'mcp__workers__brain_remember',
      'mcp__workers__brain_forget',
      'mcp__workers__brain_explain_source',
      'mcp__workers__brain_list_candidates',
      'mcp__workers__brain_review_candidate',
      'mcp__workers__brain_run_recipe',
      'mcp__workers__brain_job',
      'mcp__workers__brain_open_artifact',
      'mcp__workers__brain_build_decision_brief',
    ])
  })
})
