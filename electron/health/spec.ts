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

/** Reads a nested field of an RPC answer without trusting its shape. */
const at = (v: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string | number, unknown>)[k] : undefined), v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

// Rehearsals guard every open view of the site (view.url), so a tool that
// works in another tab of the same site cannot slip a request past the block.
export const PLATFORMS: PlatformSpec[] = [
  {
    id: 'chatgpt',
    read: { rpc: 'chatgpt.models', params: {} },
    rehearsals: [{
      // Renames the newest chat to the title it already has.
      tool: 'chatgpt_chat_update', rpc: 'chatgpt.updateChat', view: { url: 'chatgpt.com' },
      urlPattern: '*://chatgpt.com/backend-api/conversation/*', method: 'PATCH',
      prepare: async invoke => {
        const r = await invoke('chatgpt.chats', { limit: 1 })
        const chatId = at(r, 'chats', 0, 'id'), title = at(r, 'chats', 0, 'title')
        return str(chatId) && str(title) ? { chatId, title } : null
      },
    }],
  },
  {
    id: 'flow',
    read: { rpc: 'flow.listProjects', params: {} },
    bundle: { view: { url: 'flow.google.com' }, needles: ['MZZa6b', 'QI2zvc', 'UpteDb', 'YhhmEf', 'Zzl0ze', 'jHPbke', 'jwpduf', 'ogiZ0b'] },
    rehearsals: [{
      // A leak would add one empty project; no credits are spent.
      tool: 'flow_create_project', rpc: 'flow.createProject', view: { url: 'flow.google.com' },
      urlPattern: '*batchexecute*rpcids=jHPbke*', method: 'POST',
      params: { title: 'FlowDesk health check' },
    }],
  },
  {
    id: 'pinterest',
    read: { rpc: 'pinterest.myBoards', params: { account: '1', limit: 5 } },
    bundle: { view: { tab: 'social-pinterest' }, needles: ['BoardResource', 'PinResource', 'ScheduledPinsResource', 'RepinResource', 'BaseSearchResource', 'UserResource'] },
    rehearsals: [{
      // A leak would add one secret board only the account can see.
      tool: 'pinterest_create_board', rpc: 'pinterest.createBoard', view: { url: 'pinterest.com' },
      urlPattern: '*://*pinterest.com/resource/BoardResource/create/*', method: 'POST',
      params: { account: '1', name: 'FlowDesk health check', secret: true },
    }, {
      // Saves a pin's current title unchanged.
      tool: 'pinterest_edit_pin', rpc: 'pinterest.editPin', view: { url: 'pinterest.com' },
      urlPattern: '*://*pinterest.com/resource/PinResource/update/*', method: 'POST',
      prepare: async invoke => {
        const boards = at(await invoke('pinterest.myBoards', { account: '1', limit: 10 }), 'boards')
        const boardUrl = at((Array.isArray(boards) ? boards : []).find(b => Number(at(b, 'pinCount')) > 0), 'url')
        if (!str(boardUrl)) return null
        const r = await invoke('pinterest.boardPins', { account: '1', boardUrl, limit: 1 })
        const pinId = at(r, 'pins', 0, 'id'), title = at(r, 'pins', 0, 'title')
        return str(pinId) && str(title) ? { account: '1', pinId, title } : null
      },
    }],
  },
  {
    id: 'gumroad',
    read: { rpc: 'gumroad.products', params: { account: GUMROAD_ACCOUNT } },
    rehearsals: [{
      // Saves the product's current summary unchanged: a leak would be a no-op.
      tool: 'gumroad_edit_product', rpc: 'gumroad.editProduct', view: { url: 'gumroad.com' },
      urlPattern: `*://gumroad.com/links/${GUMROAD_PRODUCT}*`, method: 'POST',
      prepare: async invoke => {
        const r = await invoke('gumroad.product', { account: GUMROAD_ACCOUNT, permalink: GUMROAD_PRODUCT })
        const summary = at(r, 'product', 'summary')
        return at(r, 'ok') && typeof summary === 'string' ? { account: GUMROAD_ACCOUNT, permalink: GUMROAD_PRODUCT, summary } : null
      },
    }],
  },
  {
    id: 'linkedin',
    read: { rpc: 'linkedin.status', params: {} },
    bundle: { view: { url: 'linkedin.com' }, needles: ['voyagerContentcreationDashShares', 'voyagerFeedDashProfileUpdates', 'voyagerSearchDashClusters'] },
    rehearsals: [{
      // Saves the current headline unchanged. The tool clicks Save in the
      // page, which posts an SDUI server request (captured 2026-10-07).
      tool: 'linkedin_update_profile', rpc: 'linkedin.updateProfile', view: { url: 'linkedin.com' },
      urlPattern: '*sduiid=com.linkedin.sdui.requests.profile.saveProfileIntroForm*', method: 'POST',
      prepare: async invoke => {
        const headline = at(await invoke('linkedin.getProfile', {}), 'profile', 'headline')
        return str(headline) ? { headline } : null
      },
    }],
  },
  {
    // facebook_follow and the other writes ask for an in-app Allow every
    // time, so they cannot run unattended; only the read and ids are checked.
    id: 'facebook',
    read: { rpc: 'facebook.feed', params: { limit: 1 } },
    bundle: { view: { url: 'facebook.com' }, needles: ['27300941309579835', '27646120298312844', '27687311557628355', '27757775690570026', '28018963647735121', '28162094913407624', '28386627231026039'] },
  },
  {
    id: 'reddit',
    read: { rpc: 'reddit.status', params: {} },
    rehearsals: [{
      // Clears the vote on the newest home-feed post, which is almost always unvoted.
      tool: 'reddit_vote_post', rpc: 'reddit.votePost', view: { url: 'reddit.com' },
      urlPattern: '*://www.reddit.com/svc/shreddit/graphql*', method: 'POST',
      prepare: async invoke => {
        const postId = at(await invoke('reddit.feed', { limit: 1 }), 'posts', 0, 'id')
        return str(postId) ? { postId, voteState: 'NONE' } : null
      },
    }],
  },
  {
    id: 'tiktok',
    read: { rpc: 'tiktok.status', params: {} },
    rehearsals: [{
      // Saves the newest video's caption unchanged.
      tool: 'tiktok_edit_video_caption', rpc: 'tiktok.editVideoCaption', view: { url: 'tiktok.com' },
      urlPattern: '*://www.tiktok.com/tiktok/post/edit/*', method: 'POST',
      prepare: async invoke => {
        const r = await invoke('tiktok.listPosts', { account: '1' })
        const videoId = at(r, 'posts', 0, 'id'), caption = at(r, 'posts', 0, 'caption')
        return str(videoId) && typeof caption === 'string' ? { account: '1', videoId, caption } : null
      },
    }],
  },
  {
    // WhatsApp sends over its websocket, which a request block cannot stop,
    // so instead the page modules whatsapp_send drives are looked up.
    id: 'whatsapp',
    read: { rpc: 'whatsapp.status', params: {} },
    bundle: { view: { url: 'web.whatsapp.com' }, needles: ['WAWebSendTextMsgChatAction', 'WAWebFindChatAction', 'WAWebWidFactory', 'WAWebCollections', 'WAWebChatCollection', 'WAWebChatLoadMessages', 'WAWebChatSendMessages', 'WAWebMediaPrep', 'WAWebPrepRawMedia'] },
  },
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
