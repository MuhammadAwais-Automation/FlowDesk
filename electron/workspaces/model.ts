/**
 * Workspaces: named browsers inside FlowDesk. Each one has its own persistent
 * partition (its own cookies and logins — a second TikTok account is just
 * another workspace), its own tabs, and can open any website. Agents open and
 * drive its tabs through the gateway; the user watches them work.
 *
 * Pure shapes and rules here; electron/workspaces/manager.ts owns the views.
 */

export interface WorkspaceTab {
  id: string
  url: string
  title: string
}

export interface BrowserWorkspace {
  id: string
  name: string
  color: string
  /** Electron partition without the `persist:` prefix: `ws-<id>`. */
  partition: string
  tabs: WorkspaceTab[]
  activeTab: string | null
  created: string
}

export const WS_PREFIX = 'ws-'
export const MAX_TABS = 24
export const COLORS = ['#D97706', '#2563EB', '#16A34A', '#DB2777', '#7C3AED', '#0891B2', '#DC2626', '#4B5563']

export function newId(rand: () => number = Math.random): string {
  let s = ''
  while (s.length < 6) s += Math.floor(rand() * 36).toString(36)
  return s
}

export function createWorkspace(name: string, existing: BrowserWorkspace[], now = new Date(), rand: () => number = Math.random): BrowserWorkspace {
  let id = newId(rand)
  while (existing.some(w => w.id === id)) id = newId(rand)
  return {
    id,
    name: name.trim().slice(0, 40),
    color: COLORS[existing.length % COLORS.length],
    partition: `${WS_PREFIX}${id}`,
    tabs: [],
    activeTab: null,
    created: now.toISOString(),
  }
}

/** The view (tab) id sessions.ts keys it by: `ws-<workspace>-<tab>`. */
export const viewIdFor = (ws: Pick<BrowserWorkspace, 'id'>, tab: Pick<WorkspaceTab, 'id'>) => `${WS_PREFIX}${ws.id}-${tab.id}`

export function parseViewId(viewId: string): { ws: string; tab: string } | null {
  const m = /^ws-([a-z0-9]+)-(t\d+)$/.exec(viewId)
  return m ? { ws: m[1], tab: m[2] } : null
}

export function nextTabId(ws: BrowserWorkspace): string {
  const max = ws.tabs.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0)
  return `t${max + 1}`
}

/** By id, or by name ignoring case. */
export function findWorkspace(list: BrowserWorkspace[], key: string): BrowserWorkspace | null {
  const k = key.trim().toLowerCase()
  if (!k) return null
  return list.find(w => w.id === k) ?? list.find(w => w.name.toLowerCase() === k) ?? null
}

/**
 * What the address bar typed means: a url (scheme added when missing) or a
 * Google search. Only http(s) and about:blank are ever opened — file:,
 * javascript: and the like are refused (null).
 */
export function normalizeUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (s === 'about:blank') return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^localhost:\d+/i.test(s)) {
    try {
      const u = new URL(s)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
    } catch { return null }
  }
  const looksLikeHost = !/\s/.test(s) && (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/i.test(s))
  if (looksLikeHost) {
    try { return new URL(`${/^localhost/i.test(s) ? 'http' : 'https'}://${s}`).toString() } catch { return null }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

export function hostLabel(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

/** One line in a workspace's agent log. */
export interface AgentActivity {
  at: string
  view: string
  kind: 'open' | 'navigate' | 'snapshot' | 'act' | 'approval' | 'close' | 'blocked'
  text: string
  ok: boolean
}

export const MAX_ACTIVITY = 150

export function pushActivity(log: AgentActivity[], entry: AgentActivity): AgentActivity[] {
  const next = [...log, entry]
  return next.length > MAX_ACTIVITY ? next.slice(-MAX_ACTIVITY) : next
}

/** Keeps only well-formed workspaces from a file someone may have edited by hand. */
export function sanitizeStored(raw: unknown): BrowserWorkspace[] {
  if (!Array.isArray(raw)) return []
  const out: BrowserWorkspace[] = []
  for (const w of raw as Partial<BrowserWorkspace>[]) {
    if (!w || typeof w.id !== 'string' || !/^[a-z0-9]+$/.test(w.id) || typeof w.name !== 'string') continue
    if (out.some(o => o.id === w.id)) continue
    const tabs = Array.isArray(w.tabs)
      ? w.tabs.filter((t): t is WorkspaceTab => !!t && typeof t.id === 'string' && /^t\d+$/.test(t.id) && typeof t.url === 'string' && normalizeUrl(t.url) != null)
        .map(t => ({ id: t.id, url: t.url, title: typeof t.title === 'string' ? t.title : '' }))
        .slice(0, MAX_TABS)
      : []
    out.push({
      id: w.id,
      name: w.name,
      color: typeof w.color === 'string' ? w.color : COLORS[0],
      partition: typeof w.partition === 'string' && /^[\w-]+$/.test(w.partition) ? w.partition : `${WS_PREFIX}${w.id}`,
      tabs,
      activeTab: tabs.some(t => t.id === w.activeTab) ? w.activeTab! : tabs[0]?.id ?? null,
      created: typeof w.created === 'string' ? w.created : new Date(0).toISOString(),
    })
  }
  return out
}
