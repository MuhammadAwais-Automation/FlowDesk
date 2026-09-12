/**
 * The single interlock that says "an Agent turn owns this process right now".
 *
 * One shared slot holds the running turn's `AbortController`: a new interactive
 * turn aborts whatever is in it, and the monitor continuation drain refuses to
 * start while it is filled. That makes filling it and emptying it a pair that
 * must never come apart — a filled slot with no running turn stops every
 * monitor resume and leaves the renderer watching a run that never finishes.
 *
 * Keeping the pair here means the claim cannot drift away from the `finally`
 * that releases it as the turn setup grows: everything between the two is
 * inside `body`, whatever it is and however it fails.
 */
export interface AgentAbortSlotHandlers {
  /** Stores the controller as the turn that owns the process. */
  claim: (controller: AbortController) => void
  /** Empties the slot, but only if this turn still owns it. */
  release: (controller: AbortController) => void
  /** Reports a failed turn: published to the renderer and finishes the run. */
  onError: (error: unknown) => void
  /** Per-turn teardown that must happen on every exit path. */
  onSettle: () => void
}

/**
 * Runs one Agent turn with the abort slot held for exactly its duration.
 *
 * Resolves `true` on both success and handled failure — a failure is reported
 * through `onError` (the numbered agent event channel) rather than by
 * rejecting, so a turn that fails is a turn that ended, not a turn that is
 * still running.
 */
export async function withAgentAbortSlot(
  controller: AbortController,
  handlers: AgentAbortSlotHandlers,
  body: () => Promise<void>,
): Promise<true> {
  handlers.claim(controller)
  try {
    await body()
  } catch (error) {
    handlers.onError(error)
  } finally {
    handlers.release(controller)
    handlers.onSettle()
  }
  return true
}
