import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { BrainDecisionBrief } from '@/types/brain'

export function DecisionBrief({ brief }: { brief: BrainDecisionBrief }) {
  return <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs text-stone-500">Decision question</p><h2 className="mt-1 text-lg font-semibold text-stone-900">{brief.question}</h2></div>
      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">{brief.estimatedTokens} estimated tokens</span>
    </div>
    <p className="mt-4 rounded-xl bg-stone-900 p-4 text-sm leading-6 text-white">{brief.recommendation}</p>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <SignalList title="Supporting signals" signals={brief.supportingSignals} />
      <SignalList title="Counter-signals" signals={brief.counterSignals} />
    </div>
    {brief.risks.length > 0 && <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={15} /> Risks</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-800">{brief.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></section>}
    {brief.nextActions.length > 0 && <section className="mt-5"><h3 className="text-sm font-semibold text-stone-800">Safe next actions</h3><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-600">{brief.nextActions.map(action => <li key={action}>{action}</li>)}</ol></section>}
  </article>
}

function SignalList({ title, signals }: { title: string; signals: BrainDecisionBrief['supportingSignals'] }) {
  return <section><h3 className="text-sm font-semibold text-stone-800">{title}</h3>{signals.length === 0 ? <p className="mt-2 text-xs text-stone-500">No cited signals.</p> : <div className="mt-2 space-y-3">{signals.map((signal, index) => <div key={signal.citation.id} className="border-l-2 border-violet-300 pl-3"><p className="text-xs leading-5 text-stone-600">{signal.text}</p><a href={signal.citation.sourceRef} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-700">Open source {index + 1} <ExternalLink size={11} /></a></div>)}</div>}</section>
}
