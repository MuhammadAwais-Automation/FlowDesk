/**
 * Text extraction from a chat.qwen.ai /api/v2/chat/completions SSE event body.
 *
 * Confirmed via a live capture (see FD_CAPTURE_DEBUG). Unlike ChatGPT's
 * JSON-patch protocol, Qwen streams a flat OpenAI-Chat-Completions-shaped
 * delta per event:
 *   data: {"choices":[{"delta":{"role":"assistant","content":"chunk","phase":"answer","status":"typing"}}],"response_id":"...","usage":{...}}
 * Each turn actually streams TWO phases through the same shape:
 *   - "thinking_summary": Qwen's visible chain-of-thought summary. `content`
 *     is always empty here; the real summary text lives in
 *     `delta.extra.summary_title` / `delta.extra.summary_thought` instead
 *     (see extractThinkingSummaryFromSSEEvent). Must be skipped when
 *     collecting the answer, or the empty `content` would just contribute
 *     nothing — but the risk is a *future* server change putting real text
 *     in `content` during this phase, which would wrongly leak thinking
 *     text into the answer if phase weren't checked.
 *   - "answer": the actual reply, delivered as incremental `content` deltas.
 * A final event with `status: "finished"` and no `usage` field closes the
 * stream (no `[DONE]` sentinel like ChatGPT/Claude).
 */
export function extractTextFromSSEEvent(event: string): string[] {
  const out: string[] = []
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue
    try {
      const obj = JSON.parse(payload)
      const delta = obj?.choices?.[0]?.delta
      if (delta?.phase === 'answer' && typeof delta.content === 'string' && delta.content) {
        out.push(delta.content)
      }
    } catch {
      // event body was split across a chunk boundary — dropped, same as the other parsers
    }
  }
  return out
}

export interface QwenThinkingSummary {
  title?: string
  thought?: string
}

/**
 * Pulls Qwen's visible chain-of-thought summary out of the
 * "thinking_summary" phase events — a feature not seen on any other
 * provider captured so far (Claude has an equivalent "thinking" content
 * block, but it arrived empty in every capture taken; Qwen's is populated).
 */
export function extractThinkingSummaryFromSSEEvent(event: string): QwenThinkingSummary | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue
    try {
      const obj = JSON.parse(payload)
      const delta = obj?.choices?.[0]?.delta
      if (delta?.phase === 'thinking_summary' && delta.extra) {
        const title = delta.extra.summary_title?.content?.[0]
        const thought = delta.extra.summary_thought?.content?.[0]
        if (typeof title === 'string' || typeof thought === 'string') {
          return { title, thought }
        }
      }
    } catch {
      // event body was split across a chunk boundary — skip
    }
  }
  return null
}

export interface QwenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens?: number
}

/**
 * Pulls the running token-usage snapshot out of a Qwen SSE event — unlike
 * ChatGPT/Claude's quota percentages, this is a per-turn token count
 * (updated on nearly every chunk as output_tokens climbs), not an
 * account-wide rate limit.
 */
export function extractUsageFromSSEEvent(event: string): QwenUsage | null {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue
    try {
      const obj = JSON.parse(payload)
      const usage = obj?.usage
      if (usage && typeof usage.input_tokens === 'number') {
        return {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.total_tokens,
          reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
        }
      }
    } catch {
      // event body was split across a chunk boundary — skip
    }
  }
  return null
}
