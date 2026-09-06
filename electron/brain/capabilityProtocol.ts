import { z } from 'zod'
import { recordsFromConnectorResult } from './socialRecipes'

const id = z.string().min(1).max(200)
const limit = z.number().int().min(1).max(500)
export const capabilityRequestSchema = z.discriminatedUnion('capability', [
  z.object({ id, capability: z.literal('whatsapp.list_unread'), input: z.object({ limit }).strict() }).strict(),
  z.object({ id, capability: z.literal('linkedin.feed'), input: z.object({ limit, sort: z.literal('RECENT') }).strict() }).strict(),
  z.object({ id, capability: z.literal('linkedin.search'), input: z.object({ query: z.string().trim().min(1).max(500), limit }).strict() }).strict(),
])

export const capabilityResultSchema = z.discriminatedUnion('ok', [
  z.object({ id, ok: z.literal(true), records: z.array(z.record(z.string(), z.unknown())).max(500) }).strict(),
  z.object({ id, ok: z.literal(false), error: z.object({
    code: z.enum(['login_required', 'approval_required', 'transient', 'permanent']), message: z.string().min(1).max(500),
  }).strict() }).strict(),
])

export const capabilityEnvelopeSchema = z.object({
  type: z.literal('capability:request'), jobId: id, scopeId: id, recipeId: id, accountId: id.nullable(), request: capabilityRequestSchema,
}).strict()
export const capabilityResponseEnvelopeSchema = z.object({ type: z.literal('capability:result'), result: capabilityResultSchema }).strict()
export type BrainCapabilityRequest = z.infer<typeof capabilityRequestSchema>
export type BrainCapabilityResult = z.infer<typeof capabilityResultSchema>
export type BrainCapabilityEnvelope = z.infer<typeof capabilityEnvelopeSchema>
export type BrainCapabilityExecutor = (envelope: BrainCapabilityEnvelope) => Promise<BrainCapabilityResult>
export type BrainCapabilityErrorCode = Extract<BrainCapabilityResult, { ok: false }>['error']['code']

export class BrainCapabilityBridge {
  private closed = false
  private readonly pending = new Map<string, { resolve: (result: BrainCapabilityResult) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(private readonly send: (envelope: BrainCapabilityEnvelope) => void) {}

  request(input: BrainCapabilityEnvelope): Promise<BrainCapabilityResult> {
    const envelope = capabilityEnvelopeSchema.parse(input)
    const id = envelope.request.id
    if (this.closed || this.pending.has(id)) return Promise.resolve(capabilityFailure(id, 'transient'))
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(capabilityFailure(id, 'transient'))
      }, 60_000)
      this.pending.set(id, { resolve, timer })
      try { this.send(envelope) } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(capabilityFailure(id, 'transient'))
      }
    })
  }

  receive(input: unknown): boolean {
    if (!input || typeof input !== 'object' || !('type' in input) || input.type !== 'capability:result') return false
    const parsed = capabilityResponseEnvelopeSchema.safeParse(input)
    if (!parsed.success) return true
    const result = parsed.data.result
    const pending = this.pending.get(result.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(result.id)
      pending.resolve(result)
    }
    return true
  }

  close() {
    this.closed = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve(capabilityFailure(id, 'transient'))
    }
    this.pending.clear()
  }
}

export function capabilityFailure(id: string, code: BrainCapabilityErrorCode): BrainCapabilityResult {
  const messages = {
    login_required: 'Open the provider and sign in, then retry.',
    approval_required: 'Grant consent for this scope and recipe, then retry.',
    transient: 'Connector read temporarily unavailable.',
    permanent: 'Connector request is unsupported or invalid.',
  }
  return { id, ok: false, error: { code, message: messages[code] } }
}

const recipeCapabilities: Record<string, BrainCapabilityRequest['capability']> = {
  'whatsapp.unread_intelligence': 'whatsapp.list_unread',
  'linkedin.community_scan': 'linkedin.feed',
  'linkedin.opportunity_scan': 'linkedin.search',
}

// Only Electron main supplies read(). Neither commands nor executable code are accepted.
export async function executeBrainCapability(input: unknown, gateway: {
  hasConsent: (scopeId: string, recipeId: string, provider: string) => Promise<boolean>
  read: (request: BrainCapabilityRequest) => Promise<unknown>
}): Promise<BrainCapabilityResult> {
  const envelope = capabilityEnvelopeSchema.parse(input)
  const { request } = envelope
  // Current connectors address the existing single social session. Never silently use
  // that session for a job that explicitly requested another account.
  if (envelope.accountId !== null || recipeCapabilities[envelope.recipeId] !== request.capability) return capabilityFailure(request.id, 'permanent')
  try {
    if (!await gateway.hasConsent(envelope.scopeId, envelope.recipeId, 'local-brain')) return capabilityFailure(request.id, 'approval_required')
    const result = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough().parse(await gateway.read(request))
    if (!result.ok) {
      const error = result.error ?? ''
      const code = /sign.?in|log.?in|not open|unauthori[sz]ed|\b401\b/i.test(error) ? 'login_required'
        : /unsupported|invalid|forbidden|\b40[034]\b/i.test(error) ? 'permanent' : 'transient'
      return capabilityFailure(request.id, code)
    }
    const records = recordsFromConnectorResult(result).slice(0, request.input.limit)
    if (JSON.stringify(records).length > 5_000_000) return capabilityFailure(request.id, 'permanent')
    return capabilityResultSchema.parse({ id: request.id, ok: true, records })
  } catch {
    return capabilityFailure(request.id, 'transient')
  }
}
