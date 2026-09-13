import type { DocumentReadResult, DocumentSearchHit, KnowledgeDocType } from '../../src/types/brainKnowledge'

export type BrainNavigationMethod = 'knowledge.read' | 'knowledge.search'
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
