import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '@openai/codex-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { codexEvents, startLocalMcpBridge, type CodexEventState } from './codexLeadAgent'

function state(): CodexEventState {
  return { finalText: '', itemText: new Map(), toolProviders: new Map() }
}

describe('codexEvents', () => {
  it('maps streamed agent-message snapshots into non-duplicated text and done events', () => {
    const current = state()
    expect(codexEvents({
      type: 'item.updated',
      item: { id: 'answer', type: 'agent_message', text: 'Hel' },
    } as ThreadEvent, current)).toEqual([{ type: 'text', text: 'Hel' }])
    expect(codexEvents({
      type: 'item.completed',
      item: { id: 'answer', type: 'agent_message', text: 'Hello' },
    } as ThreadEvent, current)).toEqual([{ type: 'text', text: 'lo' }])
    expect(codexEvents({
      type: 'turn.completed',
      usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
    } as ThreadEvent, current)).toEqual([{ type: 'done', text: 'Hello' }])
  })

  it('maps Codex MCP lifecycle items onto the existing FlowDesk worker-card contract', () => {
    const current = state()
    expect(codexEvents({
      type: 'item.started',
      item: {
        id: 'call-1', type: 'mcp_tool_call', server: 'workers', tool: 'ask_chatgpt',
        arguments: { prompt: 'Check this' }, status: 'in_progress',
      },
    } as ThreadEvent, current)).toEqual([{
      type: 'tool_call', toolUseId: 'call-1', tool: 'chatgpt', prompt: 'Check this',
    }])
    expect(codexEvents({
      type: 'item.completed',
      item: {
        id: 'call-1', type: 'mcp_tool_call', server: 'workers', tool: 'ask_chatgpt',
        arguments: { prompt: 'Check this' }, status: 'completed',
        result: { content: [{ type: 'text', text: 'Checked' }], structured_content: null },
      },
    } as ThreadEvent, current)).toEqual([{
      type: 'tool_result', toolUseId: 'call-1', tool: 'chatgpt', text: 'Checked', isError: false,
    }])
  })

  it('keeps the MCP session alive after initialize for subsequent Codex requests', async () => {
    const bridge = await startLocalMcpBridge()
    const client = new Client({ name: 'flowdesk-codex-test', version: '1.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url)))
      const tools = await client.listTools()
      expect(tools.tools.some(tool => tool.name === 'ask_chatgpt')).toBe(true)
    } finally {
      await client.close().catch(() => {})
      await bridge.close()
    }
  })
})
