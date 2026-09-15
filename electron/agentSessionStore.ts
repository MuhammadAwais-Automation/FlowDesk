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
  /** Provider id for grouping in the UI — every whatsapp_* call is 'whatsapp'. */
  tool: string
  /** Raw MCP tool name. Optional: older stored turns predate it. */
  name?: string
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
