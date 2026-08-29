import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { type ProjectToolRuntime } from './tools'
import { AGENT_SYSTEM_PROMPT, agentFailureMessage, type AgentStreamEvent } from './leadAgent'
import { getAntigravityExecutablePath } from '../antigravityExecutable'
import { alwaysApprove, type RequestApproval } from './approval'

/**
 * Antigravity (`agy`) lead-agent provider.
 *
 * ── What changed here, and why ──
 *
 * The previous version never actually ran Antigravity. It looked for the
 * binary in locations nobody's real install uses, so `getAntigravityExecutablePath`
 * always returned undefined, and every call silently fell through to running
 * Claude while logging "Running in-process Antigravity engine" — a real user
 * had no way to tell they were not talking to Antigravity at all.
 *
 * Verified against the real CLI (v1.1.9, installed and authenticated) before
 * writing any of this:
 *
 *   agy --print "..." --output-format stream-json
 *
 * produced real newline-delimited JSON events. The flags this file used to
 * send — `--json-stream`, `--mcp-server workers=<url>` — do not exist; `agy
 * --help` lists no MCP flag at all. The parser used to look for
 * `parsed.type === 'text_delta'`; the real event shape is
 * `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"..."}}`.
 * Both were wrong in a way that would have kept failing even once the binary
 * was found.
 *
 * ── What this still cannot do ──
 *
 * FlowDesk's own tools (WhatsApp, LinkedIn, NotebookLM) are NOT wired in. The
 * CLI has no per-invocation MCP flag — MCP servers are configured only through
 * a global file (`~/.gemini/config/mcp_config.json`) that Antigravity IDE also
 * reads, and writing to it is a separate, deliberate decision, not something to
 * do quietly as a side effect of a chat turn. Antigravity's own 50+ built-in
 * tools (file edit, terminal, browser control, subagents) work regardless,
 * since those come from the binary itself.
 */

const STREAM_TIMEOUT_MS = 5 * 60_000

export function antigravityInstructions(bypassPermissions: boolean): string {
  const toolsNote = bypassPermissions
    ? 'Bypass permissions is ON: Antigravity will run its own built-in tools (file edits, shell commands) without asking.'
    : 'Bypass permissions is OFF: Antigravity will ask before running shell commands or making file edits.'
  const mcpNote =
    'FlowDesk\'s own tools (WhatsApp, LinkedIn, NotebookLM) are not available in this session — Antigravity only has its own built-in tools (file editing, terminal, browser control, subagents).'
  return `${AGENT_SYSTEM_PROMPT}\n\nYou are running as the Google Antigravity (Gemini) lead-agent provider. ${toolsNote} ${mcpNote}`
}

interface StepUpdateEvent {
  event: 'step_update'
  step_update: {
    conversation_id?: string
    step_index?: number
    state?: 'ACTIVE' | 'DONE'
    step_type?: string
    text_delta?: string
    tool_name?: string
    tool_call_id?: string
    tool_input?: unknown
    tool_output?: unknown
    is_error?: boolean
  }
}

interface InitEvent {
  event: 'init'
  init: { conversation_id?: string; model?: string; tools?: string[] }
}

interface ResultEvent {
  event: 'result'
  result: { conversation_id?: string; status?: string; response?: string; error?: string; usage?: unknown }
}

type AgyEvent = InitEvent | StepUpdateEvent | ResultEvent | { event: string; [key: string]: unknown }

export function parseAgyLine(line: string): AgyEvent | null {
  try {
    return JSON.parse(line) as AgyEvent
  } catch {
    return null
  }
}

/**
 * Turns one parsed agy event into zero or more AgentStreamEvents.
 *
 * Pulled out as a pure function — independent of the child process — so the
 * real wire format (captured from a live, authenticated `agy --output-format
 * stream-json` run) can be tested directly rather than through a mocked
 * spawn/stdout/close sequence, which is exactly the kind of test that is easy
 * to write racily and hard to trust.
 */
export function interpretAgyLine(line: string): AgentStreamEvent[] {
  const parsed = parseAgyLine(line)
  if (!parsed) return []

  if (parsed.event === 'step_update') {
    const step = (parsed as StepUpdateEvent).step_update
    if (step.step_type === 'agent_response' && step.text_delta) {
      return [{ type: 'text', text: step.text_delta }]
    }
    if (step.tool_name && step.state === 'ACTIVE') {
      return [{
        type: 'tool_call',
        toolUseId: step.tool_call_id || `tool_${Date.now()}`,
        tool: step.tool_name,
        prompt: typeof step.tool_input === 'string' ? step.tool_input : JSON.stringify(step.tool_input ?? {}),
      }]
    }
    if (step.tool_name && step.state === 'DONE' && step.tool_output !== undefined) {
      return [{
        type: 'tool_result',
        toolUseId: step.tool_call_id || `tool_${Date.now()}`,
        tool: step.tool_name,
        text: typeof step.tool_output === 'string' ? step.tool_output : JSON.stringify(step.tool_output),
        isError: Boolean(step.is_error),
      }]
    }
    return []
  }

  if (parsed.event === 'result') {
    const result = (parsed as ResultEvent).result
    if (result.status && result.status !== 'SUCCESS') {
      // `result.error` carries the actual reason (verified live: an invalid
      // --model produced "invalid model selection: ... is not recognized...").
      // Dropping it and reporting only the bare status was the real bug here —
      // it is what turned a diagnosable failure into a dead end.
      const detail = result.error ? `: ${result.error}` : ''
      return [{ type: 'error', message: `Antigravity run ended with status ${result.status}${detail}` }]
    }
    return []
  }

  // 'init' carries only session metadata — nothing to surface as a stream event.
  return []
}

export async function* runAntigravityAgentTurn(
  promptText: string,
  abortController: AbortController,
  _projectRuntime?: ProjectToolRuntime,
  _requestApproval: RequestApproval = alwaysApprove,
  bypassPermissions = false,
): AsyncGenerator<AgentStreamEvent> {
  console.log(`[FlowDesk agent:antigravity] starting, promptLength=${promptText.length}`)

  const binaryPath = getAntigravityExecutablePath()
  if (!binaryPath) {
    // Said plainly rather than silently running a different provider. That
    // silent fallback is exactly the bug this file existed to fix.
    yield {
      type: 'error',
      message:
        'Antigravity CLI (agy) was not found on PATH. Install it from antigravity.google, or set ANTIGRAVITY_PATH / AGY_PATH to its location. Not falling back to another provider — a run labelled Antigravity should be Antigravity.',
    }
    return
  }

  const runtimeDirectory = _projectRuntime?.rootPath ?? join(tmpdir(), 'flowdesk-antigravity-runtime')
  await mkdir(runtimeDirectory, { recursive: true })

  const instructions = antigravityInstructions(bypassPermissions)
  const combinedPrompt = `${instructions}\n\nUser request:\n${promptText}`

  const args = [
    '--print', combinedPrompt,
    '--output-format', 'stream-json',
    '--print-timeout', '5m',
  ]
  if (bypassPermissions) args.push('--dangerously-skip-permissions')

  console.log(`[FlowDesk agent:antigravity] executing: ${binaryPath} (bypass=${bypassPermissions})`)

  const child = spawn(binaryPath, args, {
    cwd: runtimeDirectory,
    windowsHide: true,
  })

  const onAbort = () => child.kill()
  abortController.signal.addEventListener('abort', onAbort)

  const timeout = setTimeout(() => child.kill(), STREAM_TIMEOUT_MS)

  let buffer = ''
  let finalText = ''
  let sawResult = false
  let stderrOutput = ''
  child.stderr?.on('data', chunk => { stderrOutput += chunk.toString() })

  try {
    for await (const chunk of child.stdout) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        const parsed = parseAgyLine(line)
        if (parsed?.event === 'result') sawResult = true

        for (const event of interpretAgyLine(line)) {
          if (event.type === 'text') finalText += event.text
          yield event
        }
      }
    }
  } finally {
    clearTimeout(timeout)
    abortController.signal.removeEventListener('abort', onAbort)
  }

  const exitCode: number | null = await new Promise(resolve => child.on('close', resolve))

  if (abortController.signal.aborted) {
    yield { type: 'error', message: 'Agent run cancelled.' }
    return
  }

  if (!sawResult && exitCode !== 0) {
    yield {
      type: 'error',
      message: agentFailureMessage(
        new Error(`agy exited with code ${exitCode}${stderrOutput ? `: ${stderrOutput.slice(0, 500)}` : ''}`),
      ),
    }
    return
  }

  yield { type: 'done', text: finalText }
}
