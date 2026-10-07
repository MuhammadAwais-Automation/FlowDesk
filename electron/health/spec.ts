/**
 * What the health check runs per platform, and the registry of every tool.
 *
 * Ids under `bundle.needles` are the ones our tools send today (from the
 * bridges); keep them in step when a tool changes. Rehearsals are only the
 * ones whose request, even if it leaked, would change nothing visible.
 */
import { canonicalAction, isWriteAction } from '../gateway/actionPolicy'

export type Invoke = (method: string, params: Record<string, unknown>) => Promise<unknown>
export interface ViewRef { tab?: string; url?: string }

export interface RehearsalSpec {
  tool: string
  rpc: string
  view: ViewRef
  urlPattern: string
  method?: string
  params?: Record<string, unknown>
  /** Builds params from a read first (e.g. the current value, so a leak would be a no-op). */
  prepare?: (invoke: Invoke) => Promise<Record<string, unknown> | null>
}

export interface PlatformSpec {
  id: string
  read: { rpc: string; params: Record<string, unknown> }
  bundle?: { view: ViewRef; needles: string[] }
  rehearsals?: RehearsalSpec[]
}

const GUMROAD_ACCOUNT = '2'
const GUMROAD_PRODUCT = 'apmbod'

export const PLATFORMS: PlatformSpec[] = [
  { id: 'chatgpt', read: { rpc: 'chatgpt.models', params: {} } },
  {
    id: 'flow',
    read: { rpc: 'flow.listProjects', params: {} },
    bundle: { view: { url: 'flow.google.com' }, needles: ['MZZa6b', 'QI2zvc', 'UpteDb', 'YhhmEf', 'Zzl0ze', 'jHPbke', 'jwpduf', 'ogiZ0b'] },
  },
  {
    id: 'pinterest',
    read: { rpc: 'pinterest.myBoards', params: { account: '1', limit: 5 } },
    bundle: { view: { tab: 'social-pinterest' }, needles: ['BoardResource', 'PinResource', 'ScheduledPinsResource', 'RepinResource', 'BaseSearchResource', 'UserResource'] },
    rehearsals: [{
      // A leak would add one secret board only the account can see.
      tool: 'pinterest_create_board', rpc: 'pinterest.createBoard', view: { tab: 'social-pinterest' },
      urlPattern: '*://*pinterest.com/resource/BoardResource/create/*', method: 'POST',
      params: { account: '1', name: 'FlowDesk health check', secret: true },
    }],
  },
  {
    id: 'gumroad',
    read: { rpc: 'gumroad.products', params: { account: GUMROAD_ACCOUNT } },
    rehearsals: [{
      // Saves the product's current summary unchanged: a leak would be a no-op.
      tool: 'gumroad_edit_product', rpc: 'gumroad.editProduct', view: { tab: `social-gumroad-${GUMROAD_ACCOUNT}` },
      urlPattern: `*://gumroad.com/links/${GUMROAD_PRODUCT}*`, method: 'POST',
      prepare: async invoke => {
        const r = await invoke('gumroad.product', { account: GUMROAD_ACCOUNT, permalink: GUMROAD_PRODUCT }) as { ok?: boolean; product?: { summary?: string | null } }
        return r?.ok && typeof r.product?.summary === 'string' ? { account: GUMROAD_ACCOUNT, permalink: GUMROAD_PRODUCT, summary: r.product.summary } : null
      },
    }],
  },
  {
    id: 'linkedin',
    read: { rpc: 'linkedin.status', params: {} },
    bundle: { view: { url: 'linkedin.com' }, needles: ['voyagerContentcreationDashShares', 'voyagerFeedDashProfileUpdates', 'voyagerSearchDashClusters'] },
  },
  {
    id: 'facebook',
    read: { rpc: 'facebook.feed', params: { limit: 1 } },
    bundle: { view: { url: 'facebook.com' }, needles: ['27300941309579835', '27646120298312844', '27687311557628355', '27757775690570026', '28018963647735121', '28162094913407624', '28386627231026039'] },
  },
  { id: 'reddit', read: { rpc: 'reddit.status', params: {} } },
  { id: 'tiktok', read: { rpc: 'tiktok.status', params: {} } },
  { id: 'whatsapp', read: { rpc: 'whatsapp.status', params: {} } },
]

export interface RegistryEntry { tool: string; kind: 'read' | 'write'; verifiedBy: string }

/** Every gateway tool grouped by platform, with how the health check covers it. */
export function toolRegistry(rpcNames: readonly string[]): Record<string, RegistryEntry[]> {
  const out: Record<string, RegistryEntry[]> = {}
  for (const name of [...rpcNames].sort()) {
    const platform = name.split('.')[0]
    const spec = PLATFORMS.find(p => p.id === platform)
    const write = isWriteAction(canonicalAction(name))
    const rehearsed = spec?.rehearsals?.some(r => r.rpc === name)
    const verifiedBy = name === spec?.read.rpc ? 'L1 read'
      : rehearsed ? 'L3 rehearsal'
      : spec?.bundle && write ? 'L2 bundle ids (indirect)'
      : spec ? 'L1 platform session (indirect)'
      : 'not covered'
    ;(out[platform] ??= []).push({ tool: canonicalAction(name), kind: write ? 'write' : 'read', verifiedBy })
  }
  return out
}
