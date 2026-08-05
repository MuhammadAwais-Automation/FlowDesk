/**
 * Text extraction from a Perplexity /rest/sse/perplexity_ask response.
 *
 * Confirmed via a live capture — standard SSE (`event: message` / `data:
 * {...}`, ending `event: end_of_stream`). Each data payload carries a
 * `blocks` array; the block with `intended_usage: "workflow_root"` holds
 * either:
 *   - `diff_block.patches`: JSON-patch ops, where `{op:"add", path:
 *     ".../chunks/N", value:"text"}` is an incremental delta — used here
 *     for live preview only, and
 *   - `workflow_block`: present on the final message before
 *     end_of_stream, with the FULL resolved answer at
 *     steps[0].items[0].payload.text_payload.text — authoritative, and
 *     overrides whatever the deltas reconstructed (mirrors Gemini's
 *     replace-on-latest-snapshot approach as a safety net against any gap
 *     in the incremental reconstruction, e.g. if the stream was aborted
 *     and resumed).
 */
export interface PerplexityExtraction {
  deltas: string[]
  finalText: string | null
}

export function extractPerplexitySSEEvent(event: string): PerplexityExtraction {
  const deltas: string[] = []
  let finalText: string | null = null

  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue

    let obj: unknown
    try {
      obj = JSON.parse(payload)
    } catch {
      continue
    }

    const blocks = (obj as { blocks?: unknown } | null)?.blocks
    if (!Array.isArray(blocks)) continue

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue
      const b = block as { intended_usage?: string; diff_block?: unknown; workflow_block?: unknown }
      if (b.intended_usage !== 'workflow_root') continue

      const diff = b.diff_block as { patches?: unknown } | undefined
      if (Array.isArray(diff?.patches)) {
        for (const patch of diff.patches) {
          if (!patch || typeof patch !== 'object') continue
          const p = patch as { op?: string; path?: string; value?: unknown }

          // Incremental delta: {op:"add", path:".../chunks/N", value:"text"}
          if (p.op === 'add' && typeof p.path === 'string' && /\/chunks\/\d+$/.test(p.path) && typeof p.value === 'string') {
            deltas.push(p.value)
            continue
          }

          // Bootstrap replace: {op:"replace", path:"", value:{...whole workflow_block...}}
          // — the first content-bearing event uses this shape rather than an
          // add-patch. Its text_payload.text is still empty at this point
          // (that only fills in on the final snapshot); the actual first
          // chunk of text lives in text_payload.chunks[0].
          if (p.op === 'replace' && p.path === '') {
            for (const chunk of extractWorkflowChunks(p.value)) deltas.push(chunk)
          }
        }
      }

      const text = extractWorkflowFinalText(b.workflow_block)
      if (text) finalText = text
    }
  }

  return { deltas, finalText }
}

function extractWorkflowFinalText(workflowBlock: unknown): string | null {
  const textPayload = firstTextPayload(workflowBlock)
  const text = textPayload?.text
  return typeof text === 'string' && text ? text : null
}

/** The bootstrap event's text_payload.text is still empty — only .chunks[0] has content at that point. */
function extractWorkflowChunks(workflowBlock: unknown): string[] {
  const textPayload = firstTextPayload(workflowBlock)
  const chunks = textPayload?.chunks
  if (!Array.isArray(chunks)) return []
  return chunks.filter((c): c is string => typeof c === 'string')
}

function firstTextPayload(workflowBlock: unknown): { text?: unknown; chunks?: unknown } | null {
  if (!workflowBlock || typeof workflowBlock !== 'object') return null
  const steps = (workflowBlock as { steps?: unknown }).steps
  if (!Array.isArray(steps) || steps.length === 0) return null
  const items = (steps[0] as { items?: unknown } | undefined)?.items
  if (!Array.isArray(items)) return null
  for (const item of items) {
    const payload = (item as { payload?: { text_payload?: unknown } } | undefined)?.payload?.text_payload
    if (payload && typeof payload === 'object') return payload as { text?: unknown; chunks?: unknown }
  }
  return null
}
