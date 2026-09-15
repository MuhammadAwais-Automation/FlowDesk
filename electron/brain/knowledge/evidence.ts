/**
 * The retrieval ladder: turns a question into assembled evidence using only
 * code, so the model is invoked once, at the end, with the answer already in
 * front of it.
 *
 * Today's agent path costs a model turn per step — search, then read a whole
 * 4,000-token document, then maybe read another. Almost none of that needs
 * intelligence. The rungs below are the cheap version:
 *
 *   1. strip the question to its topic words
 *   2. score every document from the index, opening none of them
 *   3. open the single best document when the margin is clear
 *   4. take only the section that answers, verbatim
 *   5. follow one link if that section only points elsewhere
 *   6. assemble to a token budget
 *
 * Verbatim is deliberate: extracted or summarised evidence measures worse than
 * the original passage (arXiv 2601.00821), besides costing a model call to
 * produce.
 */

import type { DatabaseSync } from 'node:sqlite'
import { type DocumentStore, shadowByNearestScope } from './documents'

type SqlRow = Record<string, unknown>

/**
 * BM25 column weights for `knowledge_fts(document_id UNINDEXED, title, summary, body)`.
 *
 * The UNINDEXED column does occupy a weight slot — verified against
 * `node:sqlite`, where passing three weights instead of four shifts every
 * score — so the leading 0.0 is what keeps `title` on 8.0. A title match is the
 * strongest signal a person-or-project question has.
 */
const BM25_WEIGHTS = '0.0, 8.0, 4.0, 1.0'

/** Top-1 must beat the runner-up by this much before we trust it alone. */
export const STRONG_SIGNAL_RATIO = 1.5
/** ...and must actually match this many distinct question terms. */
export const MIN_QUERY_TERMS = 2
/** How many documents rung 4 ranks sections across when the gate does not pass. */
export const CANDIDATE_DOCS = 5
/** A section shorter than this that names a link is treated as a pointer. */
export const POINTER_MAX_WORDS = 40
export const DEFAULT_EVIDENCE_TOKEN_BUDGET = 1200
export const DEFAULT_MAX_SECTIONS = 6
/** Sections shorter than this are scored as if this long, so a link stub
 *  cannot out-rank a real passage on density alone. */
export const SECTION_LENGTH_FLOOR = 25
/** Score for a document that matched the question but whose sections did not,
 *  so it ranks below any real section match without disappearing. */
const UNMATCHED_DOCUMENT_SCORE = 0.01

/**
 * Words that carry no topic, in the two languages questions actually arrive in.
 * The English half mirrors `decisionBrief.ts`; the Roman Urdu/Hinglish half is
 * the reason a question like "tum mere baray mein kya jaante ho" does not
 * retrieve every document containing "mein".
 */
const STOPWORDS = new Set([
  'and', 'are', 'but', 'can', 'for', 'from', 'has', 'have', 'how', 'its', 'not', 'our', 'out',
  'should', 'shall', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'was', 'were', 'what', 'when', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'your', 'about', 'into', 'more', 'need', 'now', 'over', 'than', 'want', 'does', 'did', 'been',
  'being', 'also', 'any', 'all', 'let', 'get', 'got',
  'kya', 'kia', 'kaun', 'kon', 'kaise', 'kaisay', 'kahan', 'kab', 'kyun', 'kyu',
  'mein', 'may', 'mera', 'meri', 'mere', 'meray', 'tum', 'tumhara', 'aap', 'aapka', 'aapke',
  'hai', 'hay', 'hain', 'tha', 'thi', 'thay', 'karo', 'karna', 'karta', 'karte', 'kar',
  'jaante', 'jante', 'janty', 'jantay', 'bata', 'batao', 'baray', 'bare', 'mujhe', 'mujhay',
  'abhi', 'phir', 'bhi', 'nahi', 'nahin', 'haan', 'sab', 'saray', 'sare', 'apna', 'apni',
])

function questionTerms(text: string): string[] {
  const seen = new Set<string>()
  for (const term of text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (!STOPWORDS.has(term)) seen.add(term)
  }
  return [...seen]
}

/**
 * `("a" OR "b" OR "c")` — any term, not all of them.
 *
 * `documents.ts`'s `safeFtsQuery` joins terms with an implicit AND, which is
 * right for a search box but wrong for a question: "Yasir ka rate kya hai"
 * would require every word to appear in one document. That function is left
 * alone so `search()` keeps behaving as its tests expect.
 */
function ftsAnyQuery(terms: string[]): string {
  return `(${terms.map(term => `"${term}"`).join(' OR ')})`
}

function countTermHits(haystack: string, terms: string[]): number {
  const lowered = haystack.toLocaleLowerCase()
  return terms.filter(term => lowered.includes(term)).length
}

function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface AnswerPackInput {
  scopeIds: string[]
  question: string
  tokenBudget?: number
  maxSections?: number
}

export interface AnswerPackSection {
  path: string
  title: string
  headingPath: string
  text: string
  score: number
}

export interface AnswerPack {
  question: string
  /** The text to hand the model. Never empty — see `NO_EVIDENCE`. */
  evidence: string
  sections: AnswerPackSection[]
  pointerFollowed: { from: string; to: string } | null
  strategy: 'strong-signal' | 'ranked' | 'fuzzy' | 'none'
  estimatedTokens: number
  candidatesConsidered: number
}

const NO_EVIDENCE = 'No local knowledge matched this question.'

interface CandidateDocument {
  id: string
  path: string
  title: string
  score: number
}

export class EvidenceRetriever {
  constructor(private readonly db: DatabaseSync, private readonly documents: DocumentStore) {}

  answerPack(input: AnswerPackInput): AnswerPack {
    const tokenBudget = input.tokenBudget ?? DEFAULT_EVIDENCE_TOKEN_BUDGET
    const maxSections = input.maxSections ?? DEFAULT_MAX_SECTIONS
    const terms = questionTerms(input.question)

    if (input.scopeIds.length === 0 || terms.length === 0) {
      return this.empty(input.question, 'none')
    }

    // Rung 2 — score every candidate from the index, opening nothing.
    let strategy: AnswerPack['strategy'] = 'ranked'
    let candidates = this.scoreCandidates(terms, input.scopeIds)
    if (candidates.length === 0) {
      // Nothing matched a whole token, which is usually a spelling variant --
      // "yaseer" for "yasir". `search()` already owns the edit-distance
      // fallback for exactly this, so reuse it rather than growing a second one.
      candidates = this.fuzzyCandidates(input, terms)
      if (candidates.length === 0) return this.empty(input.question, 'none')
      strategy = 'fuzzy'
    }

    // Rung 3 — one document when the margin is clear, a handful otherwise.
    const strongSignal = strategy === 'ranked' && this.hasStrongSignal(candidates, terms)
    const considered = strongSignal ? candidates.slice(0, 1) : candidates.slice(0, CANDIDATE_DOCS)

    // Rung 4 — rank sections within those documents.
    let sections = this.rankSections(considered, terms, maxSections)
    let pointerFollowed: AnswerPack['pointerFollowed'] = null

    // Rung 5 — follow one pointer, once, when the best section only redirects.
    const pointer = sections.length > 0 ? this.pointerTarget(sections[0], input.scopeIds) : null
    if (pointer) {
      // The target usually does not repeat the question's words — an index page
      // saying "see [[yasir-bhai]]" sends you somewhere that never says
      // "clients". The link itself is the relevance signal, so fall back to
      // reading the target from the top.
      const ranked = this.rankSections([pointer.document], terms, maxSections)
      const followed = ranked.length > 0 ? ranked : this.leadingSections(pointer.document, maxSections)
      if (followed.length > 0) {
        pointerFollowed = { from: sections[0].path, to: pointer.document.path }
        sections = [...followed, ...sections].slice(0, maxSections)
      }
    }

    if (sections.length === 0) return this.empty(input.question, 'none')

    // Rung 6 — assemble to budget.
    const kept: AnswerPackSection[] = []
    const blocks: string[] = []
    let used = 0
    for (const section of sections) {
      const block = `${section.path}#${section.headingPath}\n${section.text}`
      const cost = estimateTokens(block)
      if (kept.length > 0 && used + cost > tokenBudget) continue
      kept.push(section)
      blocks.push(block)
      used += cost
    }

    const evidence = blocks.join('\n\n---\n\n')
    return {
      question: input.question,
      evidence,
      sections: kept,
      pointerFollowed,
      strategy: strongSignal ? 'strong-signal' : strategy,
      estimatedTokens: estimateTokens(evidence),
      candidatesConsidered: candidates.length,
    }
  }

  private empty(question: string, strategy: AnswerPack['strategy']): AnswerPack {
    return {
      question,
      evidence: NO_EVIDENCE,
      sections: [],
      pointerFollowed: null,
      strategy,
      estimatedTokens: estimateTokens(NO_EVIDENCE),
      candidatesConsidered: 0,
    }
  }

  /** Spelling-variant rescue, borrowed from `search()` rather than duplicated. */
  private fuzzyCandidates(input: AnswerPackInput, terms: string[]): CandidateDocument[] {
    const hits = this.documents.search({ scopeIds: input.scopeIds, query: terms.join(' '), limit: CANDIDATE_DOCS })
    if (hits.length === 0) return []
    const placeholders = hits.map(() => '?').join(', ')
    const scopePlaceholders = input.scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT id, path, title FROM knowledge_documents
      WHERE path IN (${placeholders}) AND scope_id IN (${scopePlaceholders}) AND valid_to IS NULL
    `).all(...hits.map(hit => hit.path), ...input.scopeIds) as SqlRow[]
    const byPath = new Map(rows.map(row => [String(row.path), row]))
    return hits.flatMap((hit, index) => {
      const row = byPath.get(hit.path)
      if (!row) return []
      // Rank by search order; the raw fuzzy similarity is not comparable to BM25.
      return [{ id: String(row.id), path: String(row.path), title: String(row.title), score: hits.length - index }]
    })
  }

  private scoreCandidates(terms: string[], scopeIds: string[]): CandidateDocument[] {
    const placeholders = scopeIds.map(() => '?').join(', ')
    // Over-fetch before shadowing: a nearer scope's copy of a path must be able
    // to displace an ancestor's without shrinking the candidate set.
    const rows = this.db.prepare(`
      SELECT d.id AS id, d.path AS path, d.title AS title, d.scope_id AS scope_id,
             -bm25(knowledge_fts, ${BM25_WEIGHTS}) AS score
      FROM knowledge_fts
      JOIN knowledge_documents d ON d.id = knowledge_fts.document_id
      WHERE knowledge_fts MATCH ? AND d.scope_id IN (${placeholders}) AND d.valid_to IS NULL
      ORDER BY bm25(knowledge_fts, ${BM25_WEIGHTS})
      LIMIT ?
    `).all(ftsAnyQuery(terms), ...scopeIds, CANDIDATE_DOCS * 4) as SqlRow[]

    return shadowByNearestScope(rows, scopeIds).map(row => ({
      id: String(row.id),
      path: String(row.path),
      title: String(row.title),
      score: Number(row.score),
    }))
  }

  /**
   * qmd's idea: when the top hit clearly wins, stop laddering and use it. Both
   * halves matter — a wide margin over a single coincidental term match is
   * still a coincidence, so the winner must also cover the question.
   */
  private hasStrongSignal(candidates: CandidateDocument[], terms: string[]): boolean {
    const best = candidates[0]
    const matched = countTermHits(`${best.path} ${best.title}`, terms)
    if (matched < Math.min(MIN_QUERY_TERMS, terms.length)) return false
    if (candidates.length === 1) return true
    return best.score >= STRONG_SIGNAL_RATIO * candidates[1].score
  }

  private rankSections(documents: CandidateDocument[], terms: string[], limit: number): AnswerPackSection[] {
    if (documents.length === 0) return []
    const byId = new Map(documents.map(document => [document.id, document]))
    const placeholders = documents.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT document_id, heading, heading_path, text
      FROM knowledge_sections
      WHERE document_id IN (${placeholders})
      ORDER BY document_id, ordinal
    `).all(...documents.map(document => document.id)) as SqlRow[]

    // Rung 2's judgement carries into rung 4: without this a three-word "see
    // [[somewhere]]" stub in a weakly-matching index page outranks the real
    // answer in the document BM25 actually chose.
    const bestDocumentScore = Math.max(...documents.map(document => document.score), 0)

    const scored: AnswerPackSection[] = []
    const matched = new Set<string>()
    for (const row of rows) {
      const document = byId.get(String(row.document_id))
      if (!document) continue
      const text = String(row.text)
      const termsHere = this.discriminatingTerms(document, terms)
      // The section's own heading, not the inherited `heading_path`: every
      // section of "Yasir Bhai" carries that h1, so matching it ranks the
      // whole document flat instead of picking the part that answers.
      const hits = countTermHits(String(row.heading), termsHere) * 5 + countTermHits(text, termsHere)
      // The length floor stops a stub winning purely for being short.
      const density = hits / Math.sqrt(Math.max(wordCount(text), SECTION_LENGTH_FLOOR))
      const documentWeight = bestDocumentScore > 0 ? Math.max(document.score / bestDocumentScore, 0.1) : 1
      const score = density * documentWeight
      if (hits <= 0) continue
      matched.add(document.id)
      scored.push({ path: document.path, title: document.title, headingPath: String(row.heading_path), text, score })
    }

    // A document can match the question through its title or path and then have
    // no section repeating those words — "oracle box par kya chal raha hai"
    // picks the Oracle page, whose sections never say "oracle". Dropping it
    // would throw away the document rung 2 deliberately chose, so fall back to
    // reading it from the top, ranked below anything that matched outright.
    for (const document of documents) {
      if (matched.has(document.id)) continue
      const weight = bestDocumentScore > 0 ? Math.max(document.score / bestDocumentScore, 0.1) : 1
      for (const section of this.leadingSections(document, limit)) {
        scored.push({ ...section, score: weight * UNMATCHED_DOCUMENT_SCORE })
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Drops the terms that merely name the document, because rung 2 already used
   * them to choose it. For "Yasir ka retainer kitna hai", `yasir` appears in
   * every section of the Yasir page and so separates none of them; `retainer`
   * is the term that actually points at one.
   *
   * When every term names the document, the document itself is the answer —
   * keep them all rather than scoring nothing.
   */
  private discriminatingTerms(document: CandidateDocument, terms: string[]): string[] {
    const identity = `${document.path} ${document.title}`.toLocaleLowerCase()
    const discriminating = terms.filter(term => !identity.includes(term))
    return discriminating.length > 0 ? discriminating : terms
  }

  /** The document's opening sections, for a target reached by following a link. */
  private leadingSections(document: CandidateDocument, limit: number): AnswerPackSection[] {
    const rows = this.db.prepare(`
      SELECT heading_path, text FROM knowledge_sections
      WHERE document_id = ? ORDER BY ordinal LIMIT ?
    `).all(document.id, limit) as SqlRow[]
    return rows.map(row => ({
      path: document.path,
      title: document.title,
      headingPath: String(row.heading_path),
      text: String(row.text),
      score: 0,
    }))
  }

  /**
   * A short section whose substance is a link is a redirect, not an answer.
   * Resolving it once is the difference between "see the client page" and the
   * client page itself; more than once is a crawl, which is what this replaces.
   */
  private pointerTarget(
    section: AnswerPackSection,
    scopeIds: string[],
  ): { document: CandidateDocument } | null {
    if (wordCount(section.text) > POINTER_MAX_WORDS) return null
    const placeholders = scopeIds.map(() => '?').join(', ')
    const row = this.db.prepare(`
      SELECT target.id AS id, target.path AS path, target.title AS title
      FROM knowledge_documents source
      JOIN knowledge_links link ON link.document_id = source.id AND link.resolved = 1
      JOIN knowledge_documents target
        ON target.path = link.target_path AND target.scope_id = source.scope_id AND target.valid_to IS NULL
      WHERE source.path = ? AND source.scope_id IN (${placeholders}) AND source.valid_to IS NULL
      LIMIT 1
    `).get(section.path, ...scopeIds) as SqlRow | undefined
    if (!row) return null
    return { document: { id: String(row.id), path: String(row.path), title: String(row.title), score: 0 } }
  }
}
