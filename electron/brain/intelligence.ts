import { createHash } from 'node:crypto'
import type { CaptureEnvelope } from '../../src/types/brain'

export type OpportunityCategory = 'direct_lead' | 'warm_opportunity' | 'market_signal' | 'content_opportunity' | 'product_opportunity' | 'partnership_opportunity'

interface RawCapture {
  source: 'whatsapp' | 'linkedin' | 'reddit'
  externalId: string | null
  parentExternalId?: string | null
  canonicalUrl?: string | null
  text: string
  observedAt?: string | null
}

interface CaptureContext {
  scopeId: string
  jobId: string
  stepId: string
  accountId: string | null
  connectorVersion: string
}

export function normalizeCapture(raw: RawCapture, context: CaptureContext) {
  const capturedAt = new Date().toISOString()
  const contentHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  const envelope: CaptureEnvelope = {
    envelopeVersion: 1,
    source: raw.source,
    captureType: 'message_or_post',
    connectorId: `${raw.source}.reverse_engineered`,
    connectorVersion: context.connectorVersion,
    jobId: context.jobId,
    stepId: context.stepId,
    scopeId: context.scopeId,
    accountId: context.accountId,
    externalId: raw.externalId,
    parentExternalId: raw.parentExternalId ?? null,
    canonicalUrl: raw.canonicalUrl ?? null,
    observedAt: raw.observedAt ?? null,
    capturedAt,
    cursor: null,
    contentHash,
    rawPayloadRef: `artifact://${context.jobId}/raw/${contentHash}`,
    schemaHint: `${raw.source}.capture.v1`,
  }
  return {
    envelope,
    evidence: {
      text: raw.text,
      source: raw.source,
      sourceRef: raw.canonicalUrl ?? envelope.rawPayloadRef,
      trustedAsInstruction: false as const,
      extractorVersion: 'deterministic-v1',
    },
  }
}

interface OpportunitySignals {
  buyerIntent: number
  painSeverity: number
  icpFit: number
  recency: number
  repetition: number
  crossSourceSupport: number
  evidenceQuality: number
  risk: number
}

function unit(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function scoreOpportunity(signals: OpportunitySignals, category: OpportunityCategory) {
  const weighted = unit(signals.buyerIntent) * 25
    + unit(signals.painSeverity) * 20
    + unit(signals.icpFit) * 15
    + unit(signals.recency) * 10
    + unit(signals.repetition) * 10
    + unit(signals.crossSourceSupport) * 10
    + unit(signals.evidenceQuality) * 10
  return { category, score: Math.round(Math.max(0, Math.min(100, weighted - Math.max(0, signals.risk)))) }
}

export function percentileMomentum(value: number, peerValues: number[]) {
  if (peerValues.length === 0) return 0
  const belowOrEqual = peerValues.filter(peer => peer <= value).length
  return belowOrEqual / peerValues.length
}

export const REDDIT_CONNECTOR_CAPABILITIES = {
  id: 'reddit',
  liveCapture: false,
  transport: 'future_reverse_engineered_browser',
  supports: ['posts', 'comments', 'communities', 'authors', 'votes', 'timestamps', 'canonical_urls'],
} as const
