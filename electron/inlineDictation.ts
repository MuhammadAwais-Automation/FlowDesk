/**
 * Contract for FlowDesk's inline, provider-backed dictation bridge.
 *
 * This deliberately contains no browser selectors, cookie access, network
 * interception, or provider UI automation.  Those may only be added later as
 * versioned adapters after an explicit capability probe proves that a given
 * provider/session supports them.  Keeping the routing and event validation
 * here makes the eventual adapter replaceable without changing the renderer
 * security boundary.
 */
export type InlineDictationProvider = 'chatgpt' | 'gemini'
export type InlineDictationSurface = 'agent' | 'universal'
export type InlineDictationStatus =
  | 'probing'
  | 'ready'
  | 'listening'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'unavailable'
export type InlineDictationCapability = 'unknown' | 'instrumentation_required' | 'available' | 'unavailable'
export type InlineDictationEventType =
  | 'started'
  | 'probing'
  | 'ready'
  | 'listening'
  | 'interim'
  | 'final'
  | 'stopped'
  | 'failed'
  | 'interrupted'

export interface InlineDictationAccount {
  email: string
  partition: string
}

export interface InlineDictationStartInput {
  provider: InlineDictationProvider
  accountId: string
  surface: InlineDictationSurface
  surfaceSessionId: string
}

export interface InlineDictationTarget {
  provider: InlineDictationProvider
  accountId: string
  accountEmail: string
  partition: string
  surface: InlineDictationSurface
  surfaceSessionId: string
}

export interface InlineDictationEvent {
  sequence: number
  type: InlineDictationEventType
  createdAt: string
  message?: string
}

export interface InlineDictationRun extends InlineDictationTarget {
  id: string
  status: InlineDictationStatus
  capability: InlineDictationCapability
  startedAt: string
  updatedAt: string
  /** Only the current editable draft. Never use this as a durable transcript. */
  transcript?: string
  error?: string
  events: InlineDictationEvent[]
}

export interface InlineDictationRunSnapshot {
  runs: InlineDictationRun[]
}

export type InlineDictationResolution =
  | { ok: true; target: InlineDictationTarget }
  | { ok: false; error: 'invalid_request' | 'unknown_provider' | 'account_not_found' }

export interface InlineDictationCapabilityResult {
  capability: InlineDictationCapability
  message?: string
}

/**
 * Adapter boundary for future provider-specific instrumentation.  Adapter
 * implementations receive only the selected partition and must never expose
 * cookies, credentials, audio buffers, or arbitrary remote-page code to IPC.
 */
export interface InlineDictationAdapter {
  readonly provider: InlineDictationProvider
  probe(target: InlineDictationTarget): Promise<InlineDictationCapabilityResult>
}

function canonicalEmail(value: string): string | null {
  return value.trim().match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i)?.[0]?.toLowerCase() ?? null
}

export function resolveInlineDictationTarget(
  input: unknown,
  accounts: readonly InlineDictationAccount[],
): InlineDictationResolution {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid_request' }
  const candidate = input as Partial<InlineDictationStartInput>
  if (candidate.provider !== 'chatgpt' && candidate.provider !== 'gemini') return { ok: false, error: 'unknown_provider' }
  if (candidate.surface !== 'agent' && candidate.surface !== 'universal') return { ok: false, error: 'invalid_request' }
  if (typeof candidate.surfaceSessionId !== 'string' || !candidate.surfaceSessionId.trim() || candidate.surfaceSessionId.length > 200) {
    return { ok: false, error: 'invalid_request' }
  }
  if (typeof candidate.accountId !== 'string') return { ok: false, error: 'invalid_request' }
  const accountId = canonicalEmail(candidate.accountId)
  if (!accountId) return { ok: false, error: 'invalid_request' }
  const account = accounts.find(entry => canonicalEmail(entry.email) === accountId && typeof entry.partition === 'string' && entry.partition.length > 0)
  if (!account) return { ok: false, error: 'account_not_found' }
  return { ok: true, target: { provider: candidate.provider, accountId, accountEmail: accountId, partition: account.partition, surface: candidate.surface, surfaceSessionId: candidate.surfaceSessionId.trim() } }
}

/** The initial implementation intentionally blocks until a real adapter exists. */
export function createInstrumentationRequiredAdapter(provider: InlineDictationProvider): InlineDictationAdapter {
  return {
    provider,
    async probe() {
      return { capability: 'instrumentation_required', message: 'Inline provider dictation needs a verified adapter for this provider session.' }
    },
  }
}

export function validateInlineDictationTranscript(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\u0000/g, '').trim()
  return text && text.length <= 20_000 ? text : null
}
