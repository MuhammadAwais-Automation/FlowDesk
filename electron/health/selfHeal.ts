/**
 * Self-heal lane. A dedicated platform tool (tiktok_upload, linkedin_send…)
 * breaks when its site changes; the generic perception engine (workspaces +
 * browser_snapshot/browser_act) does not depend on the site's internals, so it
 * is the fallback. This ledger counts failures per tool and, once a tool keeps
 * failing, adds a `selfHeal` hint to its error: what to use instead now, and
 * how to collect what changed (site_investigate) so the tool can be repaired.
 */

export interface Failure { method: string; error: string; at: number }

export const WINDOW_MS = 24 * 60 * 60 * 1000
export const DEGRADED_AFTER = 2
const MAX_KEPT = 500

/** Where each platform's tools work, for the fallback hint. */
export const PLATFORM_SITES: Record<string, string> = {
  tiktok: 'https://www.tiktok.com',
  linkedin: 'https://www.linkedin.com',
  reddit: 'https://www.reddit.com',
  whatsapp: 'https://web.whatsapp.com',
  facebook: 'https://www.facebook.com',
  pinterest: 'https://www.pinterest.com',
  gumroad: 'https://gumroad.com/dashboard',
  youtube: 'https://www.youtube.com',
  chatgpt: 'https://chatgpt.com',
  flow: 'https://labs.google/fx/tools/flow',
}

/** `tiktok.uploadVideo` or tools.call name `whatsapp_download_media` → `tiktok` / `whatsapp`. */
export function platformOf(method: string): string | null {
  const head = method.split(/[._]/)[0].toLowerCase()
  return PLATFORM_SITES[head] ? head : null
}

/** An RPC result that says it failed: ok:false, isError, or an error field. */
export function failedResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { ok?: unknown; isError?: unknown; error?: unknown; content?: { text?: unknown }[] }
  if (r.ok === false || r.isError === true) {
    if (typeof r.error === 'string') return r.error
    const text = Array.isArray(r.content) ? r.content.find(c => typeof c?.text === 'string')?.text : undefined
    return typeof text === 'string' ? text.slice(0, 300) : 'failed'
  }
  return null
}

/**
 * The caller's own mistake — arguments that failed validation, an unknown
 * account — says nothing about the site, so it never makes a tool look broken.
 */
export function callerMistake(error: string): boolean {
  return /"code":\s*"(invalid_|too_|unrecognized)|unknown (account|tool)|is required|needs a ref|must be one of/i.test(error)
}

export class FailureLedger {
  private list: Failure[] = []

  record(method: string, error: string, now = Date.now()): void {
    if (!platformOf(method) || callerMistake(error)) return
    this.list.push({ method, error: error.slice(0, 300), at: now })
    if (this.list.length > MAX_KEPT) this.list.shift()
  }

  /** Success clears a tool's streak: it works again. */
  ok(method: string): void {
    if (this.list.some(f => f.method === method)) this.list = this.list.filter(f => f.method !== method)
  }

  recent(method: string, now = Date.now()): Failure[] {
    return this.list.filter(f => f.method === method && now - f.at < WINDOW_MS)
  }

  /** Tools failing now, worst first. */
  degraded(now = Date.now()): { method: string; failures: number; lastError: string; since: string }[] {
    const by = new Map<string, Failure[]>()
    for (const f of this.list) if (now - f.at < WINDOW_MS) by.set(f.method, [...(by.get(f.method) ?? []), f])
    return [...by.entries()]
      .filter(([, fs]) => fs.length >= DEGRADED_AFTER)
      .map(([method, fs]) => ({ method, failures: fs.length, lastError: fs[fs.length - 1].error, since: new Date(fs[0].at).toISOString() }))
      .sort((a, b) => b.failures - a.failures)
  }
}

export interface SelfHealHint { failures: number; fallback: string; investigate: string; report: string }

/** The hint added to a failing tool's result, or null while it has failed only once. */
export function selfHealHint(method: string, failures: number): SelfHealHint | null {
  const platform = platformOf(method)
  if (!platform || failures < DEGRADED_AFTER) return null
  const site = PLATFORM_SITES[platform]
  return {
    failures,
    fallback: `This tool failed ${failures} times in 24 h — likely the site changed. Do the task with the generic engine instead: workspace_list (pick the workspace on this account, or workspace_import_social), browser_open ${site}, then browser_snapshot / browser_act. Save the steps with browser_routine_save so they become a routine_* tool.`,
    investigate: 'site_investigate on that tab records what the page and its data requests look like now (saved for the repair).',
    report: 'flowdesk_report_issue so the tool itself gets fixed in the next FlowDesk update.',
  }
}
