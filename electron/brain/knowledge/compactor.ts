/**
 * Compactor — Phase 3's cleanup pass over the write gate's leftovers.
 *
 * Phase 2's write gate creates a new standalone `captures/<id>.md` document
 * whenever a candidate has no target path — every session-captured note ends
 * up here, since sessionCapture.ts never guesses a target. Left alone, these
 * pile up as clutter in the manifest every agent turn reads. This module
 * folds a capture into the real document it's about, once a match is clear,
 * and retires the capture; it never invents anything and leaves a capture
 * alone rather than risk merging it into the wrong file.
 *
 * Deliberately deterministic: no LLM call, no "insight" generation. Just
 * merge what's clearly the same thing.
 */

import { createHash } from 'node:crypto'
import type {
  CompactionDecision,
  CompactionReport,
} from '../../../src/types/brainKnowledge'
import type { DocumentStorePort } from './ports'

const CAPTURE_PATH_PREFIX = 'captures/'

/** How many of a capture's distinctive words a candidate document must
 *  independently match before it's even considered — one shared word is
 *  coincidence, not evidence. */
const MIN_MATCHED_WORDS = 2

/** The top candidate's aggregated score must be at least this many times the
 *  runner-up's to count as a clear match, not just the closest of several
 *  weak ones. FTS5 bm25 magnitudes vary by corpus size in ways that make an
 *  absolute score floor unreliable (confirmed empirically: a real match on a
 *  small fixture corpus scored ~1e-6) — a *margin* over the field is the
 *  more robust conservative signal. */
const CONFIDENCE_MARGIN = 3

const MAX_QUERY_WORDS = 6
const MIN_WORD_LENGTH = 3

/**
 * Roman Urdu/Hinglish connector words alongside common English ones. Capture
 * bodies come from real chat turns in that mix (see sessionCapture.ts), so an
 * English-only stopword list would leave "ka"/"ke"/"hai" polluting every
 * query with near-universal, meaningless matches.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'you', 'your', 'about', 'they', 'their', 'them', 'then',
  'ka', 'ki', 'ke', 'ko', 'hay', 'hai', 'ne', 'se', 'aur', 'wala', 'wali', 'walay',
  'gaya', 'gayi', 'gaye', 'hua', 'hui', 'hue', 'abhi', 'bhi', 'hoga', 'hogi', 'kar',
  'kiya', 'kia', 'raha', 'rahi', 'rahe', 'mein', 'main', 'yeh', 'woh', 'jo', 'toh',
])

function significantWords(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const seen = new Set<string>()
  const result: string[] = []
  for (const word of words) {
    const lower = word.toLowerCase()
    if (word.length < MIN_WORD_LENGTH || STOPWORDS.has(lower) || seen.has(lower)) continue
    seen.add(lower)
    result.push(word)
    if (result.length >= MAX_QUERY_WORDS) break
  }
  return result
}

function contentHashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

interface CandidateAggregate {
  path: string
  score: number
  matchedWords: number
}

export class Compactor {
  constructor(private readonly documents: DocumentStorePort) {}

  compact(scopeId: string): CompactionReport {
    const captures = this.documents
      .list({ scopeId, limit: 5000 })
      .filter(document => document.path.startsWith(CAPTURE_PATH_PREFIX))

    const decisions: CompactionDecision[] = []
    let merged = 0

    for (const capture of captures) {
      const stored = this.documents.read(scopeId, capture.path)
      // Retired or superseded by something else mid-sweep (e.g. an earlier
      // merge in this same pass folded it away already) -- skip safely.
      if (!stored) continue

      const decision = this.decideOne(scopeId, capture.path, capture.title, capture.createdAt, stored.body)
      decisions.push(decision)
      if (decision.outcome === 'merged') merged += 1
    }

    return { scanned: captures.length, merged, leftStandalone: captures.length - merged, decisions }
  }

  private decideOne(
    scopeId: string,
    capturePath: string,
    captureTitle: string,
    captureCreatedAt: string,
    captureBody: string,
  ): CompactionDecision {
    const words = significantWords(`${captureTitle} ${captureBody}`.slice(0, 500))
    const aggregates = new Map<string, CandidateAggregate>()

    for (const word of words) {
      for (const hit of this.documents.search({ scopeId, query: word, limit: 10 })) {
        if (hit.path.startsWith(CAPTURE_PATH_PREFIX)) continue // never merge capture into capture
        const existing = aggregates.get(hit.path)
        if (existing) {
          existing.score += hit.score
          existing.matchedWords += 1
        } else {
          aggregates.set(hit.path, { path: hit.path, score: hit.score, matchedWords: 1 })
        }
      }
    }

    const ranked = [...aggregates.values()].sort((left, right) => right.score - left.score)
    const top = ranked[0] ?? null
    const second = ranked[1] ?? null
    const confident = top !== null
      && top.matchedWords >= MIN_MATCHED_WORDS
      && (second === null || top.score >= second.score * CONFIDENCE_MARGIN)

    if (confident && top) {
      const target = this.documents.read(scopeId, top.path)
      if (target) {
        const mergedBody = [
          target.body,
          '',
          '---',
          `_Folded in from a captured note (${captureCreatedAt}):_`,
          captureBody,
        ].join('\n')
        this.documents.supersede({
          scopeId,
          path: target.document.path,
          type: target.document.type,
          title: target.document.title,
          summary: target.document.summary,
          body: mergedBody,
          origin: target.document.origin,
          contentHash: contentHashOf(mergedBody),
          updatedAt: new Date().toISOString(),
        })
        this.documents.retire(scopeId, capturePath)
        return { capturePath, outcome: 'merged', targetPath: top.path, topScore: top.score, secondScore: second?.score ?? null }
      }
    }

    return { capturePath, outcome: 'left-standalone', targetPath: null, topScore: top?.score ?? null, secondScore: second?.score ?? null }
  }
}
