/**
 * The automatic ledger (docs/brain-v3-plan.md §3.3): every gateway call that
 * came from an MCP client is recorded in Brain with its session, so FlowDesk
 * knows what was done on which account even when the agent forgets to say.
 *
 * The MCP server sends three headers with each call: its session id, the
 * client's name, and the content item the call belongs to. They live in an
 * AsyncLocalStorage for the request, so workflow steps run inside it inherit
 * them. Calls from the app itself, the health check and rehearsals carry no
 * context (or a skip flag) and are never recorded.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { canonicalAction, isWriteAction } from '../gateway/actionPolicy'
import { redact } from '../reports'

export interface CallContext { sessionId?: string; client?: string; contentId?: string; skip?: boolean }
export const callContext = new AsyncLocalStorage<CallContext>()

/** Methods that are FlowDesk's own bookkeeping, never ledger rows. */
const NOT_RECORDED = /^(brain\.|jobs\.|inbox\.|health\.|dev\.|reports\.|skills\.|workflows\.(list|get|save|runs?|status)$|tools\.list$|social\.accounts$)/
/** Top-level calls whose inner tool calls must not be recorded (rehearsals send nothing real). */
const SKIP_NESTED = /^(dev\.|health\.)/

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : undefined
}

export function contextFromHeaders(headers: Record<string, string | string[] | undefined>, method: string): CallContext {
  return {
    sessionId: header(headers, 'x-flowdesk-session'),
    client: header(headers, 'x-flowdesk-client'),
    contentId: header(headers, 'x-flowdesk-content'),
    skip: SKIP_NESTED.test(method),
  }
}

// boardId comes after id: a created pin returns { id, boardId } and the pin is the target.
const ID_KEYS = ['pinId', 'postId', 'videoId', 'productId', 'commentId', 'messageId', 'mediaId', 'itemId', 'projectId', 'aweme_id', 'id', 'boardId']
const URL_KEYS = ['url', 'permalink', 'postUrl', 'pinUrl', 'videoUrl', 'productUrl', 'shareUrl', 'link']

function pick(obj: unknown, keys: string[], ok: (v: unknown) => boolean): string | null {
  const layers: unknown[] = [obj]
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    for (const k of ['result', 'data', 'pin', 'post', 'video', 'product', 'item', 'comment', 'message']) if (o[k] && typeof o[k] === 'object') layers.push(o[k])
  }
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue
    for (const k of keys) {
      const v = (layer as Record<string, unknown>)[k]
      if (ok(v)) return String(v).slice(0, 1000)
    }
  }
  return null
}

const isId = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 200) || (typeof v === 'number' && Number.isFinite(v))
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\//.test(v)

/** Files a generation tool made (ChatGPT images, Flow media): the content item's assets. */
function assetsOf(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const list = [r.images, r.media].find(Array.isArray) as unknown[] | undefined
  return (list ?? []).flatMap(x => {
    const o = x && typeof x === 'object' ? x as Record<string, unknown> : {}
    const v = typeof o.url === 'string' && o.url ? o.url : typeof o.path === 'string' ? o.path : ''
    return v ? [v.slice(0, 1000)] : []
  }).slice(0, 20)
}

/** A result that says it failed without throwing (`{ ok: false }`, MCP `isError`). */
export function resultFailed(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (r.ok === false || r.isError === true || r.success === false) {
    const e = r.error ?? r.message ?? (Array.isArray(r.content) ? (r.content[0] as { text?: string } | undefined)?.text : undefined)
    return typeof e === 'string' && e ? e : 'failed'
  }
  return null
}

export interface LedgerArgs {
  sessionId: string | null; client?: string; platform: string; account: string | null; tool: string
  kind: 'write' | 'read'; outcome: 'ok' | 'error'; targetId: string | null; targetUrl: string | null
  contentId: string | null; error: string | null; summary: string | null; assets: string[]
}

/** The ledger row for one finished call, or null when it is not recorded. */
export function describeCall(ctx: CallContext | undefined, method: string, params: Record<string, unknown>, outcome: { result?: unknown; error?: unknown }): LedgerArgs | null {
  if (!ctx || ctx.skip || NOT_RECORDED.test(method)) return null
  const tool = method === 'tools.call' && typeof params.name === 'string' ? params.name : method
  const args = (method === 'tools.call' && params.args && typeof params.args === 'object' ? params.args : params) as Record<string, unknown>
  const platform = tool.split(/[._]/)[0] || 'flowdesk'
  const write = isWriteAction(canonicalAction(tool))
  const failed = outcome.error !== undefined ? (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)) : resultFailed(outcome.result)
  const account = typeof args.account === 'string' ? args.account : typeof args.accountId === 'string' ? args.accountId : null
  return {
    sessionId: ctx.sessionId ?? null,
    client: ctx.client,
    platform,
    account: account ? account.slice(0, 120) : null,
    tool,
    kind: write ? 'write' : 'read',
    outcome: failed ? 'error' : 'ok',
    targetId: write && !failed ? pick(outcome.result, ID_KEYS, isId) : null,
    targetUrl: write && !failed ? pick(outcome.result, URL_KEYS, isUrl) : null,
    contentId: ctx.contentId ?? (typeof args.contentId === 'string' ? args.contentId : null),
    error: failed ? redact(failed).slice(0, 500) : null,
    // Argument names only: values are post text, chat names, file paths.
    summary: Object.keys(args).filter(k => k !== 'contentId').slice(0, 20).join(', ') || null,
    assets: write && !failed ? assetsOf(outcome.result) : [],
  }
}

type Guard = <T>(m: string, p: Record<string, unknown>, run: () => Promise<T>) => Promise<T>

/** Wraps the gateway's action guard so every finished call is offered to the ledger. */
export function withLedger(inner: Guard, record: (row: LedgerArgs) => void): Guard {
  return async <T>(method: string, params: Record<string, unknown>, run: () => Promise<T>): Promise<T> => {
    const ctx = callContext.getStore()
    try {
      const result = await inner(method, params, run)
      const row = describeCall(ctx, method, params, { result })
      if (row) record(row)
      return result
    } catch (error) {
      const row = describeCall(ctx, method, params, { error })
      if (row) record(row)
      throw error
    }
  }
}
