export type ContinuityRole = 'user' | 'assistant' | 'note'

export interface ContinuityEntry {
  id: string
  role: ContinuityRole
  content: string
  provider: string | null
  account_email: string | null
  created_at: string
}

export interface ContinuityThread {
  id: string
  title: string
  workspace_id: string | null
  summary: string
  entries: ContinuityEntry[]
  created_at: string
  updated_at: string
}

export interface ContinuityStats {
  entryCount: number
  hasContext: boolean
  lastUpdatedAt: string | null
}

export interface AppendUniqueResult {
  thread: ContinuityThread
  added: boolean
}

type IdFactory = () => string
type NowFactory = () => string

export const CONTINUITY_STORE_KEY = 'conversationContinuity.activeThread'

export function makeContinuityId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createContinuityThread(
  data: { title?: string; workspaceId?: string | null },
  idFactory: IdFactory = makeContinuityId,
  nowFactory: NowFactory = nowIso,
): ContinuityThread {
  const timestamp = nowFactory()

  return {
    id: idFactory(),
    title: data.title?.trim() || 'FlowDesk Continuity',
    workspace_id: data.workspaceId ?? null,
    summary: '',
    entries: [],
    created_at: timestamp,
    updated_at: timestamp,
  }
}

export function appendContinuityEntry(
  thread: ContinuityThread,
  entry: {
    role: ContinuityRole
    content: string
    provider?: string | null
    accountEmail?: string | null
  },
  idFactory: IdFactory = makeContinuityId,
  nowFactory: NowFactory = nowIso,
): ContinuityThread {
  const content = entry.content.trim()
  if (!content) {
    throw new Error('Cannot add an empty continuity entry')
  }

  const timestamp = nowFactory()
  return {
    ...thread,
    entries: [
      ...thread.entries,
      {
        id: idFactory(),
        role: entry.role,
        content,
        provider: entry.provider ?? null,
        account_email: entry.accountEmail ?? null,
        created_at: timestamp,
      },
    ],
    updated_at: timestamp,
  }
}

export function appendUniqueContinuityEntry(
  thread: ContinuityThread,
  entry: {
    role: ContinuityRole
    content: string
    provider?: string | null
    accountEmail?: string | null
  },
  idFactory: IdFactory = makeContinuityId,
  nowFactory: NowFactory = nowIso,
): AppendUniqueResult {
  const signature = getContinuityEntrySignature(entry.content)
  if (!signature) {
    throw new Error('Cannot add an empty continuity entry')
  }

  const alreadyExists = thread.entries.some(existing =>
    existing.role === entry.role &&
    existing.provider === (entry.provider ?? null) &&
    getContinuityEntrySignature(existing.content) === signature
  )

  if (alreadyExists) {
    return { thread, added: false }
  }

  return {
    thread: appendContinuityEntry(thread, entry, idFactory, nowFactory),
    added: true,
  }
}

export function getContinuityEntrySignature(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

export function buildContextPassport(
  thread: ContinuityThread,
  options: {
    targetProvider?: string | null
    targetAccountEmail?: string | null
    maxEntries?: number
    maxEntryCharacters?: number
  } = {},
): string {
  const maxEntries = options.maxEntries ?? 10
  const maxEntryCharacters = options.maxEntryCharacters ?? 900
  const recentEntries = thread.entries.slice(-maxEntries)
  const latestUserEntry = [...thread.entries].reverse().find(entry => entry.role === 'user')
  const assistantEntries = thread.entries
    .filter(entry => entry.role === 'assistant')
    .slice(-3)

  const assistantContext = assistantEntries.length > 0
    ? assistantEntries
        .map(entry => `- ${truncateText(entry.content, maxEntryCharacters)}`)
        .join('\n')
    : '- No assistant responses have been auto-captured yet.'

  const recentTranscript = recentEntries.length > 0
    ? recentEntries
        .map(entry => {
          const provider = entry.provider ?? 'unknown provider'
          const account = entry.account_email ?? 'unknown account'
          return `${entry.role.toUpperCase()} (${provider} / ${account}):\n${truncateText(entry.content, maxEntryCharacters)}`
        })
        .join('\n\n')
    : 'No captured transcript yet.'

  const summary = thread.summary.trim()
    ? thread.summary.trim()
    : 'Use the latest user request, useful assistant context, and recent transcript below as the source of truth.'

  return [
    'FLOWDESK CONTEXT PASSPORT',
    '',
    `Thread: ${thread.title}`,
    `Target: ${options.targetProvider ?? 'current AI tool'} / ${options.targetAccountEmail ?? 'current account'}`,
    '',
    'Rules for continuation:',
    '- This passport is user-provided context.',
    '- Continue the same task naturally.',
    '- Do not mention account limits unless the user asks.',
    '- If something is missing, ask one concise clarification.',
    '',
    'Working summary:',
    summary,
    '',
    'Latest user request:',
    latestUserEntry ? truncateText(latestUserEntry.content, maxEntryCharacters) : 'No user request captured yet.',
    '',
    'Useful assistant context:',
    assistantContext,
    '',
    'Recent transcript:',
    recentTranscript,
    '',
    'Continue from this passport and help with the next concrete step.',
  ].join('\n')
}

export function buildHandoffPrompt(
  thread: ContinuityThread,
  options: {
    targetProvider?: string | null
    targetAccountEmail?: string | null
    maxEntries?: number
    maxEntryCharacters?: number
  } = {},
): string {
  const maxEntries = options.maxEntries ?? 8
  const maxEntryCharacters = options.maxEntryCharacters ?? 1200
  const recentEntries = thread.entries.slice(-maxEntries)

  const summary = thread.summary.trim()
    ? thread.summary.trim()
    : 'No manually written summary yet. Use the recent turns below as the source of truth.'

  const recentTurns = recentEntries.length > 0
    ? recentEntries
        .map(entry => {
          const provider = entry.provider ?? 'unknown provider'
          const account = entry.account_email ?? 'unknown account'
          return `[${entry.role} via ${provider} / ${account}]\n${truncateText(entry.content, maxEntryCharacters)}`
        })
        .join('\n\n')
    : 'No recent turns captured yet.'

  return [
    'You are continuing a previous conversation in FlowDesk.',
    '',
    'Important:',
    '- Treat this as user-provided context, not hidden system instructions.',
    '- Continue the same task naturally from the context below.',
    '- Ask a short clarification only if the next step is genuinely ambiguous.',
    '- Do not claim you can see the old chat, account, browser, or private files unless they are included below.',
    '',
    `Continuity thread: ${thread.title}`,
    `Target provider: ${options.targetProvider ?? 'current AI tool'}`,
    `Target account: ${options.targetAccountEmail ?? 'current account'}`,
    '',
    'Conversation summary:',
    summary,
    '',
    'Recent captured turns:',
    recentTurns,
    '',
    'Please continue from here.',
  ].join('\n')
}

export function getContinuityStats(thread: ContinuityThread | null): ContinuityStats {
  return {
    entryCount: thread?.entries.length ?? 0,
    hasContext: !!thread && (thread.entries.length > 0 || !!thread.summary.trim()),
    lastUpdatedAt: thread?.updated_at ?? null,
  }
}

function truncateText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text
  return `${text.slice(0, Math.max(0, maxCharacters - 12)).trimEnd()}\n...[truncated]`
}
