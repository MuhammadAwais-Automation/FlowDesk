import { Check, Clock3, ExternalLink, X } from 'lucide-react'
import type { BrainOpportunity, BrainScope, OpportunityEvidence } from '@/types/brain'

const categoryLabels: Record<BrainOpportunity['category'], string> = {
  direct_lead: 'Direct lead',
  warm_opportunity: 'Warm opportunity',
  market_signal: 'Market signal',
  content_opportunity: 'Content opportunity',
  product_opportunity: 'Product opportunity',
  partnership_opportunity: 'Partnership opportunity',
}

function platformLabel(platform: string) {
  if (platform.toLocaleLowerCase() === 'linkedin') return 'LinkedIn'
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`
}

export function OpportunityCard({ opportunity, scope, evidence, busy = false, onQualify, onDismiss }: {
  opportunity: BrainOpportunity
  scope: BrainScope
  evidence: OpportunityEvidence[]
  busy?: boolean
  onQualify: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div className="grid sm:grid-cols-[6rem_1fr]">
      <div className="flex flex-row items-center justify-between gap-3 bg-violet-50 p-4 sm:flex-col sm:items-start sm:justify-start" aria-label={`Opportunity score ${Math.round(opportunity.score)} out of 100`}>
        <div><p className="text-xs text-violet-700">Score</p><p className="text-3xl font-bold tabular-nums text-violet-900">{Math.round(opportunity.score)}</p></div>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-violet-200 sm:w-full sm:flex-none"><div className="h-full bg-violet-700" style={{ width: `${Math.max(0, Math.min(100, opportunity.score))}%` }} /></div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span>{scope.type.charAt(0).toUpperCase() + scope.type.slice(1)} · {scope.name}</span>
          <span className="rounded-full bg-stone-100 px-2 py-1 font-medium text-stone-700">{categoryLabels[opportunity.category]}</span>
          <span>{Math.round(opportunity.confidence * 100)}% confidence</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {new Date(opportunity.freshness).toLocaleDateString()}</span>
        </div>
        <h2 className="mt-3 text-base font-semibold text-stone-900">{opportunity.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-600">{opportunity.summary}</p>
        <details className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-stone-700">{opportunity.evidenceCount} evidence item{opportunity.evidenceCount === 1 ? '' : 's'}</summary>
          <div className="mt-3 space-y-2">
            {evidence.length === 0 ? <p className="text-xs text-stone-500">Citation details are unavailable.</p> : evidence.map(item => <div key={item.evidenceId} className="border-l-2 border-violet-300 pl-3">
              <p className="text-xs leading-5 text-stone-600">{item.excerpt}</p>
              <a href={item.sourceRef} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-700">
                Open {platformLabel(item.platform)} evidence <ExternalLink size={11} />
              </a>
            </div>)}
          </div>
        </details>
        {opportunity.status !== 'dismissed' && opportunity.status !== 'converted' && <div className="mt-4 flex flex-wrap gap-2">
          {opportunity.status !== 'qualified' && <button disabled={busy} onClick={() => onQualify(opportunity.id)} aria-label="Qualify opportunity" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check size={14} /> Qualify</button>}
          <button disabled={busy} onClick={() => onDismiss(opportunity.id)} aria-label="Dismiss opportunity" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50"><X size={14} /> Dismiss</button>
        </div>}
      </div>
    </div>
  </article>
}
