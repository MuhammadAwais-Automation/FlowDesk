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

function tokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function terms(text: string) {
  return new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
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

export function buildDecisionBrief(input: {
  question: string
  opportunities: DecisionBriefOpportunity[]
  tokenBudget?: number
}): BrainDecisionBrief {
  const budget = Math.min(1200, Math.max(128, Math.trunc(input.tokenBudget ?? 1200)))
  const question = clip(input.question, Math.max(80, Math.floor(budget * 1.2)))
  const questionTerms = terms(question)
  const ranked = input.opportunities
    .filter(item => relevance(questionTerms, item) > 0)
    .sort((left, right) => {
      const score = right.opportunity.score * right.opportunity.confidence - left.opportunity.score * left.opportunity.confidence
      return score || right.opportunity.freshness.localeCompare(left.opportunity.freshness)
    })

  const support: BrainDecisionBrief['supportingSignals'] = []
  const counter: BrainDecisionBrief['counterSignals'] = []
  for (const item of ranked) {
    for (const evidence of item.evidence) {
      if (!evidence.sourceRef || evidence.claimStatus === 'superseded') continue
      const signal = { text: clip(evidence.excerpt, 500), citation: citation(item.opportunity, evidence) }
      if (evidence.claimStatus === 'conflicting' || evidence.stale || item.opportunity.status === 'dismissed') counter.push(signal)
      else support.push(signal)
    }
  }

  const hasEvidence = support.length + counter.length > 0
  const recommendation = !hasEvidence
    ? 'Insufficient cited evidence to make a recommendation.'
    : support.length > counter.length
      ? `Prioritize review of ${clip(ranked[0].opportunity.title, 180)}; current cited signals are stronger than counter-signals.`
      : 'Hold action until the conflicting cited signals are resolved.'
  const risks = !hasEvidence
    ? ['No current cited evidence matches this question.']
    : [
        ...(counter.length ? ['Current evidence contains conflicting or stale signals.'] : []),
        ...(ranked.some(item => item.opportunity.confidence < 0.6) ? ['At least one matched opportunity has low confidence.'] : []),
      ]
  const nextActions = !hasEvidence ? [] : [
    'Open the cited sources and verify the current need.',
    'Qualify or dismiss the matched opportunity after review.',
  ]
  const brief: BrainDecisionBrief = {
    question,
    recommendation,
    supportingSignals: [],
    counterSignals: [],
    risks,
    nextActions,
    estimatedTokens: 0,
  }
  const candidates = [
    ...support.map(signal => ({ bucket: 'supportingSignals' as const, signal })),
    ...counter.map(signal => ({ bucket: 'counterSignals' as const, signal })),
  ]
  for (const candidate of candidates) {
    brief[candidate.bucket].push(candidate.signal)
    if (tokens(brief) > budget) brief[candidate.bucket].pop()
  }
  while (tokens({ ...brief, estimatedTokens: budget }) > budget) {
    if (brief.counterSignals.length) brief.counterSignals.pop()
    else if (brief.supportingSignals.length) brief.supportingSignals.pop()
    else if (brief.question.length > 40) brief.question = clip(brief.question, Math.max(40, Math.floor(brief.question.length * 0.8)))
    else break
  }
  brief.estimatedTokens = tokens({ ...brief, estimatedTokens: budget })
  return brief
}
