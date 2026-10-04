/**
 * What an outside agent may do through the gateway, and a record of what it did.
 *
 * Every /rpc call — and every step a workflow runs — passes through
 * createActionGuard(). Three things happen there:
 *
 *  - blocked:          named actions are refused outright
 *  - requireApproval:  named actions wait for the user to click Allow in the app
 *                      (denied after APPROVAL_TIMEOUT_MS, since headless there
 *                      may be nobody to ask)
 *  - log:              every write-like action is appended to action-log.jsonl
 *                      with a short summary — never the full message text
 *
 * Names are compared in one canonical form, so an RPC method
 * ("tiktok.deleteAllVideos") and its MCP tool ("tiktok_delete_all_videos")
 * are the same entry. The policy file is plain JSON the user can edit; it is
 * re-read on every call, so edits apply without a restart.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface ActionPolicy {
  blocked: string[]
  requireApproval: string[]
}

export const DEFAULT_POLICY: ActionPolicy = {
  blocked: [],
  requireApproval: ['tiktok_delete_all_videos', 'tiktok_update_profile', 'linkedin_send_connection_request'],
}

export const APPROVAL_TIMEOUT_MS = 60_000

/** "tiktok.deleteAllVideos" and "tiktok_delete_all_videos" → the same key. */
export function canonicalAction(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[.\s-]+/g, '_').toLowerCase()
}

/** The action a call performs: the tool inside tools.call, else the method. */
export function actionName(method: string, params: Record<string, unknown>): string {
  return canonicalAction(method === 'tools.call' && typeof params.name === 'string' ? params.name : method)
}

const WRITE = /(^|_)(send|create|delete|remove|like|unlike|comment|reply|react|share|follow|hide|update|upload|submit|vote|subscribe|mark_read|connection|edit|switch_account|generate|extend|remember|decide|save|run)(_|$)/

export function isWriteAction(canonical: string): boolean {
  return !canonical.startsWith('tools_list') && WRITE.test(canonical)
}

/** Enough to recognise the action later; message bodies are cut, not stored. */
export function summarizeParams(params: Record<string, unknown>): Record<string, string> {
  const args = (params.args && typeof params.args === 'object' ? params.args : params) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of ['account', 'activityId', 'commentId', 'chatId', 'msgId', 'videoId', 'itemId', 'postId', 'subreddit', 'conversationUrn', 'profileUrl', 'filePath', 'privacy', 'visibility']) {
    if (args[k] != null && args[k] !== '') out[k] = String(args[k]).slice(0, 120)
  }
  for (const k of ['text', 'message', 'caption', 'bio', 'title', 'body']) {
    if (typeof args[k] === 'string' && args[k]) {
      const s = args[k] as string
      out[k] = s.length > 40 ? `${s.slice(0, 40)}… (${s.length} chars)` : s
    }
  }
  return out
}

export async function loadPolicy(file: string): Promise<ActionPolicy> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<ActionPolicy>
    return {
      blocked: Array.isArray(raw.blocked) ? raw.blocked.map(String) : DEFAULT_POLICY.blocked,
      requireApproval: Array.isArray(raw.requireApproval) ? raw.requireApproval.map(String) : DEFAULT_POLICY.requireApproval,
    }
  } catch (e) {
    // First run: write the defaults so the user has a file to edit.
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      await mkdir(dirname(file), { recursive: true }).catch(() => {})
      await writeFile(file, JSON.stringify(DEFAULT_POLICY, null, 2) + '\n', 'utf8').catch(() => {})
    }
    return DEFAULT_POLICY
  }
}

export interface ApprovalRequest {
  action: string
  summary: Record<string, string>
}

export interface ActionGuardOptions {
  policyFile: string
  logFile: string
  /** Resolves true to allow. Absent → approval-required actions are refused. */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>
}

function outcomeOk(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true
  const r = result as { ok?: unknown; isError?: unknown }
  return r.ok !== false && r.isError !== true
}

export function createActionGuard(opts: ActionGuardOptions) {
  const log = async (entry: Record<string, unknown>) => {
    try {
      await mkdir(dirname(opts.logFile), { recursive: true })
      await appendFile(opts.logFile, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n', 'utf8')
    } catch { /* logging must never break the action */ }
  }

  return async function guard<T>(method: string, params: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const action = actionName(method, params)
    const policy = await loadPolicy(opts.policyFile)
    const summary = summarizeParams(params)
    const listed = (list: string[]) => list.some(n => canonicalAction(n) === action)

    if (listed(policy.blocked)) {
      await log({ action, outcome: 'blocked', ...summary })
      throw new Error(`"${action}" is blocked by FlowDesk's action policy (${opts.policyFile})`)
    }
    if (listed(policy.requireApproval)) {
      const allowed = opts.requestApproval ? await opts.requestApproval({ action, summary }).catch(() => false) : false
      if (!allowed) {
        await log({ action, outcome: 'denied', ...summary })
        throw new Error(`"${action}" needs approval in the FlowDesk app and was not approved`)
      }
    }

    const write = isWriteAction(action)
    try {
      const result = await run()
      if (write) await log({ action, outcome: outcomeOk(result) ? 'ok' : 'failed', ...summary })
      return result
    } catch (e) {
      if (write) await log({ action, outcome: 'error', error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200), ...summary })
      throw e
    }
  }
}

export function policyPaths(dir: string): { policyFile: string; logFile: string } {
  return { policyFile: join(dir, 'action-policy.json'), logFile: join(dir, 'action-log.jsonl') }
}

/** Accepts only string lists; names are stored canonical so either spelling matches. */
export async function savePolicy(file: string, input: unknown): Promise<ActionPolicy> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const clean = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(canonicalAction))].sort()
  const policy: ActionPolicy = { blocked: clean(raw.blocked), requireApproval: clean(raw.requireApproval) }
  // One action cannot be both: blocked wins.
  policy.requireApproval = policy.requireApproval.filter(n => !policy.blocked.includes(n))
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(policy, null, 2) + '\n', 'utf8')
  return policy
}

/** The newest `limit` log entries, newest first. */
export async function readActionLog(file: string, limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const lines = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean)
    return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l) } catch { return { raw: l.slice(0, 200) } } })
  } catch {
    return []
  }
}
