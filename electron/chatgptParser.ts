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

/**
 * Discovery-only. Image generation makes `collectAppendText` return nothing
 * at all — the parts array holds an object (content_type
 * "image_asset_pointer" or similar), not a string, so the existing text
 * extraction has nothing to collect and the caller (browserWorkerQueue.ts)
 * treats the whole turn as an incidental empty completion, which is why an
 * image-generation prompt times out at 60s instead of resolving. This dumps
 * the raw event whenever it looks image-related, so the real shape can be
 * read from a live capture instead of guessed.
 */
export function isLikelyImageEvent(event: string): boolean {
  return /image_asset_pointer|"content_type"\s*:\s*"image|dalle|asset_pointer/i.test(event)
}

export interface ChatGPTImageAsset {
  /** e.g. "sediment://file_000000000d888208ab9c0426384a860b" — the id after the "sediment://" prefix is what /backend-api/files/download/{id} takes. */
  assetPointer: string
  fileId: string
  mimeType: string
  width?: number
  height?: number
  title?: string
  conversationId?: string
}

/**
 * Extracts image parts from a real captured event shape:
 *
 *   { p:"", o:"add", v: { message: { author: {role:"tool"}, content: {
 *     content_type:"multimodal_text",
 *     parts: [{ content_type:"image_asset_pointer",
 *               asset_pointer:"sediment://file_XXXX", mime_type, width, height }]
 *   }, metadata: { image_gen_title } }, conversation_id } }
 *
 * The author role is "tool", NOT "assistant" — `collectAppendText`'s
 * assistant-only check would (correctly, for text) skip this message
 * entirely, which is WHY an image-generation turn was captured as having no
 * text at all. This walks the same patch/add structure but does not apply
 * that role filter, since role "tool" is exactly where an image genuinely
 * lives.
 */
export function extractImageAssetsFromSSEEvent(event: string): ChatGPTImageAsset[] {
  const out: ChatGPTImageAsset[] = []
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      collectImageAssets(JSON.parse(payload), out)
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return out
}

interface RawImagePart {
  content_type?: string
  asset_pointer?: string
  mime_type?: string
  width?: number
  height?: number
}

function collectImageAssets(node: unknown, out: ChatGPTImageAsset[]): void {
  if (node == null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) collectImageAssets(item, out)
    return
  }

  const op = node as PatchOp & {
    message?: { content?: { parts?: unknown }; metadata?: { image_gen_title?: string } }
    conversation_id?: string
  }

  if (op.o === 'patch' && Array.isArray(op.v)) {
    for (const item of op.v) collectImageAssets(item, out)
    return
  }
  if (op.v && typeof op.v === 'object') collectImageAssets(op.v, out)

  const parts = op.message?.content?.parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const p = part as RawImagePart
      if (p && p.content_type === 'image_asset_pointer' && typeof p.asset_pointer === 'string') {
        const fileId = p.asset_pointer.replace(/^sediment:\/\//, '')
        out.push({
          assetPointer: p.asset_pointer,
          fileId,
          mimeType: p.mime_type ?? 'image/png',
          width: p.width,
          height: p.height,
          title: op.message?.metadata?.image_gen_title,
          conversationId: op.conversation_id,
        })
      }
    }
  }
}

/**
 * Tracks which JSON-patch path the stream is currently appending to.
 *
 * Needed because a continuation op carries no path of its own - it is
 * `{ v: "chunk" }` and inherits the previous op's path, which can sit in an
 * earlier network chunk entirely. Callers that process a stream chunk by
 * chunk (electron/main.ts's capture:chunk handler) must pass the SAME object
 * across every event of one response, or a continuation arriving first in a
 * chunk would be misattributed.
 */
export interface ChatGPTTextState {
  /** Last explicit `p` seen. '' before any op, matching a fresh message add. */
  path: string
}

/**
 * Only `/message/content/parts/...` holds the answer the user actually sees.
 *
 * Confirmed against a real image-generation capture: the assistant's call to
 * the image tool is a separate message with `recipient: "t2uay3k.sj1i4kz"`,
 * `content_type: "code"`, and its arguments streamed to
 * `/message/content/text`. Without this check that arguments JSON
 * (`{"size":"1024x1024","n":1,...}`) was collected as if it were the reply,
 * and the agent received it verbatim in place of the generated image.
 */
function isUserFacingPath(path: string): boolean {
  return path.includes('/parts/')
}

export function extractTextFromSSEEvent(event: string, state?: ChatGPTTextState): string[] {
  const cursorInit = state ?? { path: '' }
  const out: string[] = []
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      collectAppendText(JSON.parse(payload), out, cursorInit)
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

function collectAppendText(node: unknown, out: string[], cursor: ChatGPTTextState): void {
  if (node == null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) collectAppendText(item, out, cursor)
    return
  }

  const op = node as PatchOp

  // An explicit path moves the cursor; ops without one continue the last.
  if (typeof op.p === 'string') cursor.path = op.p

  // Batched patch: recurse into each sub-operation.
  if (op.o === 'patch' && Array.isArray(op.v)) {
    for (const item of op.v) collectAppendText(item, out, cursor)
    return
  }

  if (typeof op.v === 'string') {
    // Content lives only under /parts/. A "replace" elsewhere is metadata
    // (status, end_turn); an "append" elsewhere is a tool call's arguments.
    // Neither one is the answer.
    if (isUserFacingPath(cursor.path)) out.push(op.v)
    return
  }

  if (op.v && typeof op.v === 'object') {
    collectAppendText(op.v, out, cursor)
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
