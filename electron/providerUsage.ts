/**
 * Remembers the most recent usage/quota snapshot each provider reported.
 *
 * Every provider already broadcasts one to the renderer as `capture:usage`
 * (ChatGPT's `limits_progress`, Claude's rolling windows, Qwen's token
 * counts), but nothing kept it: the agent could not find out how many image
 * generations were left on the signed-in account, so a turn that was about
 * to fail on quota looked identical to one that would succeed, and the user
 * only learned the limit was gone from the provider's own refusal text.
 *
 * Deliberately free of Electron imports so the formatting below is testable
 * directly; main.ts records into it from the same place it sends the IPC.
 */

export interface ChatGPTLimit { feature: string; remaining: number; resetAfter: string }
export interface ClaudeWindow { window: string; status: string; utilization: number; resetsAt: number | null }
export interface QwenTokens { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number }

export type ProviderLimits = ChatGPTLimit[] | ClaudeWindow[] | QwenTokens

export interface UsageSnapshot {
  tool: string
  capturedAt: number
  limits: ProviderLimits
}

const snapshots = new Map<string, UsageSnapshot>()

export function recordProviderUsage(tool: string, limits: ProviderLimits, now: number = Date.now()): void {
  snapshots.set(tool, { tool, capturedAt: now, limits })
}

export function getProviderUsage(tool: string): UsageSnapshot | null {
  return snapshots.get(tool) ?? null
}

export function getAllProviderUsage(): UsageSnapshot[] {
  return [...snapshots.values()].sort((a, b) => b.capturedAt - a.capturedAt)
}

/** Test-only: usage is per-session state with no natural reset otherwise. */
export function clearProviderUsage(): void {
  snapshots.clear()
}

function ago(capturedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - capturedAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function isChatGPTLimits(limits: ProviderLimits): limits is ChatGPTLimit[] {
  return Array.isArray(limits) && (limits.length === 0 || 'feature' in limits[0])
}

function isClaudeWindows(limits: ProviderLimits): limits is ClaudeWindow[] {
  return Array.isArray(limits) && limits.length > 0 && 'window' in limits[0]
}

/**
 * Renders a snapshot for the agent to read.
 *
 * States it plainly when a provider reports no limit at all, rather than
 * letting an empty list read as "zero remaining" — the two mean opposite
 * things, and guessing wrong would have the agent refuse work the account
 * could actually do.
 */
export function formatUsage(snapshot: UsageSnapshot, now: number = Date.now()): string {
  const head = `${snapshot.tool} (captured ${ago(snapshot.capturedAt, now)})`
  const { limits } = snapshot

  if (isClaudeWindows(limits)) {
    const rows = limits.map(w => {
      const resets = w.resetsAt ? `, resets ${new Date(w.resetsAt * 1000).toISOString()}` : ''
      return `  ${w.window}: ${Math.round(w.utilization * 100)}% used (${w.status}${resets})`
    })
    return `${head}\n${rows.join('\n')}`
  }

  if (isChatGPTLimits(limits)) {
    if (limits.length === 0) return `${head}\n  no quota limits reported for this account`
    const rows = limits.map(l => `  ${l.feature}: ${l.remaining} remaining (resets ${l.resetAfter})`)
    return `${head}\n${rows.join('\n')}`
  }

  const t = limits
  const reasoning = t.reasoningTokens ? `, reasoning ${t.reasoningTokens}` : ''
  return `${head}\n  tokens this turn: ${t.totalTokens} total (in ${t.inputTokens}, out ${t.outputTokens}${reasoning})`
}
