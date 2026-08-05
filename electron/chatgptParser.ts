/**
 * Text extraction from a ChatGPT backend-api SSE event body.
 *
 * ChatGPT streams a JSON-patch-style protocol. Confirmed shapes (from a live
 * capture — see FD_CAPTURE_DEBUG):
 *   { p: "/message/content/parts/0", o: "append", v: "chunk text" }   — content delta
 *   { v: "chunk text" }                                                — continuation (same path as previous op)
 *   { p: "", o: "add", v: { message: { content: { parts: [...] } } } } — full message add (usually empty on first add)
 *   { p: "", o: "patch", v: [ {p,o,v}, {p,o,v}, ... ] }                — batched ops, e.g. the final
 *                                                                        append is often bundled here with a
 *                                                                        status/end_turn replace
 * "replace" ops on non-content paths (status, end_turn, metadata) must be
 * skipped even though their v is sometimes a string — otherwise values like
 * "finished_successfully" leak into the captured text.
 */
export interface ChatGPTUsageLimit {
  feature: string
  remaining: number
  resetAfter: string
}

/**
 * Pulls the account usage/quota snapshot out of a "conversation_detail_metadata"
 * SSE event (confirmed via a live capture — fires several times per turn,
 * both standalone and inline within the main answer stream). Returns null if
 * this particular event isn't that type, so callers can just skip ahead.
 */
export function extractUsageFromSSEEvent(event: string): ChatGPTUsageLimit[] | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj && obj.type === 'conversation_detail_metadata' && Array.isArray(obj.limits_progress)) {
        return obj.limits_progress.map((l: { feature_name: string; remaining: number; reset_after: string }) => ({
          feature: l.feature_name,
          remaining: l.remaining,
          resetAfter: l.reset_after,
        }))
      }
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return null
}

export interface ChatGPTModelInfo {
  modelSlug: string
  planType: string
  autoSwitchedToReasoning: boolean
  ttfvtMs: number
  clusterRegion: string
}

/**
 * Pulls per-turn model/serving info out of a "server_ste_metadata" SSE event
 * (confirmed via a live capture — fires once near the end of each turn,
 * right after the final content delta).
 */
export function extractModelInfoFromSSEEvent(event: string): ChatGPTModelInfo | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj && obj.type === 'server_ste_metadata' && obj.metadata) {
        const m = obj.metadata
        return {
          modelSlug: m.model_slug,
          planType: m.plan_type,
          autoSwitchedToReasoning: !!m.did_auto_switch_to_reasoning,
          ttfvtMs: m.server_ttfvt_ms,
          clusterRegion: m.cluster_region,
        }
      }
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return null
}

export interface ChatGPTMessageIds {
  conversationId: string
  messageId?: string
}

/**
 * Pulls conversation_id (and, where present, message_id) out of a
 * "message_marker" SSE event (confirmed via a live capture — fires several
 * times per turn: first user-visible token, first final-channel token, last
 * token; every occurrence already carries both ids, so any one is enough).
 */
export function extractIdsFromSSEEvent(event: string): ChatGPTMessageIds | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj && obj.type === 'message_marker' && obj.conversation_id) {
        return { conversationId: obj.conversation_id, messageId: obj.message_id }
      }
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return null
}

export function extractTextFromSSEEvent(event: string): string[] {
  const out: string[] = []
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      collectAppendText(JSON.parse(payload), out)
    } catch {
      // event body was split across a chunk boundary — dropped in this PoC
    }
  }
  return out
}

interface PatchOp {
  p?: string
  o?: string
  v?: unknown
}

function collectAppendText(node: unknown, out: string[]): void {
  if (node == null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) collectAppendText(item, out)
    return
  }

  const op = node as PatchOp

  // Batched patch: recurse into each sub-operation.
  if (op.o === 'patch' && Array.isArray(op.v)) {
    for (const item of op.v) collectAppendText(item, out)
    return
  }

  if (typeof op.v === 'string') {
    // "replace" on a non-content path (status, end_turn, ...) is metadata,
    // not message text — everything else with a string v is content.
    const isMetadataReplace = op.o === 'replace' && !(op.p ?? '').includes('/parts/')
    if (!isMetadataReplace) out.push(op.v)
    return
  }

  if (op.v && typeof op.v === 'object') {
    collectAppendText(op.v, out)
  }

  // Full-message add: { message: { author: { role }, content: { parts: [...] } } }
  // Only assistant turns — ChatGPT also echoes the user's own submitted
  // message back through this same shape, which must not be captured.
  const message = (node as { message?: { author?: { role?: string }; content?: { parts?: unknown } } }).message
  if (message?.author?.role !== 'assistant') return
  const parts = message.content?.parts
  if (Array.isArray(parts)) {
    for (const part of parts) if (typeof part === 'string' && part) out.push(part)
  }
}
