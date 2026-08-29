import { makeContinuityId, nowIso } from './conversationContinuity'

export interface AgentToolCallEntry {
  tool: string
  prompt: string
  result: string
  isError: boolean
}

export interface AgentTurnEntry {
  id: string
  runId?: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentToolCallEntry[]
  created_at: string
}

export interface AgentSession {
  id: string
  title: string
  entries: AgentTurnEntry[]
  created_at: string
  updated_at: string
}

export function createAgentSession(): AgentSession {
  const timestamp = nowIso()
  return {
    id: makeContinuityId(),
    title: 'Agent Session',
    entries: [],
    created_at: timestamp,
    updated_at: timestamp,
  }
}

export function appendAgentTurn(
  session: AgentSession,
  entry: { role: 'user' | 'assistant'; content: string; toolCalls?: AgentToolCallEntry[]; runId?: string },
): AgentSession {
  const timestamp = nowIso()
  return {
    ...session,
    entries: [
      ...session.entries,
      {
        id: makeContinuityId(),
        ...(entry.runId ? { runId: entry.runId } : {}),
        role: entry.role,
        content: entry.content,
        toolCalls: entry.toolCalls ?? [],
        created_at: timestamp,
      },
    ],
    updated_at: timestamp,
  }
}

function truncateText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text
  return `${text.slice(0, Math.max(0, maxCharacters - 12)).trimEnd()}\n...[truncated]`
}

/**
 * Each Agent turn is an independent, ephemeral query() call (no SDK session
 * resume) — continuity across turns is a text recap prepended to the next
 * message, same proven pattern as claudeSdkProvider.ts / UniversalChat.tsx's
 * buildHandoffPrompt. Includes a compact rendering of prior tool calls so
 * the lead agent remembers what it already asked other providers.
 */
export function buildAgentHandoffPrompt(session: AgentSession, newText: string, maxEntries = 6, maxEntryCharacters = 1000): string {
  if (session.entries.length === 0) return newText

  const recentEntries = session.entries.slice(-maxEntries)
  const recentTurns = recentEntries
    .map(entry => {
      const toolCallsText = entry.toolCalls.length > 0
        ? '\n' + entry.toolCalls.map(tc => `  [asked ${tc.tool}: "${truncateText(tc.prompt, 200)}" -> ${tc.isError ? 'ERROR: ' : ''}${truncateText(tc.result, 400)}]`).join('\n')
        : ''
      return `[${entry.role}]\n${truncateText(entry.content, maxEntryCharacters)}${toolCallsText}`
    })
    .join('\n\n')

  return [
    'You are continuing a previous conversation in FlowDesk\'s Agent section.',
    '',
    'Recent turns (including any worker tools you already called and what they said):',
    recentTurns,
    '',
    'Continue naturally from here. The user\'s new message:',
    newText,
  ].join('\n')
}
