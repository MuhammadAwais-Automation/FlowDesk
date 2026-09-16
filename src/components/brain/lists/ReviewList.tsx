import { Check, Link2, X } from 'lucide-react'
import { Card } from '../Card'
import type { Selection } from '@/lib/brainSelection'
import type { BrainCandidate } from '@/types/brain'
import type { KnowledgeCandidate, UnresolvedLink } from '@/types/brainKnowledge'

export function ReviewList({
  candidates, knowledgeCandidates, unresolvedLinks, onReview, onReviewKnowledge, onSelect,
}: {
  candidates: BrainCandidate[]
  knowledgeCandidates: KnowledgeCandidate[]
  unresolvedLinks: UnresolvedLink[]
  onReview: (id: string, decision: 'accept' | 'reject') => void
  onReviewKnowledge: (id: string, decision: 'accept' | 'reject') => void
  onSelect: (next: Selection) => void
}) {
  return (
    <div className="space-y-3">
      {candidates.length === 0 && knowledgeCandidates.length === 0 && unresolvedLinks.length === 0 && <Card><p className="text-sm text-stone-500">Review Inbox empty hai.</p></Card>}
      {candidates.map(candidate => <Card key={candidate.id}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-xs text-stone-500"><span className="mr-2 rounded-full bg-stone-100 px-2 py-0.5 font-semibold text-stone-600">Memory</span>{candidate.origin} · {candidate.kind}</p>
            <p className="mt-1 text-sm">{candidate.text}</p>
          </div>
          <button onClick={() => onReview(candidate.id, 'accept')} className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Check size={16} /></button>
          <button onClick={() => onReview(candidate.id, 'reject')} className="rounded-lg bg-red-100 p-2 text-red-700"><X size={16} /></button>
        </div>
      </Card>)}
      {knowledgeCandidates.map(candidate => <Card key={candidate.id}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-xs text-stone-500"><span className="mr-2 rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">Knowledge</span>{candidate.origin} · {candidate.type}</p>
            <p className="mt-1 text-sm font-medium">{candidate.title}</p>
            <p className="mt-1 text-sm text-stone-600">{candidate.body}</p>
          </div>
          <button onClick={() => onReviewKnowledge(candidate.id, 'accept')} className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Check size={16} /></button>
          <button onClick={() => onReviewKnowledge(candidate.id, 'reject')} className="rounded-lg bg-red-100 p-2 text-red-700"><X size={16} /></button>
        </div>
      </Card>)}
      {unresolvedLinks.length > 0 && <Card>
        <h2 className="flex items-center gap-2 font-semibold"><Link2 size={17} /> Unresolved links</h2>
        <p className="mt-1 text-xs text-stone-500">Ye documents ek doosre ko mention karte hain jo abhi exist nahi karta. Koi maintenance nahi chahiye — sirf jankari.</p>
        <div className="mt-3 space-y-2">
          {unresolvedLinks.map(link => <button
            key={`${link.documentPath}→${link.targetPath}`}
            onClick={() => onSelect({ kind: 'document', path: link.documentPath })}
            className="block w-full rounded-lg bg-stone-50 p-3 text-left text-xs hover:bg-stone-100"
          >
            <span className="font-medium">{link.documentTitle}</span> <span className="text-stone-400">({link.documentPath})</span> → <span className="text-amber-700">{link.targetPath}</span>
          </button>)}
        </div>
      </Card>}
    </div>
  )
}
