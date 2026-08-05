/**
 * Text extraction from a claude.ai completion SSE event body.
 *
 * Confirmed via a live capture (see FD_CAPTURE_DEBUG in main.ts): claude.ai's
 * web app streams the documented Anthropic Messages API shape verbatim —
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"chunk"}}
 * A "thinking" content block (empty on simple turns) precedes the "text"
 * block; its content is intentionally not captured here (see
 * extractModelInfoFromSSEEvent for the other event types seen in the stream).
 */
export function extractTextFromClaudeSSEEvent(event: string): string[] {
  const out: string[] = []
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      collectDeltaText(JSON.parse(payload), out)
    } catch {
      // event body was split across a chunk boundary — dropped in this PoC
    }
  }
  return out
}

function collectDeltaText(node: unknown, out: string[]): void {
  if (node == null || typeof node !== 'object') return
  const obj = node as {
    type?: string
    delta?: { type?: string; text?: string }
    completion?: string
  }

  // Documented Anthropic Messages API shape.
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string') {
    out.push(obj.delta.text)
    return
  }

  // Older/legacy claude.ai completion shape seen in some captures: a flat
  // { completion: "chunk" } per event rather than content_block_delta.
  if (typeof obj.completion === 'string' && obj.completion.length > 0) {
    out.push(obj.completion)
  }
}

export interface ClaudeModelInfo {
  model: string
  stopReason: string | null
}

/**
 * Pulls the model name out of "message_start" and the completion reason out
 * of "message_delta" (confirmed via a live capture — these are two separate
 * events in the same stream, so this returns whichever one this particular
 * event body is; callers should merge across the stream like main.ts does).
 */
export function extractModelInfoFromSSEEvent(event: string): Partial<ClaudeModelInfo> | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj?.type === 'message_start' && obj.message?.model) {
        return { model: obj.message.model }
      }
      if (obj?.type === 'message_delta' && obj.delta?.stop_reason !== undefined) {
        return { stopReason: obj.delta.stop_reason }
      }
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return null
}

export interface ClaudeUsageWindow {
  window: string
  status: string
  utilization: number
  resetsAt: number | null
}

/**
 * Pulls the rolling usage-quota snapshot out of a "message_limit" SSE event
 * (confirmed via a live capture — fires once near the end of each turn).
 * claude.ai tracks two rolling windows (5h and 7d) rather than ChatGPT's
 * per-feature counters.
 */
export function extractUsageFromSSEEvent(event: string): ClaudeUsageWindow[] | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      const windows = obj?.type === 'message_limit' ? obj.message_limit?.windows : null
      if (windows && typeof windows === 'object') {
        return Object.entries(windows as Record<string, { status: string; utilization: number; resets_at: number | null }>)
          .map(([window, w]) => ({ window, status: w.status, utilization: w.utilization, resetsAt: w.resets_at }))
      }
    } catch {
      // event body was split across a chunk boundary — skip, same as text extraction
    }
  }
  return null
}
