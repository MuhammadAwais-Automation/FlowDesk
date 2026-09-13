/**
 * Session capture — Brain v2 Phase 2's write gate applied to live Agent turns.
 *
 * runAgentMessage (main.ts) is the one place that sees a full conversation
 * turn (user text in, assistant text + tool calls out). Every turn is worth
 * proposing as knowledge, but AI-inferred content must not become "fact"
 * without review — only what the user typed directly can skip the queue.
 * That's exactly the explicit-vs-inferred split knowledge.proposeCandidate
 * already encodes (see electron/brain/protocol.ts): `explicit-user` origin
 * supersedes straight into knowledge_documents, `machine-inferred` sits in
 * the review queue until a human accepts or rejects it.
 *
 * This module is deliberately dumb — no extra LLM call, no merge/dedupe
 * logic (that's the Phase 3 compactor's job, not this one's). It just turns
 * a turn's text into a proposeCandidate call, or skips it when there's
 * nothing worth proposing. Capture is best-effort: a failure here (the
 * candidate backend not being ready yet, a transient error, whatever) must
 * never break the agent turn it rides along with, so every call is caught
 * and swallowed here rather than left to the caller.
 */

const TITLE_MAX_LENGTH = 60

/**
 * Word-boundary truncation for candidate titles. A local copy rather than an
 * import: the existing helpers with this exact shape (truncateAtWordBoundary
 * in knowledge/vaultImporter.ts, truncateSummary in knowledge/manifest.ts)
 * are both module-private to files owned by sibling Phase 2 packages, so
 * reaching into them would mean either exporting from files this package
 * doesn't own or coupling to their internals. The logic itself is a few
 * lines and has no state, so a local copy is cheaper than either.
 */
function truncateAtWordBoundary(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text
  const prefix = text.slice(0, maximumLength + 1)
  const boundary = prefix.search(/\s+\S*$/)
  return (boundary > 0 ? prefix.slice(0, boundary) : text.slice(0, maximumLength)).trimEnd()
}

function deriveTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const source = firstLine.length > 0 ? firstLine : text.trim()
  return truncateAtWordBoundary(source, TITLE_MAX_LENGTH)
}

export type CaptureOrigin = 'explicit-user' | 'machine-inferred'

export interface ProposeCandidatePayload {
  scopeId: string
  type: 'note'
  title: string
  summary: string
  body: string
  origin: CaptureOrigin
  sessionRef: string
}

/**
 * Matches BrainClient['request']'s signature narrowed to just the one method
 * this module calls, so main.ts's existing `brainRequest` function — typed
 * against the full BrainRequest union — can be passed in directly without
 * this module importing brain/client.ts.
 */
export type BrainRequestFn = (
  method: 'knowledge.proposeCandidate',
  payload: ProposeCandidatePayload,
) => Promise<unknown>

export interface CaptureSessionTurnsInput {
  scopeId: string
  userText: string
  userSessionRef: string
  assistantText: string
  assistantSessionRef: string
  brainRequest: BrainRequestFn
}

async function proposeCandidate(
  brainRequest: BrainRequestFn,
  scopeId: string,
  text: string,
  origin: CaptureOrigin,
  sessionRef: string,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  try {
    await brainRequest('knowledge.proposeCandidate', {
      scopeId,
      type: 'note',
      title: deriveTitle(trimmed),
      summary: '',
      body: trimmed,
      origin,
      sessionRef,
    })
  } catch (error) {
    // Best-effort capture, same convention as recordConversationTurn's own
    // .catch below it in main.ts: log and move on, never break the turn.
    console.log(`[FlowDesk brain] session capture unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Proposes up to two knowledge candidates for one agent turn: the user's
 * message (explicit-user, goes straight in) and the assistant's reply
 * (machine-inferred, goes to the review queue). Either side is skipped when
 * its text is empty or whitespace-only — this also covers a purely
 * tool-call assistant turn, since AgentTurn.content is the model's own final
 * text and is empty when a turn produced only tool calls with nothing said.
 */
export async function captureSessionTurns(input: CaptureSessionTurnsInput): Promise<void> {
  await proposeCandidate(input.brainRequest, input.scopeId, input.userText, 'explicit-user', input.userSessionRef)
  await proposeCandidate(input.brainRequest, input.scopeId, input.assistantText, 'machine-inferred', input.assistantSessionRef)
}
