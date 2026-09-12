import type {
  BrainCitation,
  BrainDecisionBrief,
  BrainOpportunity,
  OpportunityEvidence,
} from '../../src/types/brain'

export interface DecisionBriefOpportunity {
  opportunity: BrainOpportunity
  evidence: OpportunityEvidence[]
}

/** A signal plus the bookkeeping the narrative needs, stripped before the brief ships. */
interface RankedSignal {
  text: string
  citation: BrainCitation
  title: string
  lowConfidence: boolean
}

function tokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4)
}

/**
 * Words that carry no topic. Without this list a question like "Should we hire
 * a designer?" matches every opportunity whose text contains `should`, which
 * made the relevance gate admit the whole scope (review Finding 4).
 */
const STOPWORDS = new Set([
  'and', 'are', 'but', 'can', 'for', 'from', 'has', 'have', 'how', 'its', 'not', 'our', 'out',
  'should', 'shall', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'was', 'were', 'what', 'when', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'your', 'about', 'into', 'more', 'need', 'now', 'over', 'than', 'want', 'work', 'worth', 'does',
  'did', 'been', 'being', 'also', 'any', 'all', 'let', 'get', 'got',
])

function terms(text: string) {
  return new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(term => !STOPWORDS.has(term)))
}

function relevance(questionTerms: Set<string>, item: DecisionBriefOpportunity) {
  const haystack = terms(`${item.opportunity.title} ${item.opportunity.summary} ${item.evidence.map(value => value.excerpt).join(' ')}`)
  return [...questionTerms].filter(term => haystack.has(term)).length
}

function clip(text: string, maximum: number) {
  const value = text.trim()
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`
}

function citation(opportunity: BrainOpportunity, item: OpportunityEvidence): BrainCitation {
  return {
    id: item.evidenceId,
    memoryId: opportunity.id,
    text: clip(item.excerpt, 500),
    kind: 'opportunity',
    scopeId: opportunity.scopeId,
    sourceRef: item.sourceRef,
    score: Math.round(opportunity.score * opportunity.confidence * item.confidence) / 100,
  }
}

function strip(signal: RankedSignal) {
  return { text: signal.text, citation: signal.citation }
}

/**
 * Composes the whole brief from the signals it is actually carrying.
 *
 * Every sentence here is a function of `support`/`counter` after compaction, so
 * a brief can never assert cited support it dropped to fit the budget, nor warn
 * about counter-signals it did not keep (review Findings 1 and 2).
 */
function assemble(question: string, support: RankedSignal[], counter: RankedSignal[]): BrainDecisionBrief {
  const hasEvidence = support.length + counter.length > 0
  const recommendation = !hasEvidence
    ? 'Insufficient cited evidence to make a recommendation.'
    : support.length > counter.length
      ? `Prioritize review of ${clip(support[0].title, 180)}; current cited signals are stronger than counter-signals.`
      : 'Hold action until the conflicting cited signals are resolved.'
  const risks = !hasEvidence
    ? ['No current cited evidence matches this question.']
    : [
        ...(counter.length ? ['Current evidence contains conflicting or stale signals.'] : []),
        ...([...support, ...counter].some(signal => signal.lowConfidence) ? ['At least one cited opportunity has low confidence.'] : []),
      ]
  return {
    question,
    recommendation,
    supportingSignals: support.map(strip),
    counterSignals: counter.map(strip),
    risks,
    nextActions: !hasEvidence ? [] : [
      'Open the cited sources and verify the current need.',
      'Qualify or dismiss the matched opportunity after review.',
    ],
    estimatedTokens: 0,
  }
}

export function buildDecisionBrief(input: {
  question: string
  opportunities: DecisionBriefOpportunity[]
  tokenBudget?: number
}): BrainDecisionBrief {
  const budget = Math.min(1200, Math.max(128, Math.trunc(input.tokenBudget ?? 1200)))
  let question = clip(input.question, Math.max(80, Math.floor(budget * 1.2)))
  const questionTerms = terms(question)

  // Relevance first, so the opportunity the question is actually about cannot
  // be outranked by a high-scoring opportunity that merely shares filler words.
  const ranked = input.opportunities
    .map(item => ({ item, relevance: relevance(questionTerms, item) }))
    .filter(entry => entry.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance
      || right.item.opportunity.score * right.item.opportunity.confidence - left.item.opportunity.score * left.item.opportunity.confidence
      || right.item.opportunity.freshness.localeCompare(left.item.opportunity.freshness))

  const support: RankedSignal[] = []
  const counter: RankedSignal[] = []
  for (const { item } of ranked) {
    for (const evidence of item.evidence) {
      if (!evidence.sourceRef || evidence.claimStatus === 'superseded') continue
      const signal: RankedSignal = {
        text: clip(evidence.excerpt, 500),
        citation: citation(item.opportunity, evidence),
        title: item.opportunity.title,
        lowConfidence: item.opportunity.confidence < 0.6,
      }
      if (evidence.claimStatus === 'conflicting' || evidence.stale || item.opportunity.status === 'dismissed') counter.push(signal)
      else support.push(signal)
    }
  }

  // Interleaved, counter-signal first: disconfirming evidence must not be the
  // bucket that budget pressure silently deletes. Both buckets stay ranked.
  const order: Array<{ bucket: 'support' | 'counter'; signal: RankedSignal }> = []
  for (let index = 0; index < Math.max(support.length, counter.length); index += 1) {
    if (index < counter.length) order.push({ bucket: 'counter', signal: counter[index] })
    if (index < support.length) order.push({ bucket: 'support', signal: support[index] })
  }

  const keptSupport: RankedSignal[] = []
  const keptCounter: RankedSignal[] = []
  const size = () => tokens({ ...assemble(question, keptSupport, keptCounter), estimatedTokens: budget })
  for (const candidate of order) {
    const bucket = candidate.bucket === 'support' ? keptSupport : keptCounter
    bucket.push(candidate.signal)
    if (size() > budget) bucket.pop()
  }
  while (size() > budget) {
    // Drop from whichever bucket is larger; on a tie the support side gives way,
    // because losing a counter-signal is the costlier mistake.
    if (keptSupport.length >= keptCounter.length && keptSupport.length) keptSupport.pop()
    else if (keptCounter.length) keptCounter.pop()
    else if (question.length > 40) question = clip(question, Math.max(40, Math.floor(question.length * 0.8)))
    else break
  }

  const brief = assemble(question, keptSupport, keptCounter)
  brief.estimatedTokens = tokens({ ...brief, estimatedTokens: budget })
  return brief
}
