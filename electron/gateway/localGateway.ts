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
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { BrowserWindow } from 'electron'
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
import { askChat, askChatgptText, downloadImage, imageLibrary, listChats, readChat, searchChats, updateChat } from '../chatgptChats'
import { enqueueImages, imageAccounts, listJobs, openChatgptLogin, publicJob, waitForJob, type ImageRequest } from '../chatgptImages'
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
  const count = (s: string) => out.filter(j => j.status === s).length
  return {
    ok: out.some(j => j.status === 'done') || (!wait && out.length > 0),
    progress: { total: out.length, done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') },
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
// The in-app agent's tools (claude-agent-sdk `tool()` items) are exposed
// generically so the external MCP server can mirror them without hand-written
// wrappers. The external caller is the approver here, so actions auto-approve.
interface AgentToolDef {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content?: unknown[] } & Record<string, unknown>>
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

const RPC_HANDLERS: Record<string, RpcHandler> = {
  // Reddit methods
  'reddit.status': async () => rdStatus(),
  'reddit.feed': async (p) => rdFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: p.sort as any,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
    after: typeof p.after === 'string' ? p.after : undefined,
    timeFilter: p.timeFilter as any,
  }),
  'reddit.postComments': async (p) => rdPostComments(
    String(p.subreddit || ''),
    String(p.postId || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),
  'reddit.search': async (p) => rdSearch(
    String(p.query || ''),
    p.sort as any,
    typeof p.limit === 'number' ? p.limit : undefined,
    typeof p.t === 'string' ? p.t as any : undefined,
  ),
  'reddit.votePost': async (p) => rdVotePost(String(p.postId || ''), p.voteState as any),
  'reddit.voteComment': async (p) => rdVoteComment(String(p.commentId || ''), p.voteState as any),
  'reddit.createComment': async (p) => rdCreateComment(String(p.postId || ''), String(p.parentId || ''), String(p.text || '')),
  'reddit.createPost': async (p) => rdCreatePost(String(p.subreddit || ''), String(p.title || ''), typeof p.body === 'string' ? p.body : undefined),
  'reddit.subscribe': async (p) => rdSubscribe(String(p.subredditId || ''), p.subscribeState as any),
  'reddit.markRead': async () => rdMarkRead(),
  'reddit.api_feed': async (p) => rdApiFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: typeof p.sort === 'string' ? p.sort : undefined,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }),
  'reddit.apiFeed': async (p) => rdApiFeed({
    subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
    sort: typeof p.sort === 'string' ? p.sort : undefined,
    limit: typeof p.limit === 'number' ? p.limit : undefined,
  }),
  'reddit.api_search': async (p) => rdApiSearch(
    String(p.query || ''),
    {
      subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      sort: typeof p.sort === 'string' ? p.sort as any : undefined,
      t: typeof p.t === 'string' ? p.t as any : undefined,
    },
  ),
  'reddit.apiSearch': async (p) => rdApiSearch(
    String(p.query || ''),
    {
      subreddit: typeof p.subreddit === 'string' ? p.subreddit : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      sort: typeof p.sort === 'string' ? p.sort as any : undefined,
      t: typeof p.t === 'string' ? p.t as any : undefined,
    },
  ),
  'reddit.api_post_comments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),
  'reddit.apiPostComments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),
  'reddit.api_comments': async (p) => rdApiPostComments(
    String(p.postId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),
  'reddit.outlier': async (p) => rdApiOutlier(
    String(p.subreddit || p.sub || ''),
    typeof p.minMultiplier === 'number' ? p.minMultiplier : (typeof p.multiplier === 'number' ? p.multiplier : 3.0),
    { sort: typeof p.sort === 'string' ? p.sort as any : undefined, t: typeof p.t === 'string' ? p.t as any : undefined },
  ),

  // WhatsApp methods
  'whatsapp.status': async () => waStatus(),
  'whatsapp.listChats': async (p) => waListChats(typeof p.limit === 'number' ? p.limit : undefined, Boolean(p.onlyUnread)),
  'whatsapp.listMessages': async (p) => waListMessages(String(p.chatId || ''), typeof p.limit === 'number' ? p.limit : undefined),
  'whatsapp.send': async (p) => waSend(String(p.chatId || ''), String(p.text || '')),
  'whatsapp.unread': async (p) => waUnreadWithMessages(typeof p.limit === 'number' ? p.limit : 10),
  'whatsapp.api_chats': async (p) => waApiListChats(
    typeof p.limit === 'number' ? p.limit : undefined,
    Boolean(p.onlyUnread || p.unread),
  ),
  'whatsapp.apiChats': async (p) => waApiListChats(
    typeof p.limit === 'number' ? p.limit : undefined,
    Boolean(p.onlyUnread || p.unread),
  ),
  'whatsapp.api_messages': async (p) => waApiListMessages(
    String(p.chatId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),
  'whatsapp.apiMessages': async (p) => waApiListMessages(
    String(p.chatId || p.id || ''),
    typeof p.limit === 'number' ? p.limit : undefined,
  ),

  // LinkedIn methods
  'linkedin.accounts': async () => liAccounts(),
  'linkedin.switchAccount': async (p) => liSwitchAccount(typeof p.account === 'string' || typeof p.account === 'number' ? p.account : '1'),
  'linkedin.status': async (p) => liStatus(typeof p?.account === 'string' || typeof p?.account === 'number' ? p.account : undefined),
  'linkedin.feed': async (p) => liFeed(typeof p.limit === 'number' ? p.limit : undefined, typeof p.start === 'number' ? p.start : 0, typeof p.sort === 'string' ? p.sort : undefined, typeof p.account === 'string' || typeof p.account === 'number' ? p.account : undefined),
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
  'chatgpt.ask': async (p) => askChat({ prompt: String(p.prompt || ''), account: acct(p), chatId: typeof p.chatId === 'string' && p.chatId ? p.chatId : null }),

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
    p.imageModel as any,
    acct(p),
  ),
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
  ),
  'flow.extendVideo': async (p) => flowExtendVideo(
    String(p.prompt || ''),
    String(p.projectId || ''),
    String(p.sourceVideoId || ''),
    String(p.sceneId || ''),
  ),
  'flow.uploadImage': async (p) => flowUploadImage(
    String(p.localFilePath || ''),
    String(p.projectId || ''),
  ),
  'flow.downloadMedia': async (p) => flowDownloadMedia(String(p.mediaUrl || '')),
  'flow.videoModels': async () => flowVideoModels(),
  'flow.credits': async (p) => flowGetCredits(acct(p)),
  'flow.mediaStatus': async (p) => flowMediaStatus(String(p.mediaId || ''), acct(p)),
  'flow.listProjectMedia': async (p) => flowListProjectMedia(String(p.projectId || '')),
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

export function startLocalGateway(userDataPath?: string, preferredPort = 47888, options: GatewayOptions = {}): Promise<GatewayServer> {
  const policyDir = userDataPath || join(process.env.FLOWDESK_HOME || homedir(), '.flowdesk')
  guard = createActionGuard({ ...policyPaths(policyDir), requestApproval: options.requestApproval })
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
        res.end(JSON.stringify({ ok: true, app: 'flowdesk', pid: process.pid }))
        return
      }

      // Auth validation for all other endpoints
      const authHeader = req.headers.authorization
      if (!authHeader || authHeader !== `Bearer ${token}`) {
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
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
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

            const result = await guard(method, params as Record<string, unknown>, () => handler(params))
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
