import { describe, expect, it, vi } from 'vitest'
import { BRAIN_TOOL_NAMES, configureBrainTools, createBrainTools } from './brainTools'

interface TestTool {
  name: string
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>
}

function getTool(name: string, approval = vi.fn(async () => true)) {
  const tool = (createBrainTools(approval) as unknown as TestTool[]).find(item => item.name === name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  return { tool, approval }
}

describe('Brain agent tools', () => {
  it('publishes the complete narrow tool contract', () => {
    expect(BRAIN_TOOL_NAMES).toEqual([
      'mcp__workers__brain_answer_pack',
      'mcp__workers__brain_search',
      'mcp__workers__brain_read_document',
      'mcp__workers__brain_search_documents',
      'mcp__workers__brain_remember',
      'mcp__workers__brain_forget',
      'mcp__workers__brain_explain_source',
      'mcp__workers__brain_list_candidates',
      'mcp__workers__brain_review_candidate',
      'mcp__workers__brain_run_recipe',
      'mcp__workers__brain_job',
      'mcp__workers__brain_open_artifact',
      'mcp__workers__brain_build_decision_brief',
      'mcp__workers__brain_review_opportunity',
    ])
  })

  it('returns answer-pack evidence as plain prose with the paths to cite', async () => {
    const request = vi.fn(async () => ({
      question: 'yasir ka rate',
      evidence: ['wiki/clients/yasir.md#Yasir > Rates', 'PKR 40,000 monthly.'].join('\n'),
      sections: [{ path: 'wiki/clients/yasir.md', headingPath: 'Yasir > Rates' }],
      pointerFollowed: null,
      strategy: 'strong-signal',
      estimatedTokens: 18,
      candidatesConsidered: 3,
    }))
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => true })

    const output = (await getTool('brain_answer_pack').tool.handler({ question: 'yasir ka rate' })).content[0].text

    expect(request).toHaveBeenCalledWith('knowledge.answerPack', { scopeId: 'client-a', question: 'yasir ka rate' })
    // Prose, not JSON: the model reads this directly.
    expect(output).toContain('PKR 40,000 monthly.')
    expect(output).toContain('Cite these paths')
    expect(() => JSON.parse(output)).toThrow()
  })

  it('reports the brain as unavailable rather than throwing when there is no scope', async () => {
    configureBrainTools({ request: vi.fn(async () => null), getScopeId: () => null, allowWrites: () => true })

    const output = (await getTool('brain_answer_pack').tool.handler({ question: 'anything' })).content[0].text

    expect(output).toMatch(/unavailable/i)
  })

  it('binds document navigation to the active scope', async () => {
    const request = vi.fn(async (method: string) => method === 'knowledge.read'
      ? {
          path: 'wiki/client.md', title: 'Client', type: 'client', text: 'Scope-safe body.',
          updatedAt: '2026-09-13T00:00:00.000Z', estimatedTokens: 4, truncated: false,
        }
      : [])
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => true })

    const readOutput = JSON.parse((await getTool('brain_read_document').tool.handler({ path: 'wiki/client.md' })).content[0].text)
    const searchOutput = JSON.parse((await getTool('brain_search_documents').tool.handler({ query: 'client', limit: 4 })).content[0].text)

    expect(readOutput).toContain('Scope-safe body.')
    expect(searchOutput).toMatch(/no matches/i)
    expect(request).toHaveBeenNthCalledWith(1, 'knowledge.read', {
      scopeId: 'client-a', path: 'wiki/client.md', tokenBudget: 4000,
    })
    expect(request).toHaveBeenNthCalledWith(2, 'knowledge.search', {
      scopeId: 'client-a', query: 'client', limit: 4,
    })
  })

  it('uses the typed decision brief endpoint instead of generic memory search', async () => {
    const request = vi.fn(async () => ({ recommendation: 'Cited result' }))
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => true })
    await getTool('brain_build_decision_brief').tool.handler({ question: 'Should we proceed?' })
    expect(request).toHaveBeenCalledWith('buildDecisionBrief', { question: 'Should we proceed?', scopeId: 'client-a', tokenBudget: 1200 })
    expect(request).not.toHaveBeenCalledWith('search', expect.anything())
  })

  it('brain_remember proposes an explicit-user knowledge candidate, not a legacy memory write', async () => {
    const request = vi.fn(async () => ({ kind: 'written' }))
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => true })

    await getTool('brain_remember').tool.handler({
      kind: 'fact', text: 'Yasir bhai prefers WhatsApp updates.', subject: 'Yasir Bhai', predicate: 'prefers_channel',
    })

    expect(request).toHaveBeenCalledWith('knowledge.proposeCandidate', {
      scopeId: 'client-a',
      type: 'note',
      title: 'Yasir bhai prefers WhatsApp updates.',
      summary: '',
      body: 'Subject: Yasir Bhai\nPredicate: prefers_channel\n\nYasir bhai prefers WhatsApp updates.',
      origin: 'explicit-user',
      sessionRef: expect.stringMatching(/^agent-tool:\/\/brain_remember\/\d+$/),
    })
    expect(request).not.toHaveBeenCalledWith('remember', expect.anything())
  })

  it('brain_remember refuses when Brain learning is disabled for the turn', async () => {
    const request = vi.fn()
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => false })

    await expect(getTool('brain_remember').tool.handler({ kind: 'fact', text: 'Should not be saved.' }))
      .rejects.toThrow('Brain learning is disabled for this Agent turn')
    expect(request).not.toHaveBeenCalled()
  })

  it('requires real approval before reviewing an opportunity', async () => {
    const request = vi.fn(async () => ({ status: 'qualified' }))
    configureBrainTools({ request, getScopeId: () => 'client-a', allowWrites: () => true })
    const denied = getTool('brain_review_opportunity', vi.fn(async () => false))
    expect(JSON.parse((await denied.tool.handler({ id: 'opportunity-a', decision: 'qualify' })).content[0].text)).toEqual({ cancelled: true })
    expect(request).not.toHaveBeenCalled()
    const approved = getTool('brain_review_opportunity')
    await approved.tool.handler({ id: 'opportunity-a', decision: 'qualify' })
    expect(approved.approval).toHaveBeenCalledWith(expect.objectContaining({ tool: 'brain_review_opportunity', detail: 'opportunity-a · qualify' }))
    expect(request).toHaveBeenCalledWith('reviewOpportunity', { id: 'opportunity-a', decision: 'qualify', scopeId: 'client-a' })
  })
})
