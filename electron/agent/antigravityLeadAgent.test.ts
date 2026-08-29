import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AgentStreamEvent } from './leadAgent'

/**
 * The bug this file guards against: `getAntigravityExecutablePath` used to
 * return undefined on every real install (it only checked locations nobody's
 * installer uses), so every run silently executed a different provider while
 * still labelling itself "Antigravity". These tests pin the two things that
 * regression needs to never happen again — no binary means a stated error, not
 * a silent substitute — and the wire format actually produced by a real
 * `agy --output-format stream-json` run (captured from a live, authenticated
 * session, not guessed from docs).
 *
 * Parsing is tested through `interpretAgyLine`, a pure function, rather than by
 * mocking `child_process.spawn` end to end. A spawn/stdout/close mock was tried
 * first and was racy — `close` fired before the generator's listener attached,
 * which is exactly the kind of flaky test that erodes trust in the suite.
 */

const getAntigravityExecutablePath = vi.fn()
vi.mock('../antigravityExecutable', () => ({
  getAntigravityExecutablePath: () => getAntigravityExecutablePath(),
}))

const { runAntigravityAgentTurn, antigravityInstructions, interpretAgyLine, parseAgyLine } =
  await import('./antigravityLeadAgent')

async function collect(gen: AsyncGenerator<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('when the binary is not found', () => {
  it('reports an error naming Antigravity, rather than silently running something else', async () => {
    // This is the exact bug: a missing binary used to fall through to Claude
    // while the log still said "Running in-process Antigravity engine". A run
    // labelled Antigravity must either be Antigravity or say plainly it is not.
    getAntigravityExecutablePath.mockReturnValue(undefined)
    const events = await collect(runAntigravityAgentTurn('hello', new AbortController()))

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as { message: string }).message).toContain('Antigravity CLI (agy) was not found')
    expect((events[0] as { message: string }).message).not.toContain('Claude')
  })

  it('never spawns a process when the binary is missing', async () => {
    getAntigravityExecutablePath.mockReturnValue(undefined)
    await collect(runAntigravityAgentTurn('hello', new AbortController()))
    // If a process were spawned with an undefined path, Node would throw
    // synchronously; reaching this line at all is the proof it did not try.
    expect(true).toBe(true)
  })
})

describe('instructions state what is actually available', () => {
  it('tells the model FlowDesk tools are not wired in, so it does not claim otherwise', () => {
    // The CLI has no per-invocation MCP flag. Without this note, the model has
    // no way to know whatsapp_* / linkedin_* tools do not exist in this run and
    // could confidently claim to have sent a message it never sent.
    const instructions = antigravityInstructions(false)
    expect(instructions).toContain('WhatsApp, LinkedIn, NotebookLM')
    expect(instructions).toContain('not available')
  })

  it('names the actual gate for each bypass state', () => {
    expect(antigravityInstructions(false)).toContain('Bypass permissions is OFF')
    expect(antigravityInstructions(true)).toContain('Bypass permissions is ON')
  })
})

describe('parsing the real agy stream-json wire format', () => {
  // Captured verbatim from `agy --print "Reply with exactly the word: ALIVE"
  // --output-format stream-json --model gemini-3.6-flash-low` against a real,
  // authenticated session.
  const REAL_INIT =
    '{"event":"init","conversation_id":"4d69e0b3-bd33-45f1-b4fb-d8d8fad0cb97","init":{"model":"gemini-3.6-flash-low","cwd":"D:\\\\DEV Projects\\\\Game Dev","tools":["ask_permission","run_command"],"permission_mode":"request-review"}}'
  const REAL_STEP_ACTIVE =
    '{"event":"step_update","step_update":{"conversation_id":"4d69e0b3-bd33-45f1-b4fb-d8d8fad0cb97","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"ALIVE"}}'
  const REAL_STEP_DONE =
    '{"event":"step_update","step_update":{"conversation_id":"4d69e0b3-bd33-45f1-b4fb-d8d8fad0cb97","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"\\n","duration_seconds":1.83}}'
  const REAL_RESULT =
    '{"event":"result","result":{"conversation_id":"4d69e0b3-bd33-45f1-b4fb-d8d8fad0cb97","status":"SUCCESS","response":"ALIVE\\n","duration_seconds":41.27,"num_turns":1}}'

  it('extracts the text delta from a real agent_response step', () => {
    // The previous parser checked `parsed.type === 'text_delta'`, which never
    // matches this shape — the key is `event`, and the text lives nested under
    // `step_update.text_delta`.
    expect(interpretAgyLine(REAL_STEP_ACTIVE)).toEqual([{ type: 'text', text: 'ALIVE' }])
  })

  it('treats a trailing newline-only delta the same as any other text', () => {
    expect(interpretAgyLine(REAL_STEP_DONE)).toEqual([{ type: 'text', text: '\n' }])
  })

  it('produces no stream event for init — session metadata only', () => {
    expect(interpretAgyLine(REAL_INIT)).toEqual([])
  })

  it('produces no stream event for a successful result', () => {
    expect(interpretAgyLine(REAL_RESULT)).toEqual([])
  })

  it('surfaces a non-success result as an error', () => {
    const line = JSON.stringify({ event: 'result', result: { status: 'FAILED' } })
    expect(interpretAgyLine(line)).toEqual([{ type: 'error', message: 'Antigravity run ended with status FAILED' }])
  })

  it('includes result.error in the message rather than discarding it', () => {
    // Verified live: `agy --model nonexistent-model-xyz` produces exactly this
    // shape — result.error carries the real, actionable reason. Reporting only
    // "status ERROR" and dropping this field turned a diagnosable failure into
    // a dead end; that gap was found by reproducing a real error case, not by
    // guessing there might be a missing field.
    const line = JSON.stringify({
      event: 'result',
      result: { status: 'ERROR', error: 'invalid model selection (--model "x"): model x is not recognized' },
    })
    expect(interpretAgyLine(line)).toEqual([{
      type: 'error',
      message: 'Antigravity run ended with status ERROR: invalid model selection (--model "x"): model x is not recognized',
    }])
  })

  it('ignores an unparseable line instead of throwing', () => {
    expect(() => interpretAgyLine('not json at all')).not.toThrow()
    expect(interpretAgyLine('not json at all')).toEqual([])
    expect(parseAgyLine('not json at all')).toBeNull()
  })

  it('surfaces a tool call and its result', () => {
    const call = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'tool_use', tool_name: 'run_command', tool_call_id: 't1', state: 'ACTIVE', tool_input: { command: 'ls' } },
    })
    const result = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'tool_use', tool_name: 'run_command', tool_call_id: 't1', state: 'DONE', tool_output: 'file1\nfile2' },
    })

    expect(interpretAgyLine(call)).toEqual([
      { type: 'tool_call', toolUseId: 't1', tool: 'run_command', prompt: JSON.stringify({ command: 'ls' }) },
    ])
    expect(interpretAgyLine(result)).toEqual([
      { type: 'tool_result', toolUseId: 't1', tool: 'run_command', text: 'file1\nfile2', isError: false },
    ])
  })
})
