import { describe, expect, it } from 'vitest'
import { agentFailureMessage } from './leadAgent'
import { createAgentToolSet } from './tools'

describe('agentFailureMessage', () => {
  it('turns the SDK turn-budget error into a resumable checkpoint message', () => {
    expect(agentFailureMessage(new Error('Reached maximum number of turns (16)')))
      .toContain('continue from the completed work')
  })

  it('keeps unrelated failures intact for diagnostics', () => {
    expect(agentFailureMessage(new Error('Browser worker disconnected'))).toBe('Browser worker disconnected')
  })

  it('exports correct tool names for all worker, notebooklm, and whatsapp tools', () => {
    const toolSet = createAgentToolSet()
    console.log('Tool set names:', toolSet.names)
    expect(toolSet.names).toContain('mcp__workers__notebooklm_ask')
    expect(toolSet.names).toContain('mcp__workers__notebooklm_list_notebooks')
    expect(toolSet.names).toContain('mcp__workers__whatsapp_status')
    expect(toolSet.names).not.toContain('mcp__workers__undefined')
  })
})
