import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { withAgentAbortSlot } from './agentRunAbortSlot'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

/**
 * The abort slot is the interlock between an interactive Agent turn and the
 * monitor continuation drain: while it holds a controller, `drainBrainContinuations`
 * refuses to run and every queued monitor resume waits.
 *
 * The regression this guards: the slot used to be filled ~105 lines before the
 * `try` whose `finally` cleared it, so a throw from the transcript write or the
 * session-meta read (a full disk, an EPERM, a corrupt meta JSON) left the slot
 * filled and the run state stuck at 'running' — every monitor resume stopped,
 * and the renderer showed a run that never ended.
 */
describe('withAgentAbortSlot', () => {
  function harness() {
    const state = { slot: null as AbortController | null, status: 'idle', errors: [] as unknown[], settled: 0 }
    const controller = new AbortController()
    const run = (body: () => Promise<void>) => withAgentAbortSlot(controller, {
      claim: held => { state.slot = held },
      release: held => { if (state.slot === held) state.slot = null },
      onError: error => { state.errors.push(error); state.status = controller.signal.aborted ? 'cancelled' : 'failed' },
      onSettle: () => { state.settled += 1 },
    }, body)
    return { state, controller, run }
  }

  it('releases the slot and finishes the run when the turn completes', async () => {
    const { state, run } = harness()
    await expect(run(async () => { state.status = 'running'; state.status = 'completed' })).resolves.toBe(true)
    expect(state.slot).toBeNull()
    expect(state.status).toBe('completed')
    expect(state.errors).toEqual([])
    expect(state.settled).toBe(1)
  })

  it('releases the slot when the work before the provider turn throws', async () => {
    const { state, run } = harness()

    // Exactly the previously-unguarded window: the run state is already
    // 'running' and the transcript write fails.
    await expect(run(async () => {
      state.status = 'running'
      throw new Error('EPERM: agent transcript is locked')
    })).resolves.toBe(true)

    expect(state.slot).toBeNull()
    expect(state.status).not.toBe('running')
    expect(state.status).toBe('failed')
    expect((state.errors[0] as Error).message).toContain('EPERM')
    expect(state.settled).toBe(1)
  })

  it('reports a throw after an abort as cancelled rather than failed', async () => {
    const { state, controller, run } = harness()
    await run(async () => { controller.abort(); throw new Error('aborted mid-turn') })
    expect(state.status).toBe('cancelled')
    expect(state.slot).toBeNull()
  })

  it('never clears a slot a newer turn has already taken', async () => {
    const state = { slot: null as AbortController | null }
    const first = new AbortController()
    const second = new AbortController()
    const slot = {
      claim: (held: AbortController) => { state.slot = held },
      release: (held: AbortController) => { if (state.slot === held) state.slot = null },
      onError: vi.fn(),
      onSettle: vi.fn(),
    }
    await withAgentAbortSlot(first, slot, async () => { state.slot = second })
    expect(state.slot).toBe(second)
  })
})

describe('agent run abort slot wiring', () => {
  it('fills the slot only through the guard, so no window can leak it', () => {
    const text = source('electron/main.ts')
    expect(text).toContain('withAgentAbortSlot(')
    // A bare assignment outside the guard's own claim callback is the defect
    // this fix removed; the only writes left are the claim/release callbacks.
    expect(text).not.toMatch(/^\s*currentAgentAbort = abortController$/m)
  })
})
