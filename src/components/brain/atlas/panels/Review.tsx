import { Check, Plus, X } from 'lucide-react'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection } from '@/lib/brainSelection'
import type { BrainCandidate } from '@/types/brain'
import type { KnowledgeCandidate, UnresolvedLink } from '@/types/brainKnowledge'

/**
 * The write gate, and the loose ends beside it.
 *
 * Unresolved links sit here rather than in their own surface because they are
 * the same kind of thing as a candidate: a connection the store has noticed and
 * a human has not confirmed. The difference is the action — a candidate is
 * accepted, a loose end is given the document it was pointing at.
 */
export function Review({ candidates, knowledgeCandidates, unresolvedLinks, onReview, onReviewKnowledge, onCreateStub, onSelect }: {
  candidates: BrainCandidate[]
  knowledgeCandidates: KnowledgeCandidate[]
  unresolvedLinks: UnresolvedLink[]
  onReview: (id: string, decision: 'accept' | 'reject') => void
  onReviewKnowledge: (id: string, decision: 'accept' | 'reject') => void
  onCreateStub: (targetPath: string) => void
  onSelect: (next: Selection) => void
}) {
  const empty = candidates.length === 0 && knowledgeCandidates.length === 0 && unresolvedLinks.length === 0
  if (empty) {
    return <p className="font-retro-sans text-sm" style={{ color: OBSERVATORY.dim }}>Kuch pending nahi hai.</p>
  }

  const card = 'rounded-xl border p-3'
  const surface = { background: OBSERVATORY.canvas, borderColor: OBSERVATORY.border }
  const decide = 'rounded-lg p-1.5 transition hover:bg-white/10'

  return (
    <div className="space-y-2.5">
      {knowledgeCandidates.map(candidate => (
        <div key={candidate.id} className={`${card} flex items-start gap-2.5`} style={surface}>
          <div className="min-w-0 flex-1">
            <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
              {candidate.origin} · {candidate.type}
            </p>
            <p className="font-retro-sans mt-1 text-sm" style={{ color: OBSERVATORY.text }}>{candidate.title}</p>
            <p className="font-retro-sans mt-1 text-xs" style={{ color: OBSERVATORY.muted }}>{candidate.body}</p>
          </div>
          <button onClick={() => onReviewKnowledge(candidate.id, 'accept')} aria-label={`Accept ${candidate.title}`} className={decide} style={{ color: '#4ade80' }}><Check size={15} /></button>
          <button onClick={() => onReviewKnowledge(candidate.id, 'reject')} aria-label={`Reject ${candidate.title}`} className={decide} style={{ color: '#f87171' }}><X size={15} /></button>
        </div>
      ))}

      {candidates.map(candidate => (
        <div key={candidate.id} className={`${card} flex items-start gap-2.5`} style={surface}>
          <div className="min-w-0 flex-1">
            <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
              memory · {candidate.origin} · {candidate.kind}
            </p>
            <p className="font-retro-sans mt-1 text-sm" style={{ color: OBSERVATORY.text }}>{candidate.text}</p>
          </div>
          <button onClick={() => onReview(candidate.id, 'accept')} aria-label={`Accept ${candidate.text}`} className={decide} style={{ color: '#4ade80' }}><Check size={15} /></button>
          <button onClick={() => onReview(candidate.id, 'reject')} aria-label={`Reject ${candidate.text}`} className={decide} style={{ color: '#f87171' }}><X size={15} /></button>
        </div>
      ))}

      {unresolvedLinks.length > 0 && (
        <div className={card} style={surface}>
          <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
            Loose ends · {unresolvedLinks.length}
          </p>
          <div className="mt-2 space-y-1">
            {unresolvedLinks.slice(0, 40).map(link => (
              <div key={`${link.documentPath}->${link.targetPath}`} className="flex items-center gap-2">
                <button
                  onClick={() => onSelect({ kind: 'document', path: link.documentPath })}
                  className="font-retro-sans min-w-0 flex-1 truncate text-left text-xs transition hover:underline"
                  style={{ color: OBSERVATORY.muted }}
                >
                  {link.documentTitle} → <span className="font-retro-mono" style={{ color: OBSERVATORY.accent }}>{link.targetPath}</span>
                </button>
                <button
                  onClick={() => onCreateStub(link.targetPath)}
                  aria-label={`Create ${link.targetPath}`}
                  className="rounded-lg p-1 transition hover:bg-white/10"
                  style={{ color: OBSERVATORY.muted }}
                >
                  <Plus size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
