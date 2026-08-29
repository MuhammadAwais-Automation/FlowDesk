import type { query as queryFn, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

// The SDK ships ESM-only (sdk.mjs, no CJS build). electron-vite's main
// process build target is CJS, so a static `import` would compile to a
// `require()` of an ESM module and crash at runtime — load it lazily via
// dynamic import instead (same workaround used by the sibling ai-companion
// project's claudeProvider.ts, where this was already proven necessary).
let queryImpl: typeof queryFn | undefined
async function getQuery(): Promise<typeof queryFn> {
  if (!queryImpl) {
    const mod = await import('@anthropic-ai/claude-agent-sdk')
    queryImpl = mod.query
  }
  return queryImpl
}
// Pre-warm the dynamic import as soon as this module is loaded.
void getQuery()

async function* singleUserMessage(userText: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: userText }] }
  }
}

// The `claude_code` preset's default system prompt assumes an agentic coding
// session — without this override the model may reference tools it doesn't
// have here or answer as if mid-coding-session. Universal Chat is a plain
// text-in/text-out assistant, so this keeps it conversational.
const UNIVERSAL_CHAT_SYSTEM_PROMPT = `You are being used as a general-purpose chat assistant inside a desktop app
called Universal Chat. Reply directly and conversationally to the user's
message below. You have no tools and cannot access files, the shell, or the
internet — text in, text out only.`

import { getClaudeExecutablePath } from './claudeExecutable'

/**
 * Sends one plain-text turn to Claude via the local `claude` CLI's own
 * subscription login — never ANTHROPIC_API_KEY. Fresh, ephemeral call every
 * time (no persisted transcript, no session resume): Universal Chat already
 * owns its own conversation history via conversationContinuity.ts, so there
 * is no reason to also let the SDK write a parallel transcript to
 * ~/.claude/projects/.
 *
 * Throws on failure (CLI missing, not logged in, no result) — the caller
 * (electron/main.ts) converts that into a capture:complete error event.
 */
export async function askClaudeSdk(prompt: string): Promise<string> {
  const query = await getQuery()
  let finalText = ''
  const binaryPath = getClaudeExecutablePath()

  for await (const message of query({
    prompt: singleUserMessage(prompt),
    options: {
      systemPrompt: { type: 'preset', preset: 'claude_code', append: UNIVERSAL_CHAT_SYSTEM_PROMPT },
      tools: [],
      maxTurns: 1,
      persistSession: false,
      ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {})
    }
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      finalText = message.result
    }
  }

  if (!finalText) throw new Error('Claude returned no result')
  return finalText
}
