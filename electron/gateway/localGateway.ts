/**
 * FlowDesk Local Gateway.
 *
 * Runs a lightweight, authenticated HTTP server on 127.0.0.1 inside Electron's
 * main process. Exposes FlowDesk's live browser bridges (Reddit, WhatsApp, LinkedIn)
 * to external tools: the FlowDesk CLI and the FlowDesk MCP server.
 *
 * Security:
 * - Listens ONLY on 127.0.0.1 (never exposed to local network or public interfaces).
 * - Requires Bearer token authentication generated fresh on startup.
 * - Writes connection parameters (port, token, pid) to ~/.flowdesk/gateway.json
 *   and deletes it on shutdown.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app, BrowserWindow, webContents as allWebContents } from 'electron'
import { z } from 'zod'
import {
  rdStatus,
  rdFeed,
  rdPostComments,
  rdSearch,
  rdVotePost,
  rdVoteComment,
  rdCreateComment,
  rdCreatePost,
  rdSubscribe,
  rdMarkRead,
  rdApiFeed,
  rdApiSearch,
  rdApiPostComments,
  rdApiOutlier,
} from '../reddit'
import {
  waStatus,
  waListChats,
  waListMessages,
  waSend,
  waUnreadWithMessages,
  waApiListChats,
  waApiListMessages,
} from '../whatsapp/whatsapp'
import {
  liStatus,
  liFeed,
  liPostComments,
  liSearch,
  liSend,
  liMarkRead,
  liListChats,
  liListMessages,
  liUnread,
  liApiFeed,
  liApiOutlier,
  liGetProfile,
  liUpdateProfile,
  liUploadProfilePhoto,
  liUploadCoverImage,
  liAccounts,
  liSwitchAccount,
  call as liCall,
} from '../linkedin/linkedin'
import {
  tkStatus,
  tkFeed,
  tkSearch,
  tkVideoDetail,
  tkSuggest,
  tkOutlier,
  tkEval,
  tkUploadVideo,
  tkSubmitPost,
  tkAccounts,
  tkSwitchAccount,
  tkListPosts,
  tkDeleteVideo,
  tkDeleteAllVideos,
  tkApiSearch,
  tkApiCreatorFeed,
  tkApiOutlier,
  tkApiVideoDetail,
  tkApiBatchOutliers,
  tkWarmupScroll,
  tkEditVideoCaption,
} from '../tiktok/tiktok'
import { tkGetProfile, tkUpdateProfile } from '../tiktok/tiktokProfile'
import { tkApiUploadVideo } from '../tiktok/tiktokUpload'
import { canonicalAction, createActionGuard, isWriteAction, policyPaths, type ApprovalRequest } from './actionPolicy'

type Guard = <T>(method: string, params: Record<string, unknown>, run: () => Promise<T>) => Promise<T>
// Replaced by startLocalGateway; module-level because workflows.run dispatches
// through RPC_HANDLERS too, and its steps must meet the same policy.
let guard: Guard = (_m, _p, run) => run()
import { askBrowserProvider, workerProgress } from '../agent/browserWorkerQueue'
import { radarCollectOnce, radarReportFor, radarStatus, startRadar, stopRadar } from '../tiktok/tiktokRadar'
import { loadNiches, removeNiche, upsertNiche } from '../tiktok/tiktokRadarStore'
import {
  pinterestAudience, pinterestBoardPins, pinterestCreateBoard, pinterestCreatePin, pinterestDeleteBoard, pinterestDeletePin,
  pinterestDeleteScheduledPin, pinterestEditPin, pinterestInbox, pinterestMe, pinterestMyBoards, pinterestNicheResearch,
  pinterestNotifications, pinterestOutlier, pinterestPin, pinterestRelated, pinterestSavePin, pinterestScheduledPins, pinterestSearch,
  pinterestStatus, pinterestSuggest, pinterestTrends, pinterestUser, pinterestUserBoards, pinterestUserPins,
} from '../pinterest'
import {
  gumroadCreateDiscount, gumroadCreateProduct, gumroadDashboard, gumroadDeleteDiscount, gumroadDeleteProduct, gumroadDiscounts,
  gumroadEditProduct, gumroadProduct, gumroadProducts, gumroadSearch, gumroadSetPublished, gumroadStatus, gumroadUploadCover, gumroadUploadThumbnail,
  gumroadUploadFile,
} from '../gumroad'
import { pinFactoryNicheScan } from '../pinFactory'

// Any non-empty account value is passed on as text, so an odd value is refused as unknown instead of meaning account 1.
const pinAccount = (p: Record<string, unknown>): string | undefined => p.account === undefined || p.account === null || p.account === '' ? undefined : String(p.account)
import { addSocialAccount, isSocialPlatform, openSocialLogin, socialAccountsStatus } from '../socialAccounts'
import { fbFeed } from '../facebook'
import { askChat, askChatgptText, chatModels, downloadImage, imageLibrary, listChats, readChat, searchChats, updateChat } from '../chatgptChats'
import { enqueueImages, imageAccounts, listJobs, openChatgptLogin, publicJob, waitForJob, type ImageRequest } from '../chatgptImages'
import { summarizeJobs } from '../chatgptImageCore'
import { openHudWidget, closeHudWidget, getHudStatus } from '../hudWidget'
import {
  flowListProjects,
  flowCreateProject,
  flowGenerateImage,
  flowGenerateVideo,
  flowGenerateVideoFromImage,
  flowExtendVideo,
  flowUploadImage,
  flowDownloadMedia,
  flowVideoModels,
  flowGetCredits,
  flowMediaStatus,
  flowListProjectMedia,
  flowEval,
  flowAccounts,
} from '../flow'
import { flowUiGenerateImage, flowUiImageModels } from '../flowUi'
import { rehearse } from '../rehearsal'
import { scanBundles } from '../bundleScan'
import { runHealth } from '../health/health'
import { listReports, writeReport } from '../reports'
import { callContext, contextFromHeaders, withLedger } from '../operator/capture'
import { BackgroundJobs } from '../operator/jobs'
import { PLATFORMS, toolRegistry } from '../health/spec'
import { findAnyViewByUrl, getViewById } from '../sessions'
import {
  initSkillsRegistry,
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
} from '../skills/skillRegistry'
import {
  runWorkflow,
  resumeWorkflowRun,
  listWorkflowRuns,
} from '../skills/workflowRunner'

/**
 * Queues the jobs and, when asked to wait, holds the call until they finish —
 * but returns before the MCP client's 15-minute limit, leaving any still
 * running to be read with chatgpt.imageJobs instead of failing the whole call.
 */
/** The optional `account` (email or partition) a Flow call should run on. */
const acct = (p: Record<string, unknown>) => (typeof p.account === 'string' && p.account ? p.account : null)

async function runImageJobs(req: ImageRequest, wait: boolean) {
  const jobs = await enqueueImages(req)
  if (wait) await Promise.all(jobs.map(j => waitForJob(j, 14 * 60_000)))
  const out = jobs.map(publicJob)
  // ok:false only when every job failed; jobs still queued/running are
  // "accepted", not failures, so the caller polls instead of starting them again.
  const { ok, state, progress } = summarizeJobs(out.map(j => j.status))
  return {
    ok,
    state,
    progress,
    ...(ok ? {} : { error: out.find(j => j.error)?.error ?? 'every image job failed' }),
    jobs: out,
    images: out.flatMap(j => j.images),
    ...(out.some(j => j.status === 'queued' || j.status === 'running') ? { note: 'some jobs are still running — read them with chatgpt.imageJobs' } : {}),
  }
}

/**
 * The one executor for workflow steps, used by MCP and by the app's own UI.
 * Each step goes through the same action guard as a direct call, and a tool
 * that does not exist fails the run up front instead of "succeeding".
 */
const workflowTool = (toolName: string, params: any) => {
  const handler = RPC_HANDLERS[toolName]
  if (!handler) throw new Error(`unknown tool "${toolName}"`)
  return guard(toolName, params || {}, () => handler(params || {}))
}
const workflowOptions = { hasTool: (name: string) => name in RPC_HANDLERS }

export function executeWorkflow(id: string, inputs: Record<string, any> = {}) {
  return runWorkflow(id, inputs, workflowTool, workflowOptions)
}

export function resumeWorkflow(runId: string) {
  return resumeWorkflowRun(runId, workflowTool, workflowOptions)
}

export interface GatewayInfo {
  port: number
  token: string
  pid: number
  startedAt: string
}

export interface GatewayServer {
  info: GatewayInfo
  stop: () => Promise<void>
}

function getGatewayFilePath(userDataPath?: string): string[] {
  // FLOWDESK_HOME lets tests keep off the real ~/.flowdesk, which the running
  // app's MCP clients read — the suite used to overwrite and then delete it.
  const paths = [join(process.env.FLOWDESK_HOME || homedir(), '.flowdesk', 'gateway.json')]
  if (userDataPath) {
    paths.push(join(userDataPath, 'gateway.json'))
  }
  return paths
}

async function writeGatewayFiles(info: GatewayInfo, userDataPath?: string): Promise<void> {
  const data = JSON.stringify(info, null, 2)
  for (const filePath of getGatewayFilePath(userDataPath)) {
    try {
      const dir = join(filePath, '..')
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(filePath, data, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Best-effort write to discovery paths
    }
  }
}

async function removeGatewayFiles(token: string, userDataPath?: string): Promise<void> {
  for (const filePath of getGatewayFilePath(userDataPath)) {
    try {
      // Only our own file: another instance may have written it since.
      const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as Partial<GatewayInfo>
      if (onDisk.token !== token) continue
      await unlink(filePath)
    } catch {
      // Ignore if already deleted
    }
  }
}

type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>

// ── Agent tool parity ────────────────────────────────────────────────────────
// The LinkedIn / WhatsApp / Facebook tool definitions (agent/defineTool.ts) are exposed
// generically so the external MCP server can mirror them without hand-written
// wrappers. The external caller is the approver here, so actions auto-approve.
interface AgentToolDef {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content?: unknown[] } & Record<string, unknown>>
  annotations?: Record<string, unknown>
}

let agentToolRegistry: Promise<Map<string, AgentToolDef>> | null = null

export async function loadAgentToolRegistry(): Promise<Map<string, AgentToolDef>> {
  if (!agentToolRegistry) {
    agentToolRegistry = (async () => {
      const [{ alwaysApprove }, li, wa, fb] = await Promise.all([
        import('../agent/approval'),
        import('../agent/linkedinTools'),
        import('../agent/whatsappTools'),
        import('../agent/facebookTools'),
      ])
      const all = [
        ...li.createLinkedInTools(alwaysApprove),
        ...wa.createWhatsAppTools(alwaysApprove),
        ...fb.createFacebookTools(alwaysApprove),
      ] as unknown as AgentToolDef[]
      const map = new Map<string, AgentToolDef>()
      for (const t of all) map.set(t.name, t)
      return map
    })().catch((err) => {
      agentToolRegistry = null
      throw err
    })
  }
  return agentToolRegistry
}

/** Test hook: drop the cached registry so mocked factories are re-read. */
export function resetAgentToolRegistry(): void {
  agentToolRegistry = null
}

/** The optional WhatsApp `account` (id, label or partition; number ids allowed). */
const waAccount = (p: Record<string, unknown>) => (typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined)

const RPC_HANDLERS: Record<string, RpcHandler> = {
  // Reddit methods
  'reddit.status': async (p) => rdStatus(p.account as string),
  'reddit.feed': async (p) => rdFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: p.sort as any,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
    after: typeof p.after === 'string' ? p.after : undefined,
    timeFilter: p.timeFilter as any,
  }, p.account as string),
  'reddit.postComments': async (p) => rdPostComments(
    String(p.subreddit || ''),
    String(p.postId || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
    p.account as string,
  ),
  'reddit.search': async (p) => rdSearch(
    String(p.query || ''),
    p.sort as any,
    typeof p.limit === 'number' ? p.limit : undefined,
    typeof p.t === 'string' ? p.t as any : undefined,
    p.account as string,
  ),
  'reddit.votePost': async (p) => rdVotePost(String(p.postId || ''), p.voteState as any, p.account as string),
  'reddit.voteComment': async (p) => rdVoteComment(String(p.commentId || ''), p.voteState as any, p.account as string),
  'reddit.createComment': async (p) => rdCreateComment(String(p.postId || ''), String(p.parentId || ''), String(p.text || ''), p.account as string),
  'reddit.createPost': async (p) => rdCreatePost(String(p.subreddit || ''), String(p.title || ''), typeof p.body === 'string' ? p.body : undefined, p.account as string),
  'reddit.subscribe': async (p) => rdSubscribe(String(p.subredditId || ''), p.subscribeState as any, p.account as string),
  'reddit.markRead': async (p) => rdMarkRead(p.account as string),
  'reddit.api_feed': async (p) => rdApiFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: typeof p.sort === 'string' ? p.sort : undefined,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }, p.account as string),
  'reddit.apiFeed': async (p) => rdApiFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: typeof p.sort === 'string' ? p.sort : undefined,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }, p.account as string),
  'reddit.api_search': async (p) => rdApiSearch(
    String(p.query || ''),
    {
      subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      sort: typeof p.sort === 'string' ? p.sort as any : undefined,
      t: typeof p.t === 'string' ? p.t as any : undefined,
    },
    p.account as string,
  ),
  'reddit.apiSearch': async (p) => rdApiSearch(
    String(p.query || ''),
    {
      subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      sort: typeof p.sort === 'string' ? p.sort as any : undefined,
      t: typeof p.t === 'string' ? p.t as any : undefined,
    },
    p.account as string,
  ),
  'reddit.api_post_comments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
    p.account as string,
  ),
  'reddit.apiPostComments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
    p.account as string,
  ),
  'reddit.api_comments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
    p.account as string,
  ),
  'reddit.outlier': async (p) => rdApiOutlier(
    String(p.subreddit || p.sub || ''),
    typeof p.minMultiplier === 'number' ? p.minMultiplier : (typeof p.multiplier === 'number' ? p.multiplier : 3.0),
    { sort: typeof p.sort === 'string' ? p.sort as any : undefined, t: typeof p.t === 'string' ? p.t as any : undefined },
    p.account as string,
  ),

  // WhatsApp methods. `account` (id, label or partition) routes through the
  // social account registry; an explicit unknown account is an error.
  // api_chats/apiChats/api_messages/apiMessages are older aliases.
  'whatsapp.status': async (p) => waStatus(waAccount(p)),
  'whatsapp.listChats': async (p) => waListChats(typeof p.limit === 'number' ? p.limit : undefined, Boolean(p.onlyUnread || p.unread), waAccount(p)),
  'whatsapp.listMessages': async (p) => waListMessages(String(p.chatId || p.id || ''), typeof p.limit === 'number' ? p.limit : undefined, waAccount(p)),
  'whatsapp.send': async (p) => waSend(String(p.chatId || ''), typeof p.text === 'string' ? p.text : '', waAccount(p)),
  'whatsapp.unread': async (p) => waUnreadWithMessages(typeof p.limit === 'number' ? p.limit : 10, undefined, waAccount(p)),
  'whatsapp.api_chats': async (p) => waApiListChats(typeof p.limit === 'number' ? p.limit : undefined, Boolean(p.onlyUnread || p.unread), waAccount(p)),
  'whatsapp.apiChats': async (p) => waApiListChats(typeof p.limit === 'number' ? p.limit : undefined, Boolean(p.onlyUnread || p.unread), waAccount(p)),
  'whatsapp.api_messages': async (p) => waApiListMessages(String(p.chatId || p.id || ''), typeof p.limit === 'number' ? p.limit : undefined, waAccount(p)),
  'whatsapp.apiMessages': async (p) => waApiListMessages(String(p.chatId || p.id || ''), typeof p.limit === 'number' ? p.limit : undefined, waAccount(p)),

  // LinkedIn methods
  // One account list for every social platform (electron/socialAccounts.ts)
  'pinterest.status': async (p) => pinterestStatus(pinAccount(p)),
  'pinterest.user': async (p) => pinterestUser(p.username, pinAccount(p)),
  'pinterest.userBoards': async (p) => pinterestUserBoards(p.username, { limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.userPins': async (p) => pinterestUserPins(p.username, { limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.boardPins': async (p) => pinterestBoardPins({ boardUrl: p.boardUrl, boardId: p.boardId }, { limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.pin': async (p) => pinterestPin(p.pinId ?? p.id ?? p.url, pinAccount(p)),
  'pinterest.related': async (p) => pinterestRelated(p.pinId ?? p.id ?? p.url, { limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.suggest': async (p) => pinterestSuggest(p.term ?? p.query, pinAccount(p)),
  'pinterest.search': async (p) => pinterestSearch(p.query, { limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.outlier': async (p) => pinterestOutlier({ username: p.username, boardUrl: p.boardUrl }, { limit: p.limit, minMultiplier: p.minMultiplier, account: pinAccount(p) }),
  'pinterest.me': async (p) => pinterestMe(pinAccount(p)),
  'pinterest.trends': async (p) => pinterestTrends({ country: p.country, type: p.type, limit: p.limit, account: pinAccount(p) }),
  'pinterest.audience': async (p) => pinterestAudience(pinAccount(p)),
  'pinterest.myBoards': async (p) => pinterestMyBoards({ limit: p.limit, bookmark: p.bookmark, account: pinAccount(p) }),
  'pinterest.inbox': async (p) => pinterestInbox(pinAccount(p)),
  'pinterest.notifications': async (p) => pinterestNotifications(pinAccount(p)),
  'pinterest.nicheResearch': async (p) => pinterestNicheResearch({ niche: p.niche, country: p.country, queries: p.queries, account: pinAccount(p) }),
  'pinterest.scheduledPins': async (p) => pinterestScheduledPins(pinAccount(p)),
  'pinterest.createBoard': async (p) => pinterestCreateBoard({ name: p.name, description: p.description, secret: p.secret, account: pinAccount(p) }),
  'pinterest.savePin': async (p) => pinterestSavePin({ pinId: p.pinId, boardId: p.boardId, account: pinAccount(p) }),
  'pinterest.createPin': async (p) => pinterestCreatePin({
    imagePath: p.imagePath, boardId: p.boardId, title: p.title, description: p.description, link: p.link, altText: p.altText,
    publishAt: p.publishAt, account: pinAccount(p),
  }),
  'pinterest.editPin': async (p) => pinterestEditPin({
    pinId: p.pinId, title: p.title, description: p.description, link: p.link, altText: p.altText, boardId: p.boardId, account: pinAccount(p),
  }),
  'pinterest.deletePin': async (p) => pinterestDeletePin({ pinId: p.pinId, account: pinAccount(p) }),
  'pinterest.deleteBoard': async (p) => pinterestDeleteBoard({ boardId: p.boardId, account: pinAccount(p) }),
  'pinterest.deleteScheduledPin': async (p) => pinterestDeleteScheduledPin({ scheduledPinId: p.scheduledPinId, account: pinAccount(p) }),
  'gumroad.status': async (p) => gumroadStatus(pinAccount(p)),
  'gumroad.products': async (p) => gumroadProducts({ page: p.page, account: pinAccount(p) }),
  'gumroad.product': async (p) => gumroadProduct({ permalink: p.permalink, account: pinAccount(p) }),
  'gumroad.dashboard': async (p) => gumroadDashboard(pinAccount(p)),
  'gumroad.search': async (p) => gumroadSearch({ query: p.query, limit: p.limit, account: pinAccount(p) }),
  'gumroad.discounts': async (p) => gumroadDiscounts(pinAccount(p)),
  'gumroad.createProduct': async (p) => gumroadCreateProduct({ name: p.name, price: p.price, type: p.type, account: pinAccount(p) }),
  'gumroad.editProduct': async (p) => gumroadEditProduct({
    permalink: p.permalink, name: p.name, price: p.price, description: p.description, summary: p.summary, tags: p.tags, account: pinAccount(p),
  }),
  'gumroad.uploadCover': async (p) => gumroadUploadCover({ permalink: p.permalink, imagePath: p.imagePath, account: pinAccount(p) }),
  'gumroad.uploadThumbnail': async (p) => gumroadUploadThumbnail({ permalink: p.permalink, imagePath: p.imagePath, account: pinAccount(p) }),
  'gumroad.uploadFile': async (p) => gumroadUploadFile({ permalink: p.permalink, filePath: p.filePath, account: pinAccount(p) }),
  'gumroad.publishProduct': async (p) => gumroadSetPublished({ permalink: p.permalink, published: true, account: pinAccount(p) }),
  'gumroad.unpublishProduct': async (p) => gumroadSetPublished({ permalink: p.permalink, published: false, account: pinAccount(p) }),
  'gumroad.deleteProduct': async (p) => gumroadDeleteProduct({ permalink: p.permalink, account: pinAccount(p) }),
  'gumroad.createDiscount': async (p) => gumroadCreateDiscount({
    code: p.code, name: p.name, percent: p.percent, amount: p.amount, products: p.products, maxUses: p.maxUses, expiresAt: p.expiresAt, account: pinAccount(p),
  }),
  'gumroad.deleteDiscount': async (p) => gumroadDeleteDiscount({ id: p.id, account: pinAccount(p) }),
  'pinFactory.nicheScan': async (p) => pinFactoryNicheScan({
    candidates: p.candidates, country: p.country, account: pinAccount(p),
    gumroadAccount: p.gumroadAccount === undefined || p.gumroadAccount === null || p.gumroadAccount === '' ? undefined : String(p.gumroadAccount),
  }),
  'social.accounts': async (p) => socialAccountsStatus(isSocialPlatform(p.platform) ? p.platform : undefined),
  'social.addAccount': async (p) => isSocialPlatform(p.platform)
    ? (() => {
        try {
          const account = addSocialAccount(p.platform, typeof p.label === 'string' ? p.label : undefined, {
            googleAccount: typeof p.googleAccount === 'string' && p.googleAccount.trim() ? p.googleAccount : undefined,
            account: typeof p.account === 'string' || typeof p.account === 'number' ? String(p.account) : undefined,
          })
          return { ok: true, account, next: 'sign in with social.openLogin' }
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
      })()
    : { ok: false, error: 'platform must be one of whatsapp, tiktok, linkedin, reddit, facebook, pinterest, gumroad' },
  'social.openLogin': async (p) => isSocialPlatform(p.platform)
    ? openSocialLogin(p.platform, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : null)
    : { ok: false, error: 'platform must be one of whatsapp, tiktok, linkedin, reddit, facebook, pinterest, gumroad' },

  // Facebook read. Writes stay on the agent tools (tools.call → facebook_*),
  // the single place their arguments are validated. A present-but-odd account
  // becomes a string so it is refused as unknown, never read as account 1.
  'facebook.feed': async (p) => fbFeed(
    typeof p.count === 'number' ? p.count : undefined,
    typeof p.cursor === 'string' && p.cursor ? p.cursor : undefined,
    p.account == null ? undefined : String(p.account),
  ),

  'linkedin.accounts': async () => liAccounts(),
  'linkedin.switchAccount': async (p) => liSwitchAccount(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : '1'),
  'linkedin.status': async (p) => liStatus(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.feed': async (p) => liFeed(typeof p.limit === 'number' ? p.limit : undefined, typeof p.start === 'number' ? p.start : 0, typeof p.sortBy === 'string' ? p.sortBy : typeof p.sort === 'string' ? p.sort : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'linkedin.postComments': async (p) => liPostComments(String(p.activityId || ''), typeof p.limit === 'number' ? p.limit : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'linkedin.search': async (p) => liSearch(String(p.query || ''), typeof p.resultType === 'string' ? p.resultType : undefined, typeof p.limit === 'number' ? p.limit : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'linkedin.send': async (p) => liSend(String(p.conversationUrn || ''), String(p.text || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'linkedin.markRead': async (p) => liMarkRead(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.listChats': async (p) => liListChats({
    limit: typeof p.limit === 'number' ? p.limit : undefined,
    cursor: typeof p.cursor === 'string' ? p.cursor : undefined,
    onlyUnread: Boolean(p.onlyUnread),
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),
  'linkedin.listMessages': async (p) => liListMessages(String(p.conversationUrn || ''), typeof p.limit === 'number' ? p.limit : undefined, typeof p.before === 'number' ? p.before : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'linkedin.unread': async (p) => liUnread(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.api_feed': async (p) => liApiFeed(
    typeof p.limit === 'number' ? p.limit : undefined,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  ),
  'linkedin.apiFeed': async (p) => liApiFeed(
    typeof p.limit === 'number' ? p.limit : undefined,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  ),
  'linkedin.outlier': async (p) => liApiOutlier({
    minMultiplier: typeof p.minMultiplier === 'number' ? p.minMultiplier : (typeof p.multiplier === 'number' ? p.multiplier : 3.0),
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }, typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.getProfile': async (p) => liGetProfile(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.profile': async (p) => liGetProfile(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.updateProfile': async (p) => liUpdateProfile({
    firstName: typeof p.firstName === 'string' ? p.firstName : undefined,
    lastName: typeof p.lastName === 'string' ? p.lastName : undefined,
    headline: typeof p.headline === 'string' ? p.headline : undefined,
    location: typeof p.location === 'string' ? p.location : undefined,
    summary: typeof p.summary === 'string' ? p.summary : undefined,
  }, typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.uploadProfilePhoto': async (p) => liUploadProfilePhoto(String(p.imagePath || p.path || p.file || ''), typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.uploadPhoto': async (p) => liUploadProfilePhoto(String(p.imagePath || p.path || p.file || ''), typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.uploadCoverImage': async (p) => liUploadCoverImage(String(p.imagePath || p.path || p.file || ''), typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.uploadCover': async (p) => liUploadCoverImage(String(p.imagePath || p.path || p.file || ''), typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.eval': async (p) => liCall(String(p.code || ''), 15000, typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),

  // TikTok methods
  'tiktok.accounts': async () => tkAccounts(),
  'tiktok.switchAccount': async (p) => tkSwitchAccount(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : '1'),
  'tiktok.apiUploadVideo': async (p) => tkApiUploadVideo({
    filePath: String(p.filePath || ''),
    caption: typeof p.caption === 'string' ? p.caption : undefined,
    privacy: p.privacy === 'public' || p.privacy === 'friends' ? p.privacy : 'private',
    scheduleAt: typeof p.scheduleAt === 'string' || typeof p.scheduleAt === 'number' ? p.scheduleAt : undefined,
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),
  'tiktok.updateProfile': async (p) => tkUpdateProfile({
    bio: String(p.bio ?? ''),
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),
  'tiktok.getProfile': async (p) => tkGetProfile(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.status': async (p) => tkStatus(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.feed': async (p) => tkFeed(typeof p.limit === 'number' ? p.limit : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.search': async (p) => tkSearch(String(p.query || ''), typeof p.limit === 'number' ? p.limit : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.videoDetail': async (p) => tkVideoDetail(String(p.url || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.suggest': async (p) => tkSuggest(String(p.seed || p.query || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.outlier': async (p) => tkOutlier(String(p.creator || p.niche || p.query || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  // Niche radar (electron/tiktokRadar.ts): read-only collection + scoring
  'tiktok.radarNiches': async () => ({ ok: true, niches: await loadNiches(), status: radarStatus() }),
  'tiktok.radarSaveNiche': async (p) => upsertNiche(p.niche ?? p),
  'tiktok.radarRemoveNiche': async (p) => ({ ok: await removeNiche(String(p.id || '')) }),
  'tiktok.radarCollect': async (p) => radarCollectOnce(String(p.id || p.niche || '')),
  'tiktok.radarStart': async (p) => startRadar(String(p.id || p.niche || '')),
  'tiktok.radarStop': async (p) => stopRadar(String(p.id || p.niche || '')),
  'tiktok.radarStatus': async () => radarStatus(),
  'tiktok.radarReport': async (p) => {
    const r = await radarReportFor(String(p.id || p.niche || ''), typeof p.hours === 'number' ? p.hours : 24)
    if (!r.ok) return r
    const rep = r.report
    // Trimmed for the agent: the full report lives in the niche's recommendations log.
    return { ok: true, report: { ...rep, topVideos: rep.topVideos.slice(0, 10), sounds: rep.sounds.slice(0, 10), opportunities: rep.opportunities.slice(0, 5), tags: { picked: rep.tags.picked, scores: rep.tags.scores.slice(0, 15) } } }
  },
  'tiktok.eval': async (p) => tkEval(String(p.code || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.uploadVideo': async (p) => tkUploadVideo({
    videoFilePath: String(p.videoFilePath || p.videoPath || p.file || ''),
    caption: String(p.caption || ''),
    scheduleTime: p.scheduleTime ? String(p.scheduleTime) : undefined,
    allowComment: typeof p.allowComment === 'boolean' ? p.allowComment : true,
    allowDuet: typeof p.allowDuet === 'boolean' ? p.allowDuet : true,
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),
  'tiktok.submitPost': async (p) => tkSubmitPost(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.listPosts': async (p) => tkListPosts(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.deleteVideo': async (p) => tkDeleteVideo({
    videoId: p.videoId ? String(p.videoId) : undefined,
    videoUrl: p.videoUrl ? String(p.videoUrl) : undefined,
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),
  'tiktok.deleteAllVideos': async (p) => tkDeleteAllVideos({
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }),
  'tiktok.warmupScroll': async (p) => tkWarmupScroll({
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
    durationSeconds: typeof p.durationSeconds === 'number' ? p.durationSeconds : (typeof p.seconds === 'number' ? p.seconds : undefined),
    niche: typeof p.niche === 'string' ? p.niche : undefined,
    autoLike: typeof p.autoLike === 'boolean' ? p.autoLike : undefined,
  }),
  'tiktok.editVideoCaption': async (p) => tkEditVideoCaption({
    videoId: String(p.videoId || ''),
    caption: String(p.caption || ''),
    account: typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined,
  }),

  // Fast Background TikTok In-Session APIs (Zero UI / 100% Background)
  'tiktok.api.search': async (p) => tkApiSearch(
    String(p.query || ''),
    typeof p.limit === 'number' ? p.limit : 20,
    typeof p.offset === 'number' ? p.offset : 0,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined
  ),
  'tiktok.api.creatorFeed': async (p) => tkApiCreatorFeed(
    String(p.creator || p.creatorHandle || p.username || ''),
    typeof p.limit === 'number' ? p.limit : 30,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined
  ),
  'tiktok.api.outlier': async (p) => tkApiOutlier(
    String(p.creator || p.creatorHandle || p.username || ''),
    typeof p.minMultiplier === 'number' ? p.minMultiplier : 3.0,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined
  ),
  'tiktok.api.videoDetail': async (p) => tkApiVideoDetail(
    String(p.url || p.videoId || p.id || ''),
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined
  ),
  'tiktok.api.batchOutliers': async (p) => tkApiBatchOutliers(
    Array.isArray(p.creators) ? p.creators.map(String) : [],
    typeof p.minMultiplier === 'number' ? p.minMultiplier : 2.5,
    typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined
  ),
  'tiktok.apiSearch': async (p) => tkApiSearch(String(p.query || ''), typeof p.limit === 'number' ? p.limit : 20, typeof p.offset === 'number' ? p.offset : 0, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.apiCreatorFeed': async (p) => tkApiCreatorFeed(String(p.creator || p.creatorHandle || p.username || ''), typeof p.limit === 'number' ? p.limit : 30, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.apiOutlier': async (p) => tkApiOutlier(String(p.creator || p.creatorHandle || p.username || ''), typeof p.minMultiplier === 'number' ? p.minMultiplier : 3.0, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.apiVideoDetail': async (p) => tkApiVideoDetail(String(p.url || p.videoId || p.id || ''), typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
  'tiktok.apiBatchOutliers': async (p) => tkApiBatchOutliers(Array.isArray(p.creators) ? p.creators.map(String) : [], typeof p.minMultiplier === 'number' ? p.minMultiplier : 2.5, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),

  // AI Browser Workers (via user's logged-in desktop sessions)
  // ChatGPT goes through electron/chatgptChats.ts: its own chat per call, per-account queue, limit failover.
  'ask.chatgpt': async (p) => askChatgptText(String(p.prompt || '')),
  'ask.claude': async (p) => askBrowserProvider('claude', String(p.prompt || '')),
  'ask.gemini': async (p) => askBrowserProvider('gemini', String(p.prompt || '')),
  'ask.grok': async (p) => askBrowserProvider('grok', String(p.prompt || '')),
  'ask.perplexity': async (p) => askBrowserProvider('perplexity', String(p.prompt || '')),
  'ask.deepseek': async (p) => askBrowserProvider('deepseek' as any, String(p.prompt || '')),

  // ChatGPT chats: list / read / send in a new or existing chat (electron/chatgptChats.ts)
  'chatgpt.chats': async (p) => listChats({ account: acct(p), limit: typeof p.limit === 'number' ? p.limit : undefined }),
  'chatgpt.chatRead': async (p) => readChat({ chatId: String(p.chatId || ''), account: acct(p), lastN: typeof p.lastN === 'number' ? p.lastN : undefined }),
  'chatgpt.imageLibrary': async (p) => imageLibrary({ account: acct(p), limit: typeof p.limit === 'number' ? p.limit : undefined, cursor: typeof p.cursor === 'string' && p.cursor ? p.cursor : null }),
  'chatgpt.searchChats': async (p) => searchChats({ query: String(p.query || ''), account: acct(p), limit: typeof p.limit === 'number' ? p.limit : undefined }),
  'chatgpt.downloadImage': async (p) => downloadImage({ fileId: String(p.fileId || ''), conversationId: String(p.conversationId || ''), account: acct(p) }),
  'chatgpt.updateChat': async (p) => updateChat({ chatId: String(p.chatId || ''), account: acct(p), title: typeof p.title === 'string' ? p.title : undefined, archived: typeof p.archived === 'boolean' ? p.archived : undefined }),
  'chatgpt.ask': async (p) => askChat({ prompt: String(p.prompt || ''), account: acct(p), chatId: typeof p.chatId === 'string' && p.chatId ? p.chatId : null, model: typeof p.model === 'string' && p.model ? p.model : null }),
  'chatgpt.models': async (p) => chatModels({ account: acct(p) }),

  // ChatGPT images across every signed-in account (electron/chatgptImages.ts)
  'chatgpt.imageAccounts': async (p) => imageAccounts(p.refresh !== false),
  'chatgpt.openLogin': async (p) => openChatgptLogin(String(p.partition || '')),
  'chatgpt.generateImage': async (p) => runImageJobs({
    prompt: String(p.prompt || ''),
    count: typeof p.count === 'number' ? p.count : 1,
    account: typeof p.account === 'string' ? p.account : null,
  }, p.wait !== false),
  'chatgpt.editImage': async (p) => runImageJobs({
    prompt: String(p.prompt || ''),
    image: String(p.image || ''),
    count: typeof p.count === 'number' ? p.count : 1,
    account: typeof p.account === 'string' ? p.account : null,
  }, p.wait !== false),
  'chatgpt.imageJobs': async (p) => listJobs(typeof p.jobId === 'string' ? p.jobId : undefined).map(publicJob),

  // Google Flow
  'flow.accounts': async () => flowAccounts(),
  'flow.listProjects': async (p) => flowListProjects(acct(p)),
  'flow.createProject': async (p) => flowCreateProject(String(p.title || 'Untitled'), acct(p)),
  'flow.generateImage': async (p) => flowGenerateImage(
    String(p.prompt || ''),
    String(p.projectId || ''),
    typeof p.imageModel === 'string' ? p.imageModel : undefined,
    acct(p),
  ),
  // Runs one other RPC while requests matching urlPattern (and method) on the
  // view `tab` (or on every open view showing `url`, so no tab of the site can
  // leak) are recorded and blocked before they leave — see rehearsal.ts.
  // The inner call still goes through the action guard.
  'dev.rehearse': async (p) => {
    const tab = String(p.tab || '')
    const url = typeof p.url === 'string' ? p.url : ''
    const tabWc = tab ? getViewById(tab)?.webContents : null
    const wcs = tab ? (tabWc ? [tabWc] : []) : url ? allWebContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL().includes(url)) : []
    if (!wcs.length || wcs.some(w => w.isDestroyed())) return { ok: false, error: `no open view for "${tab || url}"` }
    const call = (p.call && typeof p.call === 'object' ? p.call : {}) as { method?: unknown; params?: unknown }
    const method = String(call.method || '')
    if (!method || method === 'dev.rehearse') return { ok: false, error: 'call.method must name another RPC' }
    const inner = (call.params && typeof call.params === 'object' ? call.params : {}) as Record<string, unknown>
    const r = await rehearse(wcs, { urlPattern: String(p.urlPattern || ''), method: typeof p.method === 'string' ? p.method : undefined },
      () => workflowTool(method, inner), typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined)
    return { ok: true, ...r }
  },
  // One-click tool health (health/health.ts): reads + bundle ids, and rehearsals when asked. Never posts.
  'health.check': async (p) => {
    const report = await runHealth(PLATFORMS, {
      platforms: Array.isArray(p.platforms) ? p.platforms.filter((x): x is string => typeof x === 'string') : undefined,
      rehearse: p.rehearse === true,
      accept: Array.isArray(p.accept) ? p.accept.filter((x): x is string => typeof x === 'string') : undefined,
    }, { invoke: (m, params) => workflowTool(m, params), dir: join(app.getPath('userData'), 'health') })
    // A partial run (some platforms) is not the whole picture; only full runs update hot.md.
    if (!Array.isArray(p.platforms) || !p.platforms.length) {
      const status = healthStatus(report)
      const body = [status.failing.length ? `failing: ${status.failing.join(', ')}` : '', status.warnings.length ? `warnings: ${status.warnings.join(', ')}` : ''].filter(Boolean).join('; ')
      void brainOp('status.set', { health: status }).catch(() => {})
      void brainOp('log.append', { type: 'health', title: `health check: ${report.status}`, body }).catch(() => {})
    }
    return report
  },
  'health.registry': async () => toolRegistry(Object.keys(RPC_HANDLERS)),
  // A failed tool, filed by the MCP client (reports.ts). Masked; argument values are dropped.
  'reports.create': async (p) => {
    if (typeof p.tool !== 'string' || typeof p.error !== 'string') throw new Error('tool and error are required')
    const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? p.args as Record<string, unknown> : undefined
    const r = await writeReport({ tool: p.tool, error: p.error, note: typeof p.note === 'string' ? p.note : undefined, args }, { dir: app.getPath('userData'), version: app.getVersion() })
    void brainOp('log.append', { type: 'report', title: `problem report: ${p.tool}` }).catch(() => {})
    void listReports(app.getPath('userData')).then(all => brainOp('status.set', { openReports: all.length })).catch(() => {})
    return { ok: true, id: r.id }
  },
  'reports.list': async () => ({ ok: true, reports: await listReports(app.getPath('userData')) }),
  // Dev only: a PNG of FlowDesk's own window (after optional UI script), for checking
  // the app's screens without touching the user's desktop. Never in the installed app.
  'dev.capture': async (p) => {
    if (app.isPackaged) throw new Error('dev.capture is only available in development')
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && /^(http:\/\/localhost:\d+|file:)/.test(w.webContents.getURL()) && !w.webContents.getURL().includes('hud'))
    if (!win) throw new Error('FlowDesk window not found')
    if (typeof p.script === 'string' && p.script) await win.webContents.executeJavaScript(p.script)
    await new Promise(r => setTimeout(r, typeof p.waitMs === 'number' ? Math.min(p.waitMs, 15_000) : 1500))
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    const file = join(app.getPath('temp'), `flowdesk-capture-${Date.now()}.png`)
    await writeFile(file, image.toPNG())
    return { ok: true, file, size: image.getSize() }
  },
  // Searches the JS the view `tab` has loaded for request identifiers (bundleScan.ts).
  'dev.bundleScan': async (p) => {
    const tab = String(p.tab || '')
    const wc = (tab ? getViewById(tab)?.webContents : null) ?? (typeof p.url === 'string' && p.url ? findAnyViewByUrl(p.url)?.webContents : null)
    if (!wc || wc.isDestroyed()) return { ok: false, error: `no open view for "${tab || p.url}"` }
    const needles = Array.isArray(p.needles) ? p.needles.filter((n): n is string => typeof n === 'string' && n.length >= 3).slice(0, 200) : []
    if (!needles.length) return { ok: false, error: 'needles must list at least one identifier (3+ characters)' }
    return { ok: true, ...(await scanBundles(wc, needles)) }
  },
  'flow.imageModels': async (p) => flowUiImageModels(String(p.projectId || ''), acct(p)),
  'flow.uiGenerateImage': async (p) => flowUiGenerateImage({
    prompt: String(p.prompt || ''),
    projectId: String(p.projectId || ''),
    account: acct(p),
    model: typeof p.model === 'string' ? p.model : null,
    aspectRatio: p.aspectRatio,
    count: p.count,
  }),
  'flow.generateVideo': async (p) => flowGenerateVideo(
    String(p.prompt || ''),
    String(p.projectId || ''),
    String(p.modelKey || ''),
    acct(p),
  ),
  'flow.generateVideoFromImage': async (p) => flowGenerateVideoFromImage(
    String(p.prompt || ''),
    String(p.projectId || ''),
    String(p.mediaId || ''),
    String(p.modelKey || ''),
    acct(p),
  ),
  'flow.extendVideo': async (p) => flowExtendVideo(
    String(p.prompt || ''),
    String(p.projectId || ''),
    String(p.sourceVideoId || ''),
    String(p.sceneId || ''),
    acct(p),
  ),
  'flow.uploadImage': async (p) => flowUploadImage(
    String(p.localFilePath || ''),
    String(p.projectId || ''),
    acct(p),
  ),
  'flow.downloadMedia': async (p) => flowDownloadMedia(String(p.mediaUrl || ''), acct(p)),
  'flow.videoModels': async (p) => flowVideoModels(acct(p)),
  'flow.credits': async (p) => flowGetCredits(acct(p)),
  'flow.mediaStatus': async (p) => flowMediaStatus(String(p.mediaId || ''), acct(p)),
  'flow.listProjectMedia': async (p) => flowListProjectMedia(String(p.projectId || ''), acct(p)),
  'flow.eval': async (p) => flowEval(String(p.code || ''), acct(p)),

  // FlowDesk Native Floating HUD Widget
  'hud.open': async (p) => openHudWidget({
    app: typeof p.app === 'string' ? (p.app as any) : undefined,
    title: typeof p.title === 'string' ? p.title : undefined,
    width: typeof p.width === 'number' ? p.width : undefined,
    height: typeof p.height === 'number' ? p.height : undefined,
    alwaysOnTop: typeof p.alwaysOnTop === 'boolean' ? p.alwaysOnTop : true,
  }),
  'hud.close': async () => closeHudWidget(),
  'hud.status': async () => getHudStatus(),
  'debug.windows': async () => BrowserWindow.getAllWindows().map(w => ({
    id: w.id,
    title: w.getTitle(),
    visible: w.isVisible(),
    isMinimized: w.isMinimized(),
    bounds: w.getBounds()
  })),
  'window.show': async () => {
    const win = BrowserWindow.getAllWindows().find(w => w.id === 1) || BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return { ok: true, id: win.id, visible: win.isVisible() }
    }
    return { ok: false, error: 'No window found' }
  },

  // FlowDesk Brain
  'brain.status': async () => brainHandler ? brainHandler('status', {}) : { ok: false, error: 'Brain unavailable' },
  'brain.overview': async (p) => brainHandler ? brainHandler('overview', { scopeId: p.scopeId }) : { ok: false, error: 'Brain unavailable' },
  'brain.search': async (p) => brainHandler ? brainHandler('search', { query: String(p.query || p.text || ''), text: String(p.text || p.query || ''), scopeId: p.scopeId, limit: p.limit, tokenBudget: p.tokenBudget }) : { ok: false, error: 'Brain unavailable' },
  'brain.remember': async (p) => brainHandler ? brainHandler('remember', { text: String(p.text || ''), scopeId: p.scopeId, kind: p.kind }) : { ok: false, error: 'Brain unavailable' },
  'brain.listMemories': async (p) => brainHandler ? brainHandler('listMemories', { scopeId: p.scopeId }) : { ok: false, error: 'Brain unavailable' },
  'brain.answerPack': async (p) => brainHandler ? brainHandler('knowledge.answerPack', { question: String(p.question || p.query || p.text || ''), scopeId: p.scopeId, tokenBudget: p.tokenBudget }) : { ok: false, error: 'Brain unavailable' },
  'brain.readDocument': async (p) => brainHandler ? brainHandler('knowledge.read', { path: String(p.path || ''), scopeId: p.scopeId }) : { ok: false, error: 'Brain unavailable' },
  'brain.searchDocuments': async (p) => brainHandler ? brainHandler('knowledge.search', { query: String(p.query || p.text || ''), scopeId: p.scopeId, limit: p.limit }) : { ok: false, error: 'Brain unavailable' },
  // Brain v3 (docs/brain-v3-plan.md): session start/wrap, briefing, and the agent-safe operator ops.
  'brain.start': async (p) => brainOp('session.start', {
    sessionId: sessionOf(p), client: clientOf(),
    platform: typeof p.platform === 'string' ? p.platform : undefined,
    brandId: typeof p.brandId === 'string' ? p.brandId : undefined,
    account: typeof p.account === 'string' ? p.account : undefined,
  }),
  'brain.wrap': async (p) => brainOp('session.wrap', {
    sessionId: sessionOf(p), client: clientOf(), summary: String(p.summary ?? ''),
    decisions: Array.isArray(p.decisions) ? p.decisions.map(String) : undefined,
    next: typeof p.next === 'string' ? p.next : undefined, focus: typeof p.focus === 'string' ? p.focus : undefined,
  }),
  'brain.sessionEnd': async (p) => brainOp('session.end', { sessionId: sessionOf(p), reason: 'exit' }),
  'brain.briefed': async (p) => brainOp('session.briefed', { sessionId: sessionOf(p) }),
  'brain.briefing': async (p) => brainOp('briefing', {
    platform: typeof p.platform === 'string' ? p.platform : undefined,
    brandId: typeof p.brandId === 'string' ? p.brandId : undefined,
    account: typeof p.account === 'string' ? p.account : undefined,
  }),
  'brain.op': async (p) => {
    const op = String(p.op || '')
    if (!AGENT_OPS.has(op)) throw new Error(`brain op "${op}" is not available to agents; allowed: ${[...AGENT_OPS].join(', ')}`)
    const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? { ...(p.args as Record<string, unknown>) } : {}
    if (op === 'inbox.take') args.sessionId = sessionOf(p)
    return brainOp(op, args)
  },
  // Retires a wrong memory (soft delete, kept in history).
  'brain.forget': async (p) => brainHandler ? brainHandler('forget', { id: String(p.id || p.memoryId || '') }) : { ok: false, error: 'Brain unavailable' },
  // Background jobs (operator/jobs.ts): start now, read later.
  'jobs.recipes': async () => jobsOrThrow().listRecipes(),
  'jobs.start': async (p) => jobsOrThrow().start(String(p.recipe || ''), p.params ?? {}, { sessionId: callContext.getStore()?.sessionId ?? null }),
  'jobs.status': async (p) => brainOp('job.get', { id: String(p.id || '') }),
  'jobs.list': async (p) => brainOp('job.list', { status: typeof p.status === 'string' ? p.status : undefined, limit: typeof p.limit === 'number' ? p.limit : undefined }),
  'jobs.result': async (p) => jobsOrThrow().result(String(p.id || ''), typeof p.page === 'number' ? p.page : 1, typeof p.pageSize === 'number' ? p.pageSize : 20),
  'jobs.cancel': async (p) => jobsOrThrow().cancel(String(p.id || '')),
  'jobs.monitor': async (p) => {
    const action = String(p.action || 'list')
    if (action === 'list') return brainOp('monitor.list')
    if (action === 'create') {
      const recipe = String(p.recipe || '')
      if (!jobsOrThrow().listRecipes().some(r => r.id === recipe)) throw new Error(`unknown job recipe "${recipe}"`)
      return brainOp('monitor.create', { recipe, params: p.params ?? {}, everyMinutes: Number(p.everyMinutes) })
    }
    if (['pause', 'resume', 'delete'].includes(action)) return brainOp('monitor.status', { id: String(p.id || ''), status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'deleted' })
    throw new Error(`unknown monitor action "${action}" (list, create, pause, resume, delete)`)
  },
  'brain.neighbors': async (p) => brainHandler ? brainHandler('knowledge.neighbors', { path: String(p.path || ''), scopeId: p.scopeId, depth: p.depth }) : { ok: false, error: 'Brain unavailable' },
  'brain.listCandidates': async (p) => brainHandler ? brainHandler('listCandidates', { scopeId: p.scopeId }) : { ok: false, error: 'Brain unavailable' },
  'brain.decideCandidate': async (p) => brainHandler ? brainHandler('decideCandidate', p) : { ok: false, error: 'Brain unavailable' },

  // Skills & Workflow Engine
  'skills.list': async (p) => {
    await ensureSkillsLoaded()
    return listSkills({
      domain: typeof p.domain === 'string' ? p.domain : undefined,
      search: typeof p.search === 'string' ? p.search : (typeof p.query === 'string' ? p.query : undefined),
    })
  },
  'skills.get': async (p) => {
    await ensureSkillsLoaded()
    return getSkill(String(p.id || '')) || null
  },
  'skills.save': async (p) => {
    await ensureSkillsLoaded()
    if (!p.skill || typeof p.skill !== 'object') {
      throw new Error('Missing skill object parameter')
    }
    await saveSkill(p.skill as any)
    return { ok: true, id: (p.skill as any).id }
  },
  'skills.delete': async (p) => {
    await ensureSkillsLoaded()
    return { ok: await deleteSkill(String(p.id || '')) }
  },
  'workflows.list': async (p) => {
    await ensureSkillsLoaded()
    return listWorkflows({
      domain: typeof p.domain === 'string' ? p.domain : undefined,
    })
  },
  'workflows.get': async (p) => {
    await ensureSkillsLoaded()
    return getWorkflow(String(p.id || '')) || null
  },
  'workflows.save': async (p) => {
    await ensureSkillsLoaded()
    if (!p.workflow || typeof p.workflow !== 'object') {
      throw new Error('Missing workflow object parameter')
    }
    await saveWorkflow(p.workflow as any)
    return { ok: true, id: (p.workflow as any).id }
  },
  'workflows.run': async (p) => {
    await ensureSkillsLoaded()
    const id = String(p.id || p.workflowId || '')
    const inputs = (p.inputs && typeof p.inputs === 'object') ? (p.inputs as Record<string, any>) : {}
    return executeWorkflow(id, inputs)
  },
  'workflows.resume': async (p) => {
    await ensureSkillsLoaded()
    return resumeWorkflow(String(p.runId || p.id || ''))
  },
  // Discovery aid: which cookies a partition holds and whether each survives a
  // restart (session cookies do not). Names and expiry only — never values.
  'debug.cookies': async (p) => {
    const { app, session } = await import('electron')
    if (app.isPackaged) throw new Error('debug.cookies is development-only')
    const partition = String(p.partition || '')
    if (!/^social-[\w-]+$/.test(partition)) throw new Error('partition must be a social-* partition')
    const cookies = await session.fromPartition(`persist:${partition}`).cookies.get({})
    return cookies.map(c => ({ name: c.name, domain: c.domain, session: c.session, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : null, httpOnly: c.httpOnly }))
  },
  'tools.list': async () => {
    const registry = await loadAgentToolRegistry()
    return [...registry.values()].map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(z.object(t.inputSchema)),
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }))
  },
  'tools.call': async (p) => {
    const name = typeof p.name === 'string' ? p.name : ''
    const registry = await loadAgentToolRegistry()
    const def = registry.get(name)
    if (!def) throw new Error(`Unknown tool: ${name}`)
    const rawArgs = (p.args && typeof p.args === 'object') ? p.args : {}
    const args = z.object(def.inputSchema).parse(rawArgs) as Record<string, unknown>
    const out = await def.handler(args, {})
    // isError travels too: a denied or failed tool must not read as success.
    return { content: out?.content ?? [], isError: Boolean(out?.isError) }
  },
  'workflows.runs': async (p) => {
    const workflowId = typeof p.workflowId === 'string' ? p.workflowId : (typeof p.id === 'string' ? p.id : undefined)
    return listWorkflowRuns(workflowId)
  },
}

let skillsInitPromise: Promise<void> | null = null
export async function ensureSkillsLoaded(userDataPath?: string): Promise<void> {
  if (!skillsInitPromise) {
    const userSkillsDir = userDataPath ? join(userDataPath, 'skills') : undefined
    skillsInitPromise = initSkillsRegistry({ userSkillsDir }).catch((err) => {
      console.warn('[FlowDesk Gateway] Failed to initialize skills registry:', err)
      skillsInitPromise = null
    })
  }
  await skillsInitPromise
}

let brainHandler: ((method: string, payload: unknown) => Promise<unknown>) | null = null

export function setGatewayBrainHandler(handler: (method: string, payload: unknown) => Promise<unknown>): void {
  brainHandler = handler
}

/** One Brain v3 operator op (brain/operator/ops.ts). */
function brainOp(op: string, args: Record<string, unknown> = {}): Promise<any> {
  if (!brainHandler) return Promise.reject(new Error('Brain unavailable'))
  return brainHandler('operator', { op, args })
}

/**
 * Ops a connected agent may call through brain.op. Left out on purpose:
 * deciding learnings and proposed facts and editing AGENTS.md (the user does
 * those in FlowDesk), and FlowDesk's own bookkeeping (ledger, status, sync).
 */
const AGENT_OPS = new Set([
  'activity', 'briefing', 'files.get', 'overview', 'sessions.list', 'log.list',
  'profile.get', 'profile.set', 'brand.upsert', 'brand.list', 'brand.get', 'account.update', 'account.list', 'history', 'facts.proposed',
  'content.create', 'content.get', 'content.update', 'content.list', 'content.link',
  'metric.record', 'metric.latest', 'learning.propose', 'learning.list',
  'task.upsert', 'task.list', 'contact.upsert', 'contact.list', 'idea.add', 'idea.list', 'idea.status',
  'inbox.list', 'inbox.take', 'inbox.done', 'job.get', 'job.list', 'monitor.list',
])

const sessionOf = (p: Record<string, unknown>) => {
  const ctx = callContext.getStore()
  return ctx?.sessionId ?? (typeof p.sessionId === 'string' && p.sessionId ? p.sessionId : 'cli')
}
const clientOf = () => callContext.getStore()?.client ?? 'cli'

let backgroundJobs: BackgroundJobs | null = null
/** The app UI starts and reads background jobs through the same runner as MCP. */
export function backgroundJobsApi(): BackgroundJobs | null { return backgroundJobs }
const jobsOrThrow = () => {
  if (!backgroundJobs) throw new Error('background jobs are starting')
  return backgroundJobs
}

/** Keeps Brain's account list, skills list, health and report counts current. */
async function syncOperator(): Promise<void> {
  if (!brainHandler) return
  const accounts = await socialAccountsStatus()
  await brainOp('accounts.sync', { accounts: (accounts.accounts as Array<{ platform: string; id: string; label: string }>).map(a => ({ platform: a.platform, slotId: a.id, label: a.label.replace(/[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***') })) })
  // First run only (it remembers): profile and brands proposed from the vault.
  await brainOp('seed.fromKnowledge').catch(() => {})
  await ensureSkillsLoaded()
  await brainOp('status.set', {
    skills: listSkills().map(s => ({ id: String(s.id), name: String(s.name ?? s.id), description: typeof s.description === 'string' ? s.description.slice(0, 200) : undefined })),
    openReports: (await listReports(app.getPath('userData'))).length,
  })
}

function healthStatus(report: { ranAt: string; status: string; platforms: Array<{ platform: string; status: string }> }) {
  return {
    ranAt: report.ranAt,
    status: report.status,
    failing: report.platforms.filter(p => p.status === 'fail').map(p => p.platform),
    warnings: report.platforms.filter(p => p.status === 'warn').map(p => p.platform),
  }
}

/** Every write-like action reachable through the gateway, canonical and de-duplicated. */
export async function knownWriteActions(): Promise<string[]> {
  const registry = await loadAgentToolRegistry()
  const names = [...Object.keys(RPC_HANDLERS), ...registry.keys()].map(canonicalAction).filter(isWriteAction)
  return [...new Set(names)].sort()
}

export interface GatewayOptions {
  /** Asks the user to allow an action listed under requireApproval. */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>
}

// Local tools only send small JSON (paths, prompts, ids); images travel as file paths.
const MAX_RPC_BODY_BYTES = 1024 * 1024

export function tokenMatches(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string') return false
  const got = Buffer.from(header)
  const want = Buffer.from(`Bearer ${token}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export function startLocalGateway(userDataPath?: string, preferredPort = 47888, options: GatewayOptions = {}): Promise<GatewayServer> {
  const policyDir = userDataPath || join(process.env.FLOWDESK_HOME || homedir(), '.flowdesk')
  guard = withLedger(createActionGuard({ ...policyPaths(policyDir), requestApproval: options.requestApproval }), row => {
    void brainOp('ledger.record', row as unknown as Record<string, unknown>).catch(() => {})
  })
  if (userDataPath && !backgroundJobs) {
    const jobs = new BackgroundJobs({ brain: brainOp, invoke: (m, params) => workflowTool(m, params), resultsDir: join(userDataPath, 'brain', 'job-results') })
    backgroundJobs = jobs
    // Brain starts in its own process; keep trying until it answers, then once a minute
    // start due monitors and every 10 minutes refresh accounts, skills and report counts.
    let ready = false
    let minutes = 0
    const tick = () => {
      if (!brainHandler) return
      void (async () => {
        if (!ready) { await jobs.recover(); await syncOperator(); ready = true }
        await jobs.tick()
        if (++minutes % 10 === 0) await syncOperator()
      })().catch(() => {})
    }
    setTimeout(tick, 15_000).unref?.()
    setInterval(tick, 60_000).unref?.()
  }
  return new Promise((resolve, reject) => {
    const token = randomBytes(24).toString('hex')
    void ensureSkillsLoaded(userDataPath)

    const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS restricted to local loopback tools
      const origin = req.headers.origin
      const isAllowedOrigin = typeof origin === 'string' && (
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        origin.startsWith('vscode-webview://')
      )

      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(isAllowedOrigin ? 204 : 403)
        res.end()
        return
      }

      // Health endpoint (unauthenticated for discovery)
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, app: 'flowdesk' }))
        return
      }

      // Auth validation for all other endpoints
      const authHeader = req.headers.authorization
      if (!tokenMatches(authHeader, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized: invalid or missing gateway token' }))
        return
      }

      // Overall status check
      if (req.url === '/status' && req.method === 'GET') {
        const [reddit, whatsapp, linkedin, tiktok] = await Promise.allSettled([
          rdStatus(),
          waStatus(),
          liStatus(),
          tkStatus(),
        ])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          providers: {
            reddit: reddit.status === 'fulfilled' ? reddit.value : { ok: false, error: String(reddit.reason) },
            whatsapp: whatsapp.status === 'fulfilled' ? whatsapp.value : { ok: false, error: String(whatsapp.reason) },
            linkedin: linkedin.status === 'fulfilled' ? linkedin.value : { ok: false, error: String(linkedin.reason) },
            tiktok: tiktok.status === 'fulfilled' ? tiktok.value : { ok: false, error: String(tiktok.reason) },
          }
        }))
        return
      }

      // SSE events endpoint (for real-time streaming progress, image_progress, etc.)
      if (req.url === '/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        res.write('retry: 1000\n\n')

        const onProgress = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }
        workerProgress.on('progress', onProgress)

        req.on('close', () => {
          workerProgress.off('progress', onProgress)
        })
        return
      }

      // RPC endpoint
      if (req.url === '/rpc' && req.method === 'POST') {
        let body = ''
        let tooLarge = false
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
          if (tooLarge) return
          body += chunk
          if (Buffer.byteLength(body) > MAX_RPC_BODY_BYTES) {
            tooLarge = true
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Request body too large' }))
            req.destroy()
          }
        })
        req.on('end', async () => {
          if (tooLarge) return
          try {
            const parsed = JSON.parse(body || '{}')
            const method = String(parsed.method || '')
            const params = (parsed.params && typeof parsed.params === 'object') ? parsed.params : {}

            const handler = RPC_HANDLERS[method]
            if (!handler) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: `Method not found: ${method}` }))
              return
            }

            const result = await callContext.run(contextFromHeaders(req.headers, method), () => guard(method, params as Record<string, unknown>, () => handler(params)))
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, result }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
          }
        })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Fallback to random available port if preferred port is occupied
        server.listen(0, '127.0.0.1')
      } else {
        reject(err)
      }
    })

    server.listen(preferredPort, '127.0.0.1', async () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : preferredPort
      const info: GatewayInfo = {
        port,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }

      await writeGatewayFiles(info, userDataPath)

      resolve({
        info,
        stop: async () => {
          await removeGatewayFiles(info.token, userDataPath)
          await new Promise<void>((res) => server.close(() => res()))
        },
      })
    })
  })
}
