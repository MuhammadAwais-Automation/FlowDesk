import type { DocumentReadResult, DocumentSearchHit, KnowledgeDocType } from '../../src/types/brainKnowledge'

export type BrainNavigationMethod = 'knowledge.read' | 'knowledge.search' | 'knowledge.answerPack' | 'knowledge.neighbors'
export type BrainNavigationRequest = (method: BrainNavigationMethod, payload: unknown) => Promise<unknown>

export const BRAIN_UNAVAILABLE_MESSAGE = 'Brain is unavailable right now.'
export const DOCUMENT_TOKEN_CEILING = 4000

const KNOWLEDGE_TYPES = new Set<KnowledgeDocType>([
  'note', 'project', 'client', 'person', 'decision', 'skill', 'source', 'me', 'research',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isKnowledgeType(value: unknown): value is KnowledgeDocType {
  return typeof value === 'string' && KNOWLEDGE_TYPES.has(value as KnowledgeDocType)
}

function isDocument(value: unknown): value is DocumentReadResult {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.title === 'string'
    && isKnowledgeType(value.type)
    && typeof value.text === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.estimatedTokens === 'number'
    && typeof value.truncated === 'boolean'
}

function isSearchHit(value: unknown): value is DocumentSearchHit {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.title === 'string'
    && isKnowledgeType(value.type)
    && typeof value.snippet === 'string'
    && typeof value.score === 'number'
    && typeof value.updatedAt === 'string'
}

function isSafeDocumentPath(path: string) {
  return path.trim().length > 0
    && !path.split(/[\\/]/).includes('..')
    && !path.startsWith('/')
    && !path.startsWith('\\')
    && !/^[A-Za-z]:/.test(path)
}

function oneLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export async function readBrainDocument(
  request: BrainNavigationRequest,
  scopeId: string,
  path: string,
  tokenCeiling = DOCUMENT_TOKEN_CEILING,
): Promise<string> {
  if (!isSafeDocumentPath(path)) return 'Refused unsafe document path. Use a vault-relative path without traversal.'

  try {
    const response = await request('knowledge.read', { scopeId, path, tokenBudget: tokenCeiling })
    if (response === null) return `Document path "${path}" does not exist. Use brain_search_documents to find the right path.`
    if (!isDocument(response)) return BRAIN_UNAVAILABLE_MESSAGE

    const characterCeiling = tokenCeiling * 4
    const locallyTruncated = response.text.length > characterCeiling
    const text = locallyTruncated ? response.text.slice(0, characterCeiling) : response.text
    const truncationNotice = locallyTruncated
      ? `\n\n[Truncated to the first ${tokenCeiling.toLocaleString('en-US')} estimated tokens; approximately ${Math.ceil((response.text.length - characterCeiling) / 4).toLocaleString('en-US')} tokens omitted.]`
      : response.truncated
        ? `\n\n[Brain truncated this document to the ${tokenCeiling.toLocaleString('en-US')}-token ceiling; this is not the complete document.]`
        : ''

    return `${response.title} (${response.type})\nPath: ${response.path}\n\n${text}${truncationNotice}`
  } catch {
    return BRAIN_UNAVAILABLE_MESSAGE
  }
}

export async function searchBrainDocuments(
  request: BrainNavigationRequest,
  scopeId: string,
  query: string,
  limit = 10,
): Promise<string> {
  const clampedLimit = Math.max(1, Math.min(20, Math.trunc(limit)))
  try {
    const response = await request('knowledge.search', { scopeId, query, limit: clampedLimit })
    if (!Array.isArray(response) || !response.every(isSearchHit)) return BRAIN_UNAVAILABLE_MESSAGE
    if (response.length === 0) return `No matches found for "${query}".`
    return response.map(hit => `${hit.path} | ${hit.type} | ${oneLine(hit.title)}\n  ${oneLine(hit.snippet)}`).join('\n')
  } catch {
    return BRAIN_UNAVAILABLE_MESSAGE
  }
}

function isAnswerPack(value: unknown): value is {
  evidence: string
  sections: { path: string; headingPath: string }[]
  pointerFollowed: { from: string; to: string } | null
  strategy: string
} {
  return isRecord(value)
    && typeof value.evidence === 'string'
    && Array.isArray(value.sections)
    && value.sections.every(section => isRecord(section) && typeof section.path === 'string' && typeof section.headingPath === 'string')
}

/**
 * One call, one answer's worth of evidence.
 *
 * The search-then-read-then-read pattern the other two functions support costs
 * a model turn per step and usually delivers whole documents. This hands back
 * the passages themselves, already chosen and budgeted by code, so the model
 * can answer immediately — with the source paths it must cite.
 */
export async function assembleBrainEvidence(
  request: BrainNavigationRequest,
  scopeId: string,
  question: string,
  tokenBudget?: number,
): Promise<string> {
  try {
    const response = await request('knowledge.answerPack', {
      scopeId,
      question,
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
    })
    if (!isAnswerPack(response)) return BRAIN_UNAVAILABLE_MESSAGE
    if (response.sections.length === 0) return response.evidence

    const cited = response.sections.map(section => `${section.path}#${section.headingPath}`).join(', ')
    const trail = response.pointerFollowed
      ? `\nFollowed a link from ${response.pointerFollowed.from} to ${response.pointerFollowed.to}.`
      : ''
    return `${response.evidence}\n\n[Evidence from: ${cited}. Cite these paths when you use them.${trail}]`
  } catch {
    return BRAIN_UNAVAILABLE_MESSAGE
  }
}

function isNeighborhood(value: unknown): value is {
  origin: string
  nodes: { path: string; title: string; type: string; depth: number }[]
  edges: { from: string; to: string }[]
} {
  return isRecord(value)
    && typeof value.origin === 'string'
    && Array.isArray(value.nodes)
    && value.nodes.every(node => isRecord(node) && typeof node.path === 'string' && typeof node.depth === 'number')
}

/**
 * What a document connects to, one or two hops out.
 *
 * The evidence for graphs helping is about an agent walking links to retrieve,
 * not a person looking at a picture of the whole vault — so this is a tool, and
 * the vault-wide view was deliberately not built.
 */
export async function readBrainNeighbors(
  request: BrainNavigationRequest,
  scopeId: string,
  path: string,
  depth = 1,
): Promise<string> {
  if (!isSafeDocumentPath(path)) return 'Refused unsafe document path. Use a vault-relative path without traversal.'
  try {
    const response = await request('knowledge.neighbors', { scopeId, path, depth })
    if (!isNeighborhood(response)) return BRAIN_UNAVAILABLE_MESSAGE
    const others = response.nodes.filter(node => node.path !== response.origin)
    if (others.length === 0) return `${path} links to nothing, and nothing links to it.`
    const lines = others
      .sort((left, right) => left.depth - right.depth || (left.path < right.path ? -1 : 1))
      .map(node => `${node.path} | ${node.type} | ${oneLine(node.title)} | ${node.depth} hop${node.depth === 1 ? '' : 's'}`)
    return [`Documents connected to ${path}:`, ...lines].join('\n')
  } catch {
    return BRAIN_UNAVAILABLE_MESSAGE
  }
}
