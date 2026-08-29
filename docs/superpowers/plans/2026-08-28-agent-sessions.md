# Agent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FlowDesk's single-slot Agent conversation with many durable sessions whose memory is held by each provider's own session, and which survive switching between Claude and Codex mid-conversation.

**Architecture:** Each FlowDesk session owns a directory holding an append-only transcript and a metadata file. Memory and compaction are delegated to the provider SDKs by turning on `persistSession` and resuming by id; FlowDesk's transcript exists to render history, survive provider-side cleanup, and catch a provider up on turns it never saw (a per-provider watermark). No summarization code is written.

**Tech Stack:** Electron 3x main process (TypeScript, CommonJS-style imports), React 18 renderer, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `electron-store`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-agent-sessions-design.md`

## Global Constraints

- **Repo root:** `E:\FlowDesk`. All paths below are relative to it.
- **Test command:** `npx vitest run <path>` for one file, `npx vitest run` for all. The suite currently passes at **587 tests / 37 files**; it must still pass at the end of every task.
- **Typecheck command:** `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`. Both must be clean (no output) before every commit.
- **Shell:** Windows. Use forward slashes in Node paths; `path.join` everywhere.
- **Test framework:** Vitest with `describe` / `it` / `expect`, imported explicitly: `import { describe, expect, it } from 'vitest'`.
- **Electron mocking in tests:** main-process modules that import `electron` must be tested with `vi.mock('electron', () => ({ app: { getPath: () => '<tmpdir>' } }))` before a dynamic `await import()` of the module under test. This pattern already exists in `electron/savedImages.test.ts` — read it first.
- **Comment style:** the codebase writes comments explaining *why*, referencing confirmed evidence. Match it. Do not add narrating comments that restate the code.
- **Never** delete or rewrite `turns.jsonl` lines. Append only.
- **Do not** add any new npm dependency. Everything here uses Node built-ins and packages already installed.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/agentSessionStore.ts` (new) | All filesystem work for sessions: list, create, append turn, read turns, read/update meta, rename, delete. Nothing else. |
| `electron/agentSessionStore.test.ts` (new) | Store tests against a temp directory. |
| `src/lib/agentCatchUp.ts` (new) | Pure: transcript + watermark → catch-up text or null. No fs, no Electron. |
| `src/lib/agentCatchUp.test.ts` (new) | Pure tests. |
| `electron/agent/leadAgent.ts` (modify) | Accept a resume id, set `persistSession: true`, report the session id used. |
| `electron/agent/codexLeadAgent.ts` (modify) | Accept a resume id via `resumeThread`, report the thread id used. |
| `electron/main.ts` (modify) | Session IPC handlers; wire resume id and catch-up into `agent:sendMessage`; migration. |
| `electron/preload.ts` (modify) | Bindings for the new IPC. |
| `src/types/electron.d.ts` (modify) | Types for the new IPC. |
| `src/components/agent/SessionList.tsx` (new) | Sidebar listing sessions. |
| `src/pages/Agent.tsx` (modify) | Use the store instead of the single key; host the sidebar. |

---

## Task 1: Catch-up text builder (pure)

**Files:**
- Create: `src/lib/agentCatchUp.ts`
- Test: `src/lib/agentCatchUp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CatchUpTurn { role: 'user' | 'assistant'; content: string }`
  - `function buildCatchUp(turns: CatchUpTurn[], syncedThroughTurn: number, maxCharactersPerTurn?: number): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agentCatchUp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCatchUp, type CatchUpTurn } from './agentCatchUp'

const turns: CatchUpTurn[] = [
  { role: 'user', content: 'fix the image bug' },
  { role: 'assistant', content: 'fixed the timeout' },
  { role: 'user', content: 'now add a view tool' },
  { role: 'assistant', content: 'view tool added' },
]

describe('buildCatchUp', () => {
  it('returns null when the provider has already seen every turn', () => {
    // The common case by far: the user stayed on one provider, so no
    // catch-up text is sent and the turn costs nothing extra.
    expect(buildCatchUp(turns, 4)).toBeNull()
  })

  it('returns null for an empty transcript', () => {
    expect(buildCatchUp([], 0)).toBeNull()
  })

  it('covers exactly the turns the provider missed, and no others', () => {
    const text = buildCatchUp(turns, 2)
    expect(text).toContain('now add a view tool')
    expect(text).toContain('view tool added')
    expect(text).not.toContain('fix the image bug')
    expect(text).not.toContain('fixed the timeout')
  })

  it('covers the whole transcript when the provider has never seen it', () => {
    const text = buildCatchUp(turns, 0)
    expect(text).toContain('fix the image bug')
    expect(text).toContain('view tool added')
  })

  it('labels each turn with its role so the provider can tell them apart', () => {
    const text = buildCatchUp(turns, 3) ?? ''
    expect(text).toContain('[assistant]')
  })

  it('truncates an overlong turn instead of sending it whole', () => {
    const long: CatchUpTurn[] = [{ role: 'user', content: 'x'.repeat(5000) }]
    const text = buildCatchUp(long, 0, 100) ?? ''
    expect(text.length).toBeLessThan(400)
    expect(text).toContain('[truncated]')
  })

  it('treats a watermark ahead of the transcript as fully synced', () => {
    // Defensive: a stale watermark must never index past the end and throw.
    expect(buildCatchUp(turns, 99)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/agentCatchUp.test.ts`
Expected: FAIL — `Failed to resolve import "./agentCatchUp"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agentCatchUp.ts`:

```ts
export interface CatchUpTurn {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MAX_CHARACTERS_PER_TURN = 1500

function truncate(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text
  return `${text.slice(0, Math.max(0, maxCharacters - 12)).trimEnd()}\n...[truncated]`
}

/**
 * Text bringing one provider up to date on turns it never received.
 *
 * A session can move between providers, and each provider only holds the
 * turns it personally answered: after a morning on Claude and an afternoon
 * on Codex, Claude's own session has no idea the afternoon happened. The
 * watermark records how far each provider has been caught up, so a switch
 * back sends only the gap rather than the whole conversation again.
 *
 * Returns null when there is no gap, which is the normal case — the user
 * stayed on one provider, and that provider's own session already holds
 * everything.
 */
export function buildCatchUp(
  turns: CatchUpTurn[],
  syncedThroughTurn: number,
  maxCharactersPerTurn: number = DEFAULT_MAX_CHARACTERS_PER_TURN,
): string | null {
  const missing = turns.slice(Math.max(0, syncedThroughTurn))
  if (missing.length === 0) return null

  const body = missing
    .map(turn => `[${turn.role}]\n${truncate(turn.content, maxCharactersPerTurn)}`)
    .join('\n\n')

  return [
    'Context from this same conversation that you have not seen yet',
    '(it was handled by the other model while you were not active):',
    '',
    body,
    '',
    'Continue this conversation. The user\'s new message:',
  ].join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/agentCatchUp.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agentCatchUp.ts src/lib/agentCatchUp.test.ts
git commit -m "feat: add per-provider catch-up text builder"
```

---

## Task 2: Session store (filesystem)

**Files:**
- Create: `electron/agentSessionStore.ts`
- Test: `electron/agentSessionStore.test.ts`

**Interfaces:**
- Consumes: `CatchUpTurn` shape is compatible with `AgentTurn` below (same `role` / `content` fields).
- Produces:
  - `interface AgentToolCallEntry { tool: string; prompt: string; result: string; isError: boolean }`
  - `interface AgentTurn { id: string; role: 'user' | 'assistant'; content: string; toolCalls: AgentToolCallEntry[]; provider?: 'claude' | 'codex'; createdAt: string }`
  - `interface ProviderLink { id: string; syncedThroughTurn: number }`
  - `interface AgentSessionMeta { id: string; title: string; createdAt: string; updatedAt: string; turnCount: number; providers: Partial<Record<'claude' | 'codex', ProviderLink>> }`
  - `function sessionsRoot(): string`
  - `function listSessions(): Promise<AgentSessionMeta[]>`
  - `function createSession(title?: string): Promise<AgentSessionMeta>`
  - `function readMeta(id: string): Promise<AgentSessionMeta | null>`
  - `function writeMeta(meta: AgentSessionMeta): Promise<void>`
  - `function appendTurn(id: string, turn: Omit<AgentTurn, 'id' | 'createdAt'>): Promise<AgentTurn>`
  - `function readTurns(id: string): Promise<AgentTurn[]>`
  - `function renameSession(id: string, title: string): Promise<void>`
  - `function deleteSession(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `electron/agentSessionStore.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''

vi.mock('electron', () => ({ app: { getPath: () => root } }))

const store = await import('./agentSessionStore')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fd-sessions-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createSession and listSessions', () => {
  it('creates a session that then appears in the list', async () => {
    const created = await store.createSession('First')
    const all = await store.listSessions()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(created.id)
    expect(all[0].title).toBe('First')
  })

  it('lists most recently updated first', async () => {
    const a = await store.createSession('A')
    const b = await store.createSession('B')
    await store.writeMeta({ ...(await store.readMeta(a.id))!, updatedAt: '2030-01-01T00:00:00.000Z' })
    const all = await store.listSessions()
    expect(all[0].id).toBe(a.id)
    expect(all[1].id).toBe(b.id)
  })

  it('creating a session does not touch another session files', async () => {
    const a = await store.createSession('A')
    await store.appendTurn(a.id, { role: 'user', content: 'hello', toolCalls: [] })
    await store.createSession('B')
    const turns = await store.readTurns(a.id)
    expect(turns).toHaveLength(1)
    expect(turns[0].content).toBe('hello')
  })

  it('returns an empty list when nothing has been created', async () => {
    expect(await store.listSessions()).toEqual([])
  })
})

describe('appendTurn', () => {
  it('appends without rewriting earlier turns', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    const afterFirst = await readFile(join(root, 'agent-sessions', s.id, 'turns.jsonl'), 'utf8')
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    const afterSecond = await readFile(join(root, 'agent-sessions', s.id, 'turns.jsonl'), 'utf8')
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
  })

  it('advances turnCount in meta', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    expect((await store.readMeta(s.id))!.turnCount).toBe(2)
  })

  it('preserves the provider that produced an assistant turn', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'assistant', content: 'hi', toolCalls: [], provider: 'codex' })
    expect((await store.readTurns(s.id))[0].provider).toBe('codex')
  })
})

describe('readTurns resilience', () => {
  it('loads every complete turn when the final line is a partial write', async () => {
    // A crash mid-append must cost at most the last turn, never the
    // conversation. This is the whole reason the file is append-only JSONL.
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    const path = join(root, 'agent-sessions', s.id, 'turns.jsonl')
    const good = await readFile(path, 'utf8')
    await writeFile(path, good + '{"role":"user","con')
    const turns = await store.readTurns(s.id)
    expect(turns).toHaveLength(2)
    expect(turns[1].content).toBe('two')
  })

  it('returns an empty array for a session directory with no turns file', async () => {
    await mkdir(join(root, 'agent-sessions', 'ghost'), { recursive: true })
    expect(await store.readTurns('ghost')).toEqual([])
  })
})

describe('rename and delete', () => {
  it('renames without losing turns', async () => {
    const s = await store.createSession('Old')
    await store.appendTurn(s.id, { role: 'user', content: 'keep me', toolCalls: [] })
    await store.renameSession(s.id, 'New')
    expect((await store.readMeta(s.id))!.title).toBe('New')
    expect(await store.readTurns(s.id)).toHaveLength(1)
  })

  it('deletes exactly one session', async () => {
    const a = await store.createSession('A')
    const b = await store.createSession('B')
    await store.deleteSession(a.id)
    const all = await store.listSessions()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(b.id)
  })

  it('deleting a session that is already gone is not an error', async () => {
    await expect(store.deleteSession('never-existed')).resolves.toBeUndefined()
  })
})

describe('readMeta', () => {
  it('returns null for an unknown session rather than throwing', async () => {
    expect(await store.readMeta('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/agentSessionStore.test.ts`
Expected: FAIL — cannot resolve `./agentSessionStore`.

- [ ] **Step 3: Write the implementation**

Create `electron/agentSessionStore.ts`:

```ts
import { mkdir, readdir, readFile, appendFile, writeFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { app } from 'electron'

/**
 * Filesystem home for Agent conversations.
 *
 * Replaces the single electron-store key the Agent page used to write to,
 * where starting a new conversation overwrote the previous one outright.
 * electron-store is also the wrong shape for this: it holds one JSON
 * document rewritten in full on every set, so dozens of long conversations
 * would mean rewriting all of them to record one turn, with every session
 * riding on that single write.
 *
 * Turns live in append-only JSONL so recording a turn never rewrites
 * history: an interrupted write can damage at most the final line, and
 * readTurns is written to tolerate exactly that.
 */

export interface AgentToolCallEntry {
  tool: string
  prompt: string
  result: string
  isError: boolean
}

export interface AgentTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentToolCallEntry[]
  provider?: 'claude' | 'codex'
  createdAt: string
}

export interface ProviderLink {
  /** Claude sessionId or Codex threadId. */
  id: string
  /** How many transcript turns this provider has already received. */
  syncedThroughTurn: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  providers: Partial<Record<'claude' | 'codex', ProviderLink>>
}

export function sessionsRoot(): string {
  return join(app.getPath('userData'), 'agent-sessions')
}

function sessionDir(id: string): string {
  return join(sessionsRoot(), id)
}

function turnsPath(id: string): string {
  return join(sessionDir(id), 'turns.jsonl')
}

function metaPath(id: string): string {
  return join(sessionDir(id), 'meta.json')
}

export async function readMeta(id: string): Promise<AgentSessionMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8')) as AgentSessionMeta
  } catch {
    return null
  }
}

export async function writeMeta(meta: AgentSessionMeta): Promise<void> {
  await mkdir(sessionDir(meta.id), { recursive: true })
  await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8')
}

export async function createSession(title = 'New Session'): Promise<AgentSessionMeta> {
  const now = new Date().toISOString()
  const meta: AgentSessionMeta = {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    turnCount: 0,
    providers: {},
  }
  await writeMeta(meta)
  await appendFile(turnsPath(meta.id), '', 'utf8')
  return meta
}

export async function listSessions(): Promise<AgentSessionMeta[]> {
  let entries: string[]
  try {
    entries = await readdir(sessionsRoot())
  } catch {
    return []
  }
  const metas: AgentSessionMeta[] = []
  for (const entry of entries) {
    const meta = await readMeta(entry)
    if (meta) metas.push(meta)
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function appendTurn(
  id: string,
  turn: Omit<AgentTurn, 'id' | 'createdAt'>,
): Promise<AgentTurn> {
  const full: AgentTurn = { ...turn, id: randomUUID(), createdAt: new Date().toISOString() }
  await mkdir(sessionDir(id), { recursive: true })
  await appendFile(turnsPath(id), `${JSON.stringify(full)}\n`, 'utf8')

  const meta = await readMeta(id)
  if (meta) {
    await writeMeta({ ...meta, turnCount: meta.turnCount + 1, updatedAt: full.createdAt })
  }
  return full
}

export async function readTurns(id: string): Promise<AgentTurn[]> {
  let raw: string
  try {
    raw = await readFile(turnsPath(id), 'utf8')
  } catch {
    return []
  }
  const turns: AgentTurn[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      turns.push(JSON.parse(trimmed) as AgentTurn)
    } catch {
      // A partial final line is the expected shape of an interrupted
      // append. Everything before it is intact, so keep it rather than
      // failing the whole conversation.
    }
  }
  return turns
}

export async function renameSession(id: string, title: string): Promise<void> {
  const meta = await readMeta(id)
  if (!meta) return
  await writeMeta({ ...meta, title, updatedAt: new Date().toISOString() })
}

export async function deleteSession(id: string): Promise<void> {
  await rm(sessionDir(id), { recursive: true, force: true })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/agentSessionStore.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add electron/agentSessionStore.ts electron/agentSessionStore.test.ts
git commit -m "feat: add per-session filesystem store for Agent conversations"
```

---

## Task 3: Claude provider resume

**Files:**
- Modify: `electron/agent/leadAgent.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface AgentTurnOptions { resumeSessionId?: string }`
  - New `AgentStreamEvent` member: `{ type: 'provider_session'; provider: 'claude' | 'codex'; id: string }`
  - `runClaudeAgentTurn(promptText, abortController, projectRuntime?, requestApproval?, bypassPermissions?, options?: AgentTurnOptions)`
  - `runAgentTurn(promptText, abortController, projectRuntime?, provider?, requestApproval?, bypassPermissions?, options?: AgentTurnOptions)`

**Background the implementer needs:** every message the Claude SDK yields carries a `session_id` field (verified in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`). The SDK option `resume: string` loads that session's history, and `persistSession` defaults to `true` but is currently forced to `false` in this file, which is what disables the SDK's own memory and compaction.

- [ ] **Step 1: Add the event type**

In `electron/agent/leadAgent.ts`, find the `AgentStreamEvent` union (around line 145) and add one member before `| { type: 'done'; ... }`:

```ts
  | { type: 'provider_session'; provider: 'claude' | 'codex'; id: string }
```

- [ ] **Step 2: Add the options type**

Directly after the `AgentStreamEvent` union, add:

```ts
/**
 * Per-turn provider wiring. `resumeSessionId` is the provider's OWN session
 * or thread id, not FlowDesk's session id — the two are mapped in
 * agentSessionStore's meta, because each provider stores and compacts its
 * conversation itself and only hands back an identifier.
 */
export interface AgentTurnOptions {
  resumeSessionId?: string
}
```

- [ ] **Step 3: Thread the option through `runClaudeAgentTurn`**

Add a sixth parameter to `runClaudeAgentTurn`'s signature:

```ts
  options: AgentTurnOptions = {},
```

- [ ] **Step 4: Turn the SDK's own memory back on**

In the `query({ ... options: { ... } })` call, replace the line `persistSession: false,` with:

```ts
        // Was false, which disabled the SDK's session persistence AND its
        // built-in compaction, forcing a 6-turn text recap that made the
        // agent genuinely forget anything older. The SDK stores and
        // compacts the conversation itself; FlowDesk only keeps the id.
        persistSession: true,
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
```

- [ ] **Step 5: Report the session id once**

Inside the `for await (const message of query(...))` loop, as the very first statement in the loop body, add:

```ts
      if (!reportedSessionId && typeof (message as { session_id?: string }).session_id === 'string') {
        reportedSessionId = (message as { session_id?: string }).session_id as string
        yield { type: 'provider_session', provider: 'claude', id: reportedSessionId }
      }
```

And declare it just above the `try {` that wraps the loop:

```ts
  let reportedSessionId: string | null = null
```

- [ ] **Step 6: Survive a resume id the provider no longer has**

The spec requires this to be a normal state, not an error: Claude's sessions
live in `~/.claude/projects/`, outside FlowDesk, and can be cleaned up
independently. Wrap the loop so a resume failure retries once without `resume`,
which lets the caller's catch-up text reseed a fresh session on the same turn.

Extract the query call into a small local helper inside `runClaudeAgentTurn`,
above the `try`:

```ts
  const startQuery = (resume?: string) => query({
    prompt: singleUserMessage(promptText),
    options: { ...queryOptions, ...(resume ? { resume } : {}) },
  })
```

Move the entire `options: { ... }` object literal out of the `query({...})` call
into a `const queryOptions = { ... }` declared just above, minus the `resume`
line added in Step 4 (the helper adds it). Then replace the loop header:

```ts
    let stream = startQuery(options.resumeSessionId)
    let retriedWithoutResume = false
    for (;;) {
      try {
        for await (const message of stream) {
          // ... existing loop body, unchanged ...
        }
        break
      } catch (error) {
        const isResumeFailure = options.resumeSessionId && !retriedWithoutResume &&
          /session|resume|not found/i.test(error instanceof Error ? error.message : String(error))
        if (!isResumeFailure) throw error
        // The stored id is stale, not broken. Start clean; the catch-up text
        // the caller prepended already carries the conversation.
        retriedWithoutResume = true
        reportedSessionId = null
        stream = startQuery(undefined)
      }
    }
```

- [ ] **Step 7: Thread the option through the dispatcher**

Change `runAgentTurn`'s signature (around line 297) to add a seventh parameter `options: AgentTurnOptions = {},` and pass `options` to all three branches:

```ts
    yield* runCodexAgentTurn(promptText, abortController, projectRuntime, requestApproval, bypassPermissions, options)
```
```ts
    yield* runAntigravityAgentTurn(promptText, abortController, projectRuntime, requestApproval, bypassPermissions)
```
```ts
  yield* runClaudeAgentTurn(promptText, abortController, projectRuntime, requestApproval, bypassPermissions, options)
```

Antigravity deliberately does not receive `options`: it spawns an external CLI and does not use `createAgentToolSet` or these SDKs at all, so it has no session to resume.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: one error in `codexLeadAgent.ts` about the extra argument. That is expected and Task 4 fixes it. If any error appears in `leadAgent.ts` itself, fix it before continuing.

- [ ] **Step 9: Commit**

```bash
git add electron/agent/leadAgent.ts
git commit -m "feat: resume Claude SDK sessions and report the session id"
```

---

## Task 4: Codex provider resume

**Files:**
- Modify: `electron/agent/codexLeadAgent.ts`

**Interfaces:**
- Consumes: `AgentTurnOptions` from Task 3.
- Produces: `runCodexAgentTurn(promptText, abortController, projectRuntime?, requestApproval?, bypassPermissions?, options?: AgentTurnOptions)`

**Background the implementer needs:** `@openai/codex-sdk` exposes `resumeThread(id, options)` alongside `startThread(options)`, and emits a `ThreadStartedEvent` — `{ type: 'thread.started', thread_id: string }` — described in its types as *"Emitted when a new thread is started as the first event."*

- [ ] **Step 1: Import the options type**

At the top of `electron/agent/codexLeadAgent.ts`, extend the existing import from `./leadAgent`:

```ts
import { AGENT_SYSTEM_PROMPT, agentFailureMessage, type AgentStreamEvent, type AgentTurnOptions } from './leadAgent'
```

- [ ] **Step 2: Add the parameter**

Add a sixth parameter to `runCodexAgentTurn`:

```ts
  options: AgentTurnOptions = {},
```

- [ ] **Step 3: Resume instead of always starting fresh**

Replace the `const thread = codex.startThread({ ... })` call with:

```ts
    const threadOptions = {
      workingDirectory: runtimeDirectory,
      skipGitRepoCheck: true,
      sandboxMode: bypassPermissions ? ('workspace-write' as const) : ('read-only' as const),
      // 'never' either way: off means the sandbox itself blocks writes, so
      // there is nothing to approve; on means the user already said don't ask.
      approvalPolicy: 'never' as const,
      networkAccessEnabled: bypassPermissions,
      webSearchMode: bypassPermissions ? ('live' as const) : ('disabled' as const),
    }
    // A resume id that Codex no longer recognises is a normal state, not an
    // error: its thread store is outside FlowDesk and can be cleaned up
    // independently. Falling back to a fresh thread means the caller's
    // catch-up text reseeds it on this same turn.
    const thread = options.resumeSessionId
      ? codex.resumeThread(options.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions)
```

- [ ] **Step 4: Report the thread id**

In `codexEvents` (the translator function), add a branch that yields the new event. Find where `item.type === 'mcp_tool_call'` is handled and add, before the existing branches:

```ts
  if (event.type === 'thread.started') {
    return [{ type: 'provider_session', provider: 'codex', id: event.thread_id }]
  }
```

If TypeScript reports that `thread.started` is not in the event union used there, widen the check instead:

```ts
  const started = event as { type?: string; thread_id?: string }
  if (started.type === 'thread.started' && typeof started.thread_id === 'string') {
    return [{ type: 'provider_session', provider: 'codex', id: started.thread_id }]
  }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no output.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: all tests pass (587 plus the 20 added in Tasks 1–2).

- [ ] **Step 7: Commit**

```bash
git add electron/agent/codexLeadAgent.ts
git commit -m "feat: resume Codex threads and report the thread id"
```

---

## Task 5: Session IPC and turn wiring in main

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces IPC channels: `agentSession:list`, `agentSession:create`, `agentSession:turns`, `agentSession:rename`, `agentSession:delete`.
- `agent:sendMessage` gains an optional `userTurnRecorded?: boolean` field — see Step 4.

- [ ] **Step 1: Import the store and catch-up builder**

Near the other `./agent/*` imports in `electron/main.ts`, add:

```ts
import * as agentSessions from './agentSessionStore'
import { buildCatchUp } from '../src/lib/agentCatchUp'
```

If the second import path fails to resolve under `tsconfig.node.json`, copy `buildCatchUp` usage through a re-export instead: add `export { buildCatchUp } from '../src/lib/agentCatchUp'` to a new `electron/agentCatchUpBridge.ts` and import from there. Verify with the typecheck in Step 6 before choosing.

- [ ] **Step 2: Add the session IPC handlers**

Add near the existing `ipcMain.handle('agent:getRunState', ...)` registration:

```ts
ipcMain.handle('agentSession:list', () => agentSessions.listSessions())

ipcMain.handle('agentSession:create', (_e, title?: string) =>
  agentSessions.createSession(typeof title === 'string' && title.trim() ? title.trim() : undefined))

ipcMain.handle('agentSession:turns', (_e, id: string) => agentSessions.readTurns(id))

ipcMain.handle('agentSession:rename', (_e, id: string, title: string) =>
  agentSessions.renameSession(id, title))

ipcMain.handle('agentSession:delete', (_e, id: string) => agentSessions.deleteSession(id))
```

- [ ] **Step 3: Migrate the old single-slot session**

Add this function above the handlers and call it once inside the existing `app.whenReady().then(async () => { ... })` block, immediately after `await purgeRetiredFeatureData()`:

```ts
/**
 * One-time import of the pre-sessions conversation.
 *
 * The Agent page used to persist to a single electron-store key, so the
 * user has at most one conversation there. It is imported with no provider
 * ids, which means its next turn seeds whichever provider is active — the
 * same path a brand-new session takes.
 */
async function migrateLegacyAgentSession(): Promise<void> {
  const legacy = store.get('agentSession') as
    | { title?: string; entries?: { role?: string; content?: string; toolCalls?: unknown }[] }
    | undefined
  if (!legacy || !Array.isArray(legacy.entries) || legacy.entries.length === 0) {
    store.delete('agentSession' as never)
    return
  }
  const created = await agentSessions.createSession(legacy.title || 'Imported Session')
  for (const entry of legacy.entries) {
    if (entry.role !== 'user' && entry.role !== 'assistant') continue
    await agentSessions.appendTurn(created.id, {
      role: entry.role,
      content: typeof entry.content === 'string' ? entry.content : '',
      toolCalls: Array.isArray(entry.toolCalls) ? (entry.toolCalls as agentSessions.AgentToolCallEntry[]) : [],
    })
  }
  store.delete('agentSession' as never)
}
```

Call site, inside `app.whenReady()`:

```ts
  await migrateLegacyAgentSession().catch(error => console.log('[FlowDesk agent] session migration skipped:', error))
```

- [ ] **Step 4: Record the user turn and build catch-up in `agent:sendMessage`**

In the `ipcMain.handle('agent:sendMessage', ...)` handler, after `const bypassPermissions = ...` and before `const snapshot = projectSnapshot()`, insert:

```ts
  // The renderer records nothing itself; the transcript is written here so
  // a turn is captured even if the window is closed mid-run.
  await agentSessions.appendTurn(sessionId, { role: 'user', content: prompt, toolCalls: [] })

  const providerKey: 'claude' | 'codex' | null =
    leadAgentProvider === 'claude' ? 'claude' : leadAgentProvider === 'codex' ? 'codex' : null

  let resumeSessionId: string | undefined
  let promptToSend = prompt
  if (providerKey) {
    const meta = await agentSessions.readMeta(sessionId)
    const link = meta?.providers[providerKey]
    resumeSessionId = link?.id
    const turns = await agentSessions.readTurns(sessionId)
    // The turn just appended is the one being sent, so it is not a gap.
    const catchUp = buildCatchUp(turns.slice(0, -1), link?.syncedThroughTurn ?? 0)
    if (catchUp) promptToSend = `${catchUp}\n\n${prompt}`
  }
```

- [ ] **Step 5: Capture the provider id, the answer, and advance the watermark**

Replace the existing `try { for await (...) { publishAgentEvent(...) } } finally { ... }` block with:

```ts
  let providerSessionId: string | null = null
  let finalText = ''
  const pendingToolCalls = new Map<string, agentSessions.AgentToolCallEntry>()
  try {
    for await (const event of runAgentTurn(
      promptToSend, abortController, projectRuntime, leadAgentProvider,
      requestApproval, bypassPermissions, { resumeSessionId },
    )) {
      if (event.type === 'provider_session') providerSessionId = event.id
      if (event.type === 'done') finalText = event.text
      if (event.type === 'tool_call') {
        pendingToolCalls.set(event.toolUseId, { tool: event.tool, prompt: event.prompt, result: '', isError: false })
      }
      if (event.type === 'tool_result') {
        const existing = pendingToolCalls.get(event.toolUseId)
        if (existing) {
          existing.result = event.text
          existing.isError = event.isError
        }
      }
      publishAgentEvent(runId, sessionId, event)
    }
    await agentSessions.appendTurn(sessionId, {
      role: 'assistant',
      content: finalText,
      // Recorded so a reopened session shows what the agent actually did,
      // not just its final sentence — the data model promises these.
      toolCalls: [...pendingToolCalls.values()],
      ...(providerKey ? { provider: providerKey } : {}),
    })
    // Advanced only after the turn completed: an aborted run must not mark
    // a provider as caught up on turns it never actually received.
    if (providerKey && providerSessionId) {
      const meta = await agentSessions.readMeta(sessionId)
      if (meta) {
        await agentSessions.writeMeta({
          ...meta,
          providers: {
            ...meta.providers,
            [providerKey]: { id: providerSessionId, syncedThroughTurn: meta.turnCount },
          },
        })
      }
    }
  } finally {
    workerProgress.off('progress', onWorkerProgress)
    if (currentAgentAbort === abortController) currentAgentAbort = null
    denyAllPendingApprovals()
  }
  return true
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no output. If the `../src/lib/agentCatchUp` import failed to resolve, apply the bridge fallback from Step 1 now and re-run.

- [ ] **Step 7: Add preload bindings**

In `electron/preload.ts`, after the existing `agentGetRunState` line, add:

```ts
  agentSessionList: () => ipcRenderer.invoke('agentSession:list'),
  agentSessionCreate: (title?: string) => ipcRenderer.invoke('agentSession:create', title),
  agentSessionTurns: (id: string) => ipcRenderer.invoke('agentSession:turns', id),
  agentSessionRename: (id: string, title: string) => ipcRenderer.invoke('agentSession:rename', id, title),
  agentSessionDelete: (id: string) => ipcRenderer.invoke('agentSession:delete', id),
```

- [ ] **Step 8: Add renderer types**

In `src/types/electron.d.ts`, after the `agentGetRunState` line, add:

```ts
  agentSessionList: () => Promise<AgentSessionMeta[]>
  agentSessionCreate: (title?: string) => Promise<AgentSessionMeta>
  agentSessionTurns: (id: string) => Promise<AgentSessionTurn[]>
  agentSessionRename: (id: string, title: string) => Promise<void>
  agentSessionDelete: (id: string) => Promise<void>
```

And add these interfaces near the top of the same file, beside the other exported types:

```ts
export interface AgentSessionToolCall {
  tool: string
  prompt: string
  result: string
  isError: boolean
}

export interface AgentSessionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentSessionToolCall[]
  provider?: 'claude' | 'codex'
  createdAt: string
}

export interface AgentSessionProviderLink {
  id: string
  syncedThroughTurn: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  providers: Partial<Record<'claude' | 'codex', AgentSessionProviderLink>>
}
```

- [ ] **Step 9: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: wire session store, provider resume, and catch-up into agent turns"
```

---

## Task 6: Session sidebar component

**Files:**
- Create: `src/components/agent/SessionList.tsx`

**Interfaces:**
- Consumes: `AgentSessionMeta` from `@/types/electron`.
- Produces: default export `SessionList` with props
  `{ sessions: AgentSessionMeta[]; activeId: string | null; onSelect: (id: string) => void; onCreate: () => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void }`

**Styling note:** this codebase styles with Tailwind classes and a retro palette. Read `src/pages/Accounts.tsx` first and match its idiom (`font-retro-mono`, `#D97706` accent, `retro-btn`, rounded panels).

- [ ] **Step 1: Write the component**

Create `src/components/agent/SessionList.tsx`:

```tsx
import { useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import type { AgentSessionMeta } from '@/types/electron'

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface Props {
  sessions: AgentSessionMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export default function SessionList({ sessions, activeId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(session: AgentSessionMeta) {
    setEditingId(session.id)
    setDraft(session.title)
  }

  function commitEdit() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col bg-[#FAF7F0] border-r border-[#D8D1C3]">
      <div className="p-3 flex items-center justify-between border-b border-[#D8D1C3] bg-[#EBE5D5]">
        <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-stone-800">
          Sessions
        </span>
        <button
          onClick={onCreate}
          title="New session"
          className="retro-btn flex items-center gap-1 px-2 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-[11px] font-bold"
        >
          <Plus size={11} /> New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sessions.length === 0 ? (
          <p className="font-retro-mono text-[11px] text-stone-500 p-3 text-center">
            No sessions yet
          </p>
        ) : (
          sessions.map(session => {
            const isActive = session.id === activeId
            return (
              <div
                key={session.id}
                onClick={() => editingId !== session.id && onSelect(session.id)}
                className={`group p-2.5 rounded-xl cursor-pointer transition-all ${
                  isActive
                    ? 'border-2 border-[#D97706] bg-[#FEF3C7]'
                    : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40'
                }`}
              >
                {editingId === session.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 min-w-0 font-retro-sans text-[11px] font-bold bg-white border border-[#D97706] rounded px-1.5 py-0.5 outline-none"
                    />
                    <button onClick={commitEdit} title="Save"><Check size={12} className="text-[#059669]" /></button>
                    <button onClick={() => setEditingId(null)} title="Cancel"><X size={12} className="text-stone-400" /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <p className={`flex-1 min-w-0 truncate font-retro-sans text-[11px] font-bold ${
                        isActive ? 'text-[#92400E]' : 'text-stone-900'
                      }`}>
                        {session.title}
                      </p>
                      <button
                        onClick={e => { e.stopPropagation(); startEdit(session) }}
                        title="Rename"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil size={11} className="text-stone-400 hover:text-[#D97706]" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onDelete(session.id) }}
                        title="Delete"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={11} className="text-stone-400 hover:text-[#DC2626]" />
                      </button>
                    </div>
                    <p className="font-retro-mono text-[10px] text-stone-500 mt-0.5">
                      {session.turnCount} turns · {relativeTime(session.updatedAt)}
                    </p>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/agent/SessionList.tsx
git commit -m "feat: add Agent session sidebar component"
```

---

## Task 7: Agent page uses the session store

**Files:**
- Modify: `src/pages/Agent.tsx`

**Interfaces:**
- Consumes: `SessionList` (Task 6) and the `agentSession*` renderer API (Task 5).
- Produces: no new exports.

**Background the implementer needs:** the file currently keeps one session in `localStorage`-adjacent electron-store under `AGENT_STORE_KEY = 'agentSession'` (line 22), loads it in a `useEffect` near line 205, and `handleNewSession()` (near line 348) overwrites it. The main process now owns the transcript, so the page reads turns rather than writing them.

- [ ] **Step 1: Replace the storage constant with session state**

Delete the line `const AGENT_STORE_KEY = 'agentSession'` and add to the component's state block:

```tsx
  const [sessions, setSessions] = useState<AgentSessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
```

Add the imports:

```tsx
import SessionList from '@/components/agent/SessionList'
import type { AgentSessionMeta } from '@/types/electron'
```

- [ ] **Step 2: Load sessions on mount**

Replace the body of the existing session-loading `useEffect` (the one that calls `api.storeGet(AGENT_STORE_KEY)`) with:

```tsx
    ;(async () => {
      const list = await api.agentSessionList()
      if (list.length === 0) {
        const created = await api.agentSessionCreate()
        setSessions([created])
        setActiveSessionId(created.id)
        return
      }
      setSessions(list)
      setActiveSessionId(list[0].id)
    })()
```

- [ ] **Step 3: Load a session's turns when it becomes active**

Add a new effect below it:

```tsx
  useEffect(() => {
    if (!activeSessionId) return
    ;(async () => {
      const turns = await api.agentSessionTurns(activeSessionId)
      const loaded = createAgentSession()
      loaded.id = activeSessionId
      loaded.entries = turns.map(turn => ({
        id: turn.id,
        role: turn.role,
        content: turn.content,
        toolCalls: turn.toolCalls,
        created_at: turn.createdAt,
      }))
      setSession(loaded)
      sessionRef.current = loaded
    })()
  }, [activeSessionId])
```

- [ ] **Step 4: Rewrite the session actions**

Replace `handleNewSession` with these four handlers:

```tsx
  async function handleNewSession() {
    if (sendingRef.current) return
    clearWatchdog()
    const created = await api.agentSessionCreate()
    setSessions(await api.agentSessionList())
    setActiveSessionId(created.id)
    setError(null)
    setLiveToolCalls([])
    setToolStatus({})
  }

  function handleSelectSession(id: string) {
    if (sendingRef.current) return
    setActiveSessionId(id)
    setLiveToolCalls([])
    setToolStatus({})
  }

  async function handleRenameSession(id: string, title: string) {
    await api.agentSessionRename(id, title)
    setSessions(await api.agentSessionList())
  }

  async function handleDeleteSession(id: string) {
    if (!confirm('Delete this session? The conversation cannot be recovered.')) return
    await api.agentSessionDelete(id)
    const remaining = await api.agentSessionList()
    setSessions(remaining)
    if (activeSessionId === id) {
      setActiveSessionId(remaining[0]?.id ?? null)
      if (remaining.length === 0) {
        const created = await api.agentSessionCreate()
        setSessions([created])
        setActiveSessionId(created.id)
      }
    }
  }
```

- [ ] **Step 5: Stop building the handoff prompt**

Find the line in `handleSend` that reads:

```tsx
    const handoff = session.entries.length > 0 ? buildAgentHandoffPrompt(session, text) : text
```

Replace it with:

```tsx
    // The provider's own session now carries the history, and main.ts adds
    // catch-up text only when the conversation moved between providers.
    // Prepending a recap here would duplicate what the provider already has.
    const handoff = text
```

Remove `buildAgentHandoffPrompt` from the `@/lib/agentSession` import if nothing else uses it; leave the file itself in place.

- [ ] **Step 6: Remove the renderer-side transcript writes**

Delete every `api.storeSet(AGENT_STORE_KEY, next).catch(() => {})` call (there are three, near lines 112, 190, and inside `persist`). The main process writes the transcript now, so these would produce a second, divergent copy.

- [ ] **Step 7: Refresh the list after a turn finishes**

In the `done` handling inside `applyRunEvent`, after the existing state updates, add:

```tsx
      api.agentSessionList().then(setSessions).catch(() => {})
```

- [ ] **Step 8: Render the sidebar**

In the component's returned JSX, wrap the existing top-level layout so `SessionList` sits to its left:

```tsx
    <div style={{ display: 'flex', height: '100%' }}>
      <SessionList
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={handleNewSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* existing Agent page content unchanged */}
      </div>
    </div>
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no output.

- [ ] **Step 10: Run the whole suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Agent.tsx
git commit -m "feat: Agent page reads and switches between stored sessions"
```

---

## Task 8: Manual verification

**Files:** none modified.

This task has no automated test because it exercises two real provider SDKs and the Electron main process together; the value is in confirming the behaviour the spec promises, which unit tests cannot reach.

- [ ] **Step 1: Start the app**

Run: `npm run dev`

- [ ] **Step 2: Verify sessions are no longer destroyed**

1. Send a message in the Agent page, wait for the answer.
2. Click **New**, send a different message.
3. Click the first session in the sidebar.

Expected: the first conversation is still there, with both its messages.

- [ ] **Step 3: Verify memory beyond six turns**

In one session, send eight short messages, then ask: *"what was my very first message in this conversation?"*

Expected: the agent answers correctly. Under the old 6-turn recap it could not.

- [ ] **Step 4: Verify the provider switch**

1. In one session, have a few turns on Claude.
2. Switch the lead-agent provider to Codex in Settings.
3. In the same session, ask: *"summarise what we discussed so far."*

Expected: Codex answers from the earlier Claude turns.

- [ ] **Step 5: Verify the switch back**

1. Continue a few turns on Codex.
2. Switch back to Claude.
3. Ask: *"what did we do most recently?"*

Expected: Claude knows the Codex turns — it receives them as catch-up, automatically, with no manual step.

- [ ] **Step 6: Verify the files on disk**

Open `%APPDATA%\flowdesk\agent-sessions\`.

Expected: one directory per session, each with `turns.jsonl` and `meta.json`. Open a `meta.json` and confirm `providers` has an entry per provider used, each with a plausible `syncedThroughTurn`.

- [ ] **Step 7: Commit any fixes**

If any step failed, fix it, re-run `npx vitest run` and the typechecks, then commit.

---

## Known follow-up, deliberately not in this plan

Deleting a FlowDesk session does not yet delete the provider-side session (Claude writes to `~/.claude/projects/`). The spec calls for it; it is left out here because the SDK exposes no documented delete API that has been verified, and guessing at a filesystem path inside another tool's directory is the kind of change that should be made against a confirmed capability rather than an assumption. Track it as its own task: confirm how a Claude session is removed, then wire it into `agentSession:delete`.
