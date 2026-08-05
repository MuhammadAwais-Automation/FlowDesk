import type { query as queryFn, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AGENT_MCP_SERVER, AGENT_TOOL_NAMES } from './tools'

// Own dynamic-import loader, independent of claudeSdkProvider.ts — that file
// stays a small, untouched one-shot helper (tools: [], maxTurns: 1); this
// feature needs a fundamentally different shape (streaming generator of UI
// events, tools enabled, maxTurns > 1), so duplicating the ~10-line ESM
// workaround is cheaper than overloading one file with a mode flag.
let queryImpl: typeof queryFn | undefined
async function getQuery(): Promise<typeof queryFn> {
  if (!queryImpl) {
    const mod = await import('@anthropic-ai/claude-agent-sdk')
    queryImpl = mod.query
  }
  return queryImpl
}
void getQuery()

const AGENT_SYSTEM_PROMPT = `You are the lead agent inside FlowDesk's "Agent" section. You can call up to
five worker tools, each of which asks a different AI provider (through the
user's own logged-in browser session — no API keys involved) and returns
its reply:

- ask_chatgpt: OpenAI's ChatGPT — general reasoning, coding, broad knowledge.
- ask_claude: a SEPARATE, independent browser session of Claude (claude.ai)
  — not you, a distinct instance, useful for a second opinion.
- ask_gemini: Google's Gemini — Google-ecosystem context.
- ask_grok: xAI's Grok — real-time/current-events framing.
- ask_perplexity: Perplexity — web research, up-to-date sourced answers.

Decide for yourself which tool(s), if any, are worth calling based on the
user's message. You may call several in the same turn if it's useful (e.g.
comparing two providers' answers). If the user explicitly names a provider
("ask Perplexity about X", "what does ChatGPT think"), always respect that
and call exactly that tool rather than deciding on your own. If none of the
five would add anything, just answer directly — you don't have to use a
tool every turn. When you do use tools, synthesize their replies into your
own final answer rather than just repeating them verbatim.`

async function* singleUserMessage(userText: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: userText }] }
  }
}

const TOOL_NAME_PREFIX = 'mcp__workers__ask_'

/** `mcp__workers__ask_chatgpt` -> `chatgpt` — the plain provider id the UI keys its status map by. */
function toProviderId(mcpToolName: string): string {
  return mcpToolName.startsWith(TOOL_NAME_PREFIX) ? mcpToolName.slice(TOOL_NAME_PREFIX.length) : mcpToolName
}

export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolUseId: string; tool: string; prompt: string }
  | { type: 'tool_progress'; toolUseId: string; tool: string; elapsedSeconds: number }
  | { type: 'tool_result'; toolUseId: string; tool: string; text: string; isError: boolean }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

/**
 * Runs one full lead-agent turn (which may internally call several worker
 * tools before producing a final answer) and yields UI-facing events as
 * they happen. Each call is an independent, ephemeral query() — no SDK
 * session resume — continuity across turns is handled by the caller
 * prepending a text recap to `promptText` (see src/lib/agentSession.ts),
 * same proven pattern as claudeSdkProvider.ts / the sibling ai-companion
 * project.
 */
export async function* runAgentTurn(promptText: string, abortController: AbortController): AsyncGenerator<AgentStreamEvent> {
  console.log(`[FlowDesk agent] runAgentTurn starting, promptLength=${promptText.length}`)
  const query = await getQuery()
  console.log('[FlowDesk agent] query() resolved, starting iteration')

  // Tracks which provider a tool_use_id belongs to, so tool_progress/
  // tool_result events (which only carry the id) can be reported against
  // the right provider in the UI.
  const toolProviderById = new Map<string, string>()

  try {
    for await (const message of query({
      prompt: singleUserMessage(promptText),
      options: {
        tools: [],
        mcpServers: { workers: AGENT_MCP_SERVER },
        allowedTools: AGENT_TOOL_NAMES,
        // Without this, the SDK merges in every MCP server configured
        // system-wide for the local `claude` CLI (project .mcp.json, user
        // settings, plugins) — confirmed via a real run: asked "how many
        // tools do you have" and the lead agent listed the user's own
        // Ahrefs/Supabase/Vercel/SSH-manager/Context7/etc business tools
        // alongside the 5 worker tools. permissionMode: 'dontAsk' correctly
        // blocked an actual call to one of them, but the lead agent still
        // knew they existed — a real scope leak, not just a denied action.
        // strictMcpConfig restricts it to exactly the `mcpServers` passed
        // here.
        strictMcpConfig: true,
        permissionMode: 'dontAsk',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: AGENT_SYSTEM_PROMPT },
        maxTurns: 8,
        persistSession: false,
        abortController
      }
    })) {
      console.log(`[FlowDesk agent] message type=${message.type}${'subtype' in message && message.subtype ? ' subtype=' + message.subtype : ''}`)
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            yield { type: 'text', text: block.text }
          } else if (block.type === 'tool_use') {
            const provider = toProviderId(block.name)
            toolProviderById.set(block.id, provider)
            const input = block.input as { prompt?: unknown } | undefined
            const prompt = typeof input?.prompt === 'string' ? input.prompt : ''
            yield { type: 'tool_call', toolUseId: block.id, tool: provider, prompt }
          }
        }
      } else if (message.type === 'tool_progress') {
        const provider = toolProviderById.get(message.tool_use_id) ?? toProviderId(message.tool_name)
        yield { type: 'tool_progress', toolUseId: message.tool_use_id, tool: provider, elapsedSeconds: message.elapsed_time_seconds }
      } else if (message.type === 'user') {
        const content = Array.isArray(message.message.content) ? message.message.content : []
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
            const toolUseId = String((block as { tool_use_id?: string }).tool_use_id ?? '')
            const provider = toolProviderById.get(toolUseId) ?? 'unknown'
            const isError = Boolean((block as { is_error?: boolean }).is_error)
            const rawContent = (block as { content?: unknown }).content
            const text = Array.isArray(rawContent)
              ? rawContent.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text?: unknown }).text ?? '') : '')).join('')
              : typeof rawContent === 'string' ? rawContent : ''
            yield { type: 'tool_result', toolUseId, tool: provider, text, isError }
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          yield { type: 'done', text: message.result }
        } else {
          yield { type: 'error', message: message.errors?.join('; ') || `Agent turn failed: ${message.subtype}` }
        }
      }
    }
    console.log('[FlowDesk agent] query() iteration finished (stream ended)')
  } catch (err) {
    console.log(`[FlowDesk agent] query() threw: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
