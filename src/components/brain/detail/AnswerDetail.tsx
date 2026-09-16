import type { Selection } from '@/lib/brainSelection'
import type { AnswerPack } from '@/types/brainKnowledge'

const STRATEGY_LABEL: Record<AnswerPack['strategy'], string> = {
  'strong-signal': 'ek document saaf jeeta',
  ranked: 'kai documents ko rank kiya',
  fuzzy: 'title se milta-julta dhoonda',
  none: 'kuch nahi mila',
}

/**
 * The evidence the retrieval ladder assembled, and how it got there.
 *
 * The provenance footer is not decoration. A memory UI's job is to show where
 * an answer came from -- without it the passages are just text that appeared,
 * and there is no way to tell a confident match from a desperate one.
 */
export function AnswerDetail({ pack, onSelect }: {
  pack: AnswerPack
  onSelect: (next: Selection) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{pack.question}</h2>
        <p className="mt-1 text-xs text-stone-500">
          {pack.sections.length} passage{pack.sections.length === 1 ? '' : 's'}, seedha Library se — koi model nahi chala.
        </p>
      </div>

      {pack.sections.length === 0
        ? <p className="text-sm text-stone-500">{pack.evidence}</p>
        : <div className="space-y-4">
            {pack.sections.map(section => <div key={`${section.path}#${section.headingPath}`}>
              <button
                onClick={() => onSelect({ kind: 'document', path: section.path })}
                className="block max-w-full truncate font-mono text-xs text-amber-700 hover:underline"
              >{section.path}{section.headingPath && `#${section.headingPath}`}</button>
              <p className="mt-1 whitespace-pre-wrap rounded-xl bg-stone-50 p-3 text-sm text-stone-700">{section.text}</p>
            </div>)}
          </div>}

      <dl className="rounded-xl border border-stone-200 p-3 text-xs text-stone-600">
        <div className="flex justify-between gap-3"><dt>Kaise dhoonda</dt><dd>{STRATEGY_LABEL[pack.strategy]}</dd></div>
        <div className="mt-1 flex justify-between gap-3"><dt>Kitne documents dekhe</dt><dd>{pack.candidatesConsidered}</dd></div>
        <div className="mt-1 flex justify-between gap-3"><dt>Agent ko kitne tokens jaate</dt><dd>~{pack.estimatedTokens}</dd></div>
        {pack.pointerFollowed && <div className="mt-1 flex justify-between gap-3">
          <dt>Link follow kiya</dt>
          <dd className="truncate font-mono">{pack.pointerFollowed.from} → {pack.pointerFollowed.to}</dd>
        </div>}
      </dl>
    </div>
  )
}
