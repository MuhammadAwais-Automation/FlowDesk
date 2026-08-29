import { createServer, type Server } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk'
import { createAgentToolSet, type ProjectToolRuntime } from './tools'
import { AGENT_SYSTEM_PROMPT, agentFailureMessage, type AgentStreamEvent, type AgentTurnOptions } from './leadAgent'
import { getCodexExecutablePath } from '../codexExecutable'
import { alwaysApprove, type RequestApproval } from './approval'

let codexModule: typeof import('@openai/codex-sdk') | undefined

async function getCodexModule() {
  if (!codexModule) codexModule = await import('@openai/codex-sdk')
  return codexModule
}

export interface CodexEventState {
  finalText: string
  itemText: Map<string, string>
  toolProviders: Map<string, string>
}

function providerId(tool: string): string {
  if (tool.startsWith('ask_')) return tool.slice('ask_'.length)
  if (tool.startsWith('notebooklm_')) return 'notebooklm'
  if (tool.startsWith('project_')) return tool
  return tool
}

function promptFromArguments(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const prompt = (value as { prompt?: unknown }).prompt
  return typeof prompt === 'string' ? prompt : ''
}

function textFromMcpResult(item: Extract<ThreadItem, { type: 'mcp_tool_call' }>): string {
  if (item.error?.message) return item.error.message
  const content = item.result?.content ?? []
  return content.map(block => {
    if (block && typeof block === 'object' && 'text' in block) return String(block.text ?? '')
    return ''
  }).join('')
}

function textDelta(state: CodexEventState, id: string, text: string): string {
  const previous = state.itemText.get(id) ?? ''
  state.itemText.set(id, text)
  if (!text) return ''
  return text.startsWith(previous) ? text.slice(previous.length) : text
}

export function codexEvents(event: ThreadEvent, state: CodexEventState): AgentStreamEvent[] {
  const started = event as { type?: string; thread_id?: string }
  if (started.type === 'thread.started' && typeof started.thread_id === 'string') {
    return [{ type: 'provider_session', provider: 'codex', id: started.thread_id }]
  }
  if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
    const item = event.item
    if (item.type === 'agent_message') {
      const delta = textDelta(state, item.id, item.text)
      if (event.type === 'item.completed') state.finalText = item.text
      return delta ? [{ type: 'text', text: delta }] : []
    }
    if (item.type === 'mcp_tool_call') {
      const tool = providerId(item.tool)
      state.toolProviders.set(item.id, tool)
      if (event.type === 'item.started') {
        return [{ type: 'tool_call', toolUseId: item.id, tool, prompt: promptFromArguments(item.arguments) }]
      }
      if (event.type === 'item.completed') {
        return [{
          type: 'tool_result',
          toolUseId: item.id,
          tool: state.toolProviders.get(item.id) ?? tool,
          text: textFromMcpResult(item),
          isError: item.status === 'failed' || Boolean(item.error),
        }]
      }
    }
    return []
  }
  if (event.type === 'turn.completed') return [{ type: 'done', text: state.finalText }]
  if (event.type === 'turn.failed') return [{ type: 'error', message: agentFailureMessage(new Error(event.error.message)) }]
  if (event.type === 'error') return [{ type: 'error', message: agentFailureMessage(new Error(event.message)) }]
  return []
}

interface LocalMcpBridge {
  url: string
  close: () => Promise<void>
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise(resolveClose => server.close(() => resolveClose()))
}

export async function startLocalMcpBridge(projectRuntime?: ProjectToolRuntime, requestApproval: RequestApproval = alwaysApprove): Promise<LocalMcpBridge> {
  const toolSet = createAgentToolSet(projectRuntime, requestApproval)
  // Codex sends initialize, notifications/initialized, and tool requests as
  // separate HTTP calls. MCP SDK stateless transports are single-request only,
  // so this per-run bridge must keep one stateful session across those calls.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  await toolSet.server.instance.connect(transport)

  const route = `/mcp/${randomUUID()}`
  const server = createServer((request, response) => {
    if (request.url !== route || !['GET', 'POST', 'DELETE'].includes(request.method ?? '')) {
      response.writeHead(404).end()
      return
    }
    void transport.handleRequest(request, response).catch(error => {
      console.error('[FlowDesk agent:codex] MCP bridge request failed', error)
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('Could not bind the local Codex MCP bridge.'))
      else resolvePort(address.port)
    })
  })

  return {
    url: `http://127.0.0.1:${port}${route}`,
    close: async () => {
      await closeHttpServer(server)
      await transport.close()
    },
  }
}

/**
 * Why bypass gates Codex's own built-in tools (shell exec, apply_patch)
 * rather than a per-action prompt gating them like Claude's canUseTool does:
 * @openai/codex-sdk's ApprovalMode is a policy string fixed at thread start
 * ('never' | 'on-request' | 'on-failure' | 'untrusted') with no callback the
 * host can answer when Codex actually wants to ask — confirmed against the
 * SDK's own type definitions, which declare no approval-request event or
 * hook at all. So "ask before every risky Codex action" is not something
 * this SDK can do; the only real choice is off (sandboxed, read-only) or on
 * (workspace-write, never prompted because there is nothing to prompt with).
 * The workers MCP tools are unaffected either way — those gate themselves
 * via requestApproval from inside their own handlers, independent of Codex.
 */
function codexInstructions(bypassPermissions: boolean): string {
  const toolsNote = bypassPermissions
    ? 'Bypass permissions is ON: your built-in shell and file-editing tools are enabled, unsandboxed, and run without asking — use them directly for general file/shell work.'
    : 'Bypass permissions is OFF: your built-in shell and file-editing tools are disabled for this run (FlowDesk has no way to ask you for confirmation before each use). Do all file and command work through the workers MCP tools instead — NotebookLM, WhatsApp, and project actions, which each show the user a real approval dialog before anything risky happens.'
  return `${AGENT_SYSTEM_PROMPT}\n\nYou are running as the Codex lead-agent provider. ${toolsNote}`
}

export async function* runCodexAgentTurn(
  promptText: string,
  abortController: AbortController,
  projectRuntime?: ProjectToolRuntime,
  requestApproval: RequestApproval = alwaysApprove,
  bypassPermissions = false,
  options: AgentTurnOptions = {},
): AsyncGenerator<AgentStreamEvent> {
  console.log(`[FlowDesk agent:codex] starting, promptLength=${promptText.length}`)
  let bridge: LocalMcpBridge | undefined
  try {
    bridge = await startLocalMcpBridge(projectRuntime, requestApproval)
    const { Codex } = await getCodexModule()
    const runtimeDirectory = projectRuntime?.rootPath ?? join(tmpdir(), 'flowdesk-codex-runtime')
    await mkdir(runtimeDirectory, { recursive: true })
    const codexPathOverride = getCodexExecutablePath()
    const codex = new Codex({
      ...(codexPathOverride ? { codexPathOverride } : {}),
      config: {
        mcp_servers: {
          workers: {
            url: bridge.url,
            required: true,
          },
        },
      },
    })
    const threadOptions = {
      workingDirectory: runtimeDirectory,
      skipGitRepoCheck: true,
      sandboxMode: bypassPermissions ? ('workspace-write' as const) : ('read-only' as const),
      // 'never' either way: off means the sandbox itself blocks writes, so
      // there is nothing to approve; on means the user already said don't ask.
      approvalPolicy: 'never' as const,
      networkAccessEnabled: bypassPermissions,
      webSearchMode: bypassPermissions ? ('live' as const) : ('disabled' as const),
    }
    // A resume id that Codex no longer recognises is a normal state, not an
    // error: its thread store is outside FlowDesk and can be cleaned up
    // independently. Falling back to a fresh thread means the caller's
    // catch-up text reseeds it on this same turn.
    const thread = options.resumeSessionId
      ? codex.resumeThread(options.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions)
    const state: CodexEventState = {
      finalText: '',
      itemText: new Map(),
      toolProviders: new Map(),
    }
    const { events } = await thread.runStreamed(
      `${codexInstructions(bypassPermissions)}\n\nUser request:\n${promptText}`,
      { signal: abortController.signal },
    )
    for await (const event of events) {
      for (const translated of codexEvents(event, state)) yield translated
    }
  } catch (error) {
    const message = abortController.signal.aborted
      ? 'Agent run cancelled.'
      : agentFailureMessage(error)
    yield { type: 'error', message }
  } finally {
    await bridge?.close().catch(() => {})
  }
}
