#!/usr/bin/env node
/**
 * FlowDesk Model Context Protocol (MCP) Server.
 *
 * Runs over stdio, connecting external AI agents (Claude Code, Antigravity,
 * Cursor, Claude Desktop) to FlowDesk's live authenticated browser sessions
 * (Reddit, WhatsApp, LinkedIn) via FlowDesk's Local Gateway.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const tiktokAppPath = join(projectRoot, 'src', 'mcp-apps', 'tiktok-dashboard.html')
const flowAppPath = join(projectRoot, 'src', 'mcp-apps', 'flow-studio.html')
const whatsappAppPath = join(projectRoot, 'src', 'mcp-apps', 'whatsapp-inbox.html')
const socialAppPath = join(projectRoot, 'src', 'mcp-apps', 'social-radar.html')
const workflowAppPath = join(projectRoot, 'src', 'mcp-apps', 'workflow-pipeline.html')
const brainAppPath = join(projectRoot, 'src', 'mcp-apps', 'brain-atlas.html')

function getTiktokAppHtml() {
  return existsSync(tiktokAppPath)
    ? readFileSync(tiktokAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk TikTok Studio</h1></body></html>'
}

function getFlowAppHtml() {
  return existsSync(flowAppPath)
    ? readFileSync(flowAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk Google Flow Studio</h1></body></html>'
}

function getWhatsappAppHtml() {
  return existsSync(whatsappAppPath)
    ? readFileSync(whatsappAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk WhatsApp Hub</h1></body></html>'
}

function getSocialAppHtml() {
  return existsSync(socialAppPath)
    ? readFileSync(socialAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk Social Radar</h1></body></html>'
}

function getWorkflowAppHtml() {
  return existsSync(workflowAppPath)
    ? readFileSync(workflowAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk Workflow Pipeline</h1></body></html>'
}

function getBrainAppHtml() {
  return existsSync(brainAppPath)
    ? readFileSync(brainAppPath, 'utf8')
    : '<!DOCTYPE html><html><body><h1>FlowDesk Brain Knowledge Atlas</h1></body></html>'
}

function findGatewayConfig() {
  const candidatePaths = [
    process.env.FLOWDESK_GATEWAY_CONFIG,
    join(homedir(), '.flowdesk', 'gateway.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'FlowDesk', 'gateway.json') : null,
    process.env.HOME ? join(process.env.HOME, '.config', 'FlowDesk', 'gateway.json') : null,
  ].filter(Boolean)

  const existing = []
  for (const path of candidatePaths) {
    if (existsSync(path)) {
      try {
        const stat = statSync(path)
        existing.push({ path, mtime: stat.mtimeMs })
      } catch {}
    }
  }
  existing.sort((a, b) => b.mtime - a.mtime)

  for (const item of existing) {
    try {
      const content = readFileSync(item.path, 'utf8')
      return JSON.parse(content)
    } catch {}
  }
  return null
}

// A flat 10s abort used to cover every method, so anything that waits on a
// page (first background-view load alone can take 15s) or on generation
// (ask.*, Flow video, TikTok upload) failed on the client while the app kept
// working. The gateway itself has no shorter limit, so match the real work.
const LONG_RPC = /^(ask\.|workflows\.(run|resume)$|chatgpt\.(generateImage|editImage|imageAccounts)$|flow\.(generate|extend|upload|download)|tiktok\.(uploadVideo|apiUploadVideo|deleteAllVideos|submitPost|warmupScroll|radarCollect|radarReport|radarStart)$)/
function rpcTimeoutMs(method) {
  return LONG_RPC.test(method) ? 15 * 60_000 : 120_000
}

async function callGatewayRpc(method, params = {}) {
  const cfg = findGatewayConfig()
  if (!cfg || !cfg.port || !cfg.token) {
    throw new Error(
      'FlowDesk is not running or Local Gateway is unavailable. Please start FlowDesk desktop app to use social tools.'
    )
  }

  const url = `http://127.0.0.1:${cfg.port}/rpc`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(rpcTimeoutMs(method)),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FlowDesk Gateway Error (${res.status}): ${text}`)
  }

  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || 'Unknown gateway RPC failure')
  }
  return json.result
}

function textResult(value) {
  const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text: formatted }] }
}

// The markdown tables are a human summary only. The agent needs the ids
// (chatId, postUrn, fullname) to act on a result, and the tables dropped them,
// so the full payload always travels alongside.
function summaryWithData(md, data) {
  return { content: [{ type: 'text', text: md }, { type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function formatTikTokVisual(data) {
  if (!data) return textResult('No TikTok data returned.')
  let items = []
  if (Array.isArray(data)) items = data
  else if (Array.isArray(data.outliers) && data.outliers.length > 0) items = data.outliers
  else if (Array.isArray(data.allRanked) && data.allRanked.length > 0) items = data.allRanked
  else if (Array.isArray(data.items)) items = data.items
  else if (Array.isArray(data.videos)) items = data.videos

  if (items.length === 0) {
    return textResult(data)
  }

  const topItems = items.slice(0, 5)

  let md = `<details open>\n`
  md += `<summary>🎬 <b>FlowDesk TikTok Outlier Radar</b> &nbsp; <code>${items.length} Outliers Found</code> &nbsp; <small><i>(Click to collapse/expand carousel)</i></small></summary>\n\n`

  // Table header with creator handles
  md += `| ` + topItems.map(v => {
    const author = v.author || v.creator || 'creator'
    return `🎬 **@${author}**`
  }).join(' | ') + ` |\n`

  // Alignment
  md += `| ` + topItems.map(() => `:---:`).join(' | ') + ` |\n`

  // Poster Image Row (Locked Portrait Aspect Ratio 120x170px)
  md += `| ` + topItems.map((v, idx) => {
    const author = v.author || v.creator || 'creator'
    const link = v.url || (v.id || v.videoId ? `https://www.tiktok.com/@${author}/video/${v.id || v.videoId}` : '#')
    const imgUrl = v.coverImg || v.cover || v.thumbnail
    const imgTag = imgUrl && !imgUrl.startsWith('data:')
      ? `<img src="${imgUrl}" referrerpolicy="no-referrer" width="120" height="170" style="border-radius:8px;object-fit:cover;display:block;margin:auto;" alt="Poster" />`
      : `<div style="width:120px;height:170px;border-radius:8px;background:#1e1e2e;display:flex;align-items:center;justify-content:center;font-size:32px;margin:auto;">🎬</div>`
    return `<a href="${link}" target="_blank">${imgTag}</a>`
  }).join(' | ') + ` |\n`

  // Metadata Card Row (Badges, views, action button)
  md += `| ` + topItems.map(v => {
    const author = v.author || v.creator || 'creator'
    const views = typeof v.views === 'number' ? v.views.toLocaleString() : (v.views || (v.rawViews ? v.rawViews.toLocaleString() : '1M+'))
    const likes = typeof v.likes === 'number' ? v.likes.toLocaleString() : (v.likes || 'N/A')
    const vvrVal = v.outlierMultiplier || v.vvr || v.outlier
    const vvr = vvrVal ? `🔥 **${vvrVal}x Outlier**` : `⭐ **Top Liked**`
    const link = v.url || (v.id || v.videoId ? `https://www.tiktok.com/@${author}/video/${v.id || v.videoId}` : '#')
    return `${vvr}<br>👁️ ${views} • ❤️ ${likes}<br>[▶ Watch Clip](${link})`
  }).join(' | ') + ` |\n\n`

  md += `</details>\n\n`

  return summaryWithData(md, data)
}

function formatFlowVisual(data) {
  if (!data) return textResult('No Google Flow generation data returned.')
  let md = `### 🎨 Google Flow Generation Studio\n\n`
  if (data.mediaId) md += `- **Media ID:** \`${data.mediaId}\`\n`
  if (data.status) md += `- **Status:** \`${data.status}\`\n`
  if (data.creditsRemaining !== undefined) md += `- **Credits Remaining:** ⚡ **${data.creditsRemaining}**\n`
  if (data.modelKey) md += `- **Model:** \`${data.modelKey}\`\n`
  if (data.prompt) md += `- **Prompt:** *"${data.prompt}"*\n`
  if (data.videoUrl || data.url || data.downloadUrl) {
    const mediaUrl = data.videoUrl || data.url || data.downloadUrl
    md += `\n🔗 **Media Preview Link:** [Click to Open Video / Media](${mediaUrl})\n`
  }
  md += `\n> 💡 *Interactive Player widget available via MCP App at \`ui://flowdesk/flow-studio.html\`.*`
  return { content: [{ type: 'text', text: md }] }
}

function formatWhatsAppVisual(data) {
  if (!data) return textResult('No WhatsApp data.')
  let chats = []
  if (Array.isArray(data)) chats = data
  else if (Array.isArray(data.chats)) chats = data.chats
  else if (Array.isArray(data.unread)) chats = data.unread

  if (chats.length === 0) return textResult(data)

  let md = `### 💬 WhatsApp Inbox (${chats.length} active conversations)\n\n`
  md += `| Chat Contact | Unread | Last Message | Time |\n`
  md += `|--------------|--------|--------------|------|\n`

  chats.slice(0, 15).forEach(c => {
    const name = c.name || c.formattedTitle || c.id || 'Contact'
    const unreadN = c.unread ?? c.unreadCount
    const unread = unreadN ? `🟢 **${unreadN}**` : '—'
    const lastMsg = Array.isArray(c.messages) && c.messages.length ? c.messages[c.messages.length - 1] : c.last
    const snippet = (lastMsg?.body || lastMsg?.caption || (lastMsg?.type ? `[${lastMsg.type}]` : '') || '—').replace(/[\r\n|]+/g, ' ').slice(0, 50)
    const ts = c.t ?? lastMsg?.t
    const time = ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—'
    md += `| **${name}** | ${unread} | ${snippet} | ${time} |\n`
  })

  md += `\n> 💡 *Interactive WhatsApp Inbox available via MCP App at \`ui://flowdesk/whatsapp-inbox.html\`.*`
  return summaryWithData(md, data)
}

function formatRedditVisual(data) {
  if (!data) return textResult('No Reddit data.')
  let posts = []
  if (Array.isArray(data)) posts = data
  else if (Array.isArray(data.posts)) posts = data.posts
  else if (Array.isArray(data.items)) posts = data.items

  if (posts.length === 0) return textResult(data)

  let md = `### 🔴 Reddit Posts (${posts.length} results)\n\n`
  md += `| # | Subreddit | Title | Author | Upvotes | Comments |\n`
  md += `|---|-----------|-------|--------|---------|----------|\n`

  posts.slice(0, 15).forEach((p, i) => {
    const title = (p.title || 'Untitled').replace(/[\r\n]+/g, ' ').slice(0, 50)
    const url = p.permalink ? `https://reddit.com${p.permalink}` : (p.url || '#')
    const sub = p.subreddit ? (String(p.subreddit).startsWith('r/') ? p.subreddit : `r/${p.subreddit}`) : 'r/all'
    const score = p.score || p.ups || 0
    const comments = p.numComments || p.num_comments || 0
    md += `| ${i + 1} | \`${sub}\` | [${title}](${url}) | u/${p.author || 'user'} | ⬆️ ${score} | 💬 ${comments} |\n`
  })

  md += `\n> 💡 *Interactive Social Radar available via MCP App at \`ui://flowdesk/social-radar.html\`.*`
  return summaryWithData(md, data)
}

function formatLinkedInVisual(data) {
  if (!data) return textResult('No LinkedIn data.')
  let items = []
  if (Array.isArray(data)) items = data
  else if (Array.isArray(data.updates)) items = data.updates
  else if (Array.isArray(data.posts)) items = data.posts

  if (items.length === 0) return textResult(data)

  let md = `### 👔 LinkedIn Feed Updates (${items.length} items)\n\n`
  items.slice(0, 10).forEach((u, i) => {
    const author = u.actor?.name || u.authorName || u.author || 'Connection'
    const text = (u.commentary || u.text || u.title || '').replace(/[\r\n]+/g, ' ').slice(0, 90)
    md += `${i + 1}. **${author}**: ${text}...\n`
  })

  md += `\n> 💡 *Interactive Social Radar available via MCP App at \`ui://flowdesk/social-radar.html\`.*`
  return summaryWithData(md, data)
}

function formatWorkflowVisual(data) {
  if (!data) return textResult('No workflow execution data.')
  let md = `### ⚡ Workflow Execution: \`${data.id || data.workflowId || 'Pipeline'}\`\n\n`
  md += `- **Status:** **${data.status || 'Running'}**\n`
  if (data.startedAt) md += `- **Started:** \`${data.startedAt}\`\n`
  if (Array.isArray(data.steps)) {
    md += `\n#### Pipeline Steps:\n`
    data.steps.forEach((s, idx) => {
      const icon = s.status === 'completed' ? '✅' : (s.status === 'running' ? '⏳' : '⚪')
      md += `${idx + 1}. ${icon} **${s.name || s.id}** — *${s.status || 'pending'}* (${s.duration || '—'})\n`
    })
  }
  md += `\n> 💡 *Interactive Workflow Stepper available via MCP App at \`ui://flowdesk/workflow-pipeline.html\`.*`
  return summaryWithData(md, data)
}

function formatBrainVisual(data) {
  if (!data) return textResult('No Brain data.')
  let md = `### 🧠 FlowDesk Brain Knowledge Graph\n\n`
  if (data.activeScope) md += `- **Active Scope:** \`${data.activeScope.name || data.activeScope.id}\`\n`
  if (data.totalMemories !== undefined) md += `- **Total Memories:** **${data.totalMemories}**\n`
  if (Array.isArray(data.memories) && data.memories.length > 0) {
    md += `\n#### Recent Memories:\n`
    data.memories.slice(0, 10).forEach((m, idx) => {
      md += `${idx + 1}. [**${m.kind || 'fact'}**] ${m.text}\n`
    })
  }
  md += `\n> 💡 *Interactive Brain Knowledge Atlas available via MCP App at \`ui://flowdesk/brain-atlas.html\`.*`
  return summaryWithData(md, data)
}

const server = new McpServer({
  name: 'flowdesk-mcp',
  version: '1.0.0',
})

// ── MCP APP UI RESOURCES ─────────────────────────────────────────────────────

server.resource(
  'tiktok_dashboard_ui',
  'ui://flowdesk/tiktok-dashboard.html',
  { mimeType: 'text/html', description: 'Interactive TikTok Viral Studio and Analytics MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/tiktok-dashboard.html',
      mimeType: 'text/html',
      text: getTiktokAppHtml(),
    }],
  })
)

server.resource(
  'flow_studio_ui',
  'ui://flowdesk/flow-studio.html',
  { mimeType: 'text/html', description: 'Interactive Google Flow Video Player and Studio MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/flow-studio.html',
      mimeType: 'text/html',
      text: getFlowAppHtml(),
    }],
  })
)

server.resource(
  'whatsapp_inbox_ui',
  'ui://flowdesk/whatsapp-inbox.html',
  { mimeType: 'text/html', description: 'Interactive WhatsApp Web Inbox and Message Hub MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/whatsapp-inbox.html',
      mimeType: 'text/html',
      text: getWhatsappAppHtml(),
    }],
  })
)

server.resource(
  'social_radar_ui',
  'ui://flowdesk/social-radar.html',
  { mimeType: 'text/html', description: 'Interactive Reddit and LinkedIn Growth Radar MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/social-radar.html',
      mimeType: 'text/html',
      text: getSocialAppHtml(),
    }],
  })
)

server.resource(
  'workflow_pipeline_ui',
  'ui://flowdesk/workflow-pipeline.html',
  { mimeType: 'text/html', description: 'Interactive Autonomous Workflow Pipeline Stepper MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/workflow-pipeline.html',
      mimeType: 'text/html',
      text: getWorkflowAppHtml(),
    }],
  })
)

server.resource(
  'brain_atlas_ui',
  'ui://flowdesk/brain-atlas.html',
  { mimeType: 'text/html', description: 'Interactive Brain Knowledge Graph Mind Map MCP App Widget' },
  async () => ({
    contents: [{
      uri: 'ui://flowdesk/brain-atlas.html',
      mimeType: 'text/html',
      text: getBrainAppHtml(),
    }],
  })
)

// ── REDDIT TOOLS ─────────────────────────────────────────────────────────────

server.tool(
  'reddit_status',
  'Check whether Reddit is currently open and authenticated in FlowDesk, returning the user\'s username, total karma, and inbox count.',
  {},
  async () => textResult(await callGatewayRpc('reddit.status'))
)

server.registerTool(
  'reddit_feed',
  {
    title: 'Reddit Feed Explorer',
    description: 'Read posts from Reddit (Home, Popular, News, or a specific subreddit) sorted by hot, new, top, or rising.',
    inputSchema: {
      subreddit: z.string().optional().describe('Subreddit name (e.g. "AI_Coders" or "technology"). Omit for global feed.'),
      sort: z.enum(['hot', 'new', 'top', 'rising']).optional().describe('Sort order. Defaults to "hot".'),
      limit: z.number().int().min(1).max(50).optional().describe('Max posts to fetch (1-50). Defaults to 25.'),
      timeFilter: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time window for top sort.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/social-radar.html',
      },
    },
  },
  async (args) => formatRedditVisual(await callGatewayRpc('reddit.feed', args))
)

server.tool(
  'reddit_post_comments',
  'Read full text and nested comments for a specific Reddit post.',
  {
    subreddit: z.string().describe('Subreddit name (e.g. "AI_Coders").'),
    postId: z.string().describe('The post ID (e.g. "1wkg3bi" or "t3_1wkg3bi").'),
    limit: z.number().int().min(1).max(100).optional().describe('Max comments to fetch.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.postComments', args))
)

server.registerTool(
  'reddit_search',
  {
    title: 'Reddit Search Radar',
    description: 'Search Reddit posts by keyword across subreddits.',
    inputSchema: {
      query: z.string().min(1).describe('Search query keyword.'),
      sort: z.enum(['relevance', 'hot', 'top', 'new']).optional().describe('Sorting criteria.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results to return.'),
      t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time window, e.g. "day" = last 24 hours.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/social-radar.html',
      },
    },
  },
  async (args) => formatRedditVisual(await callGatewayRpc('reddit.search', args))
)

server.tool(
  'reddit_vote_post',
  'Upvote, downvote, or clear vote on a Reddit post.',
  {
    postId: z.string().min(1).describe('Post ID (e.g. "t3_1wkg3bi").'),
    voteState: z.enum(['UP', 'DOWN', 'NONE']).describe('Vote action: UP, DOWN, or NONE.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.votePost', args))
)

server.tool(
  'reddit_vote_comment',
  'Upvote, downvote, or clear vote on a Reddit comment.',
  {
    commentId: z.string().min(1).describe('Comment ID (e.g. "t1_pa13h2m").'),
    voteState: z.enum(['UP', 'DOWN', 'NONE']).describe('Vote action: UP, DOWN, or NONE.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.voteComment', args))
)

server.tool(
  'reddit_create_comment',
  'Post a public comment or reply on Reddit.',
  {
    postId: z.string().min(1).describe('Post ID where comment will be placed.'),
    parentId: z.string().min(1).describe('Parent post or comment fullname ID.'),
    text: z.string().min(1).describe('Comment text to submit.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.createComment', args))
)

server.tool(
  'reddit_create_post',
  'Publish a new post in a subreddit with title and body text.',
  {
    subreddit: z.string().min(1).describe('Target subreddit name (e.g. "r/AI_Coders").'),
    title: z.string().min(1).describe('Title of the post.'),
    body: z.string().optional().describe('Text body of the post.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.createPost', args))
)

server.tool(
  'reddit_subscribe',
  'Join or leave a subreddit community.',
  {
    subredditId: z.string().min(1).describe('Subreddit ID (e.g. "t5_2sama").'),
    subscribeState: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']).describe('Subscription state.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.subscribe', args))
)

server.tool(
  'reddit_mark_read',
  'Mark all Reddit notifications as read.',
  {},
  async () => textResult(await callGatewayRpc('reddit.markRead'))
)

server.tool(
  'reddit_api_feed',
  'Fast in-session Reddit feed JSON API (<300ms, zero DOM overhead). Returns structured posts with scores, comment counts, permalinks, and media indicators.',
  {
    subreddit: z.string().optional().describe('Subreddit name (e.g. "technology" or "reactjs"). Omit for home feed.'),
    sort: z.string().optional().describe('Sort algorithm: "hot", "new", "top", "rising". Defaults to "hot".'),
    limit: z.number().int().min(1).max(100).optional().describe('Max posts to fetch (1-100). Defaults to 25.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.api_feed', args))
)

server.tool(
  'reddit_api_search',
  'Fast in-session Reddit search JSON API (<300ms, zero DOM overhead). Searches keywords globally or restricted to a specific subreddit.',
  {
    query: z.string().min(1).describe('Search query keyword or phrase.'),
    subreddit: z.string().optional().describe('Optional subreddit name to restrict search to.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results to return (1-100). Defaults to 25.'),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional().describe('Sort order. Use "top" with t="day" for the last 24h top posts.'),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time window, e.g. "day" = last 24 hours.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.api_search', args))
)

server.tool(
  'reddit_api_comments',
  'Fast in-session Reddit post comments JSON tree and top comments flattener.',
  {
    postId: z.string().min(1).describe('Reddit post ID (e.g. "1wkg3bi" or "t3_1wkg3bi").'),
    limit: z.number().int().min(1).max(200).optional().describe('Max top comments to return (1-200). Defaults to 50.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.api_post_comments', args))
)

server.tool(
  'reddit_outlier',
  'Reddit viral pain-point & hook template engine. Calculates median upvotes & comments across 50 posts, detects viral outlier posts (score >= multiplier * median), isolates high-debate frustration pain points, and extracts top hook structures.',
  {
    subreddit: z.string().min(1).describe('Subreddit name (e.g. "technology", "reactjs", "SaaS").'),
    minMultiplier: z.number().min(1.0).optional().describe('Minimum outlier multiplier threshold. Defaults to 3.0x.'),
    sort: z.enum(['hot', 'top', 'rising']).optional().describe('Listing to sample. Defaults to hot.'),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time window, e.g. "day" = last 24 hours.'),
  },
  async (args) => textResult(await callGatewayRpc('reddit.outlier', args))
)

// ── WHATSAPP TOOLS ───────────────────────────────────────────────────────────

server.tool(
  'whatsapp_status',
  'Check whether WhatsApp Web is authenticated and connected.',
  {},
  async () => textResult(await callGatewayRpc('whatsapp.status'))
)

server.registerTool(
  'whatsapp_list_chats',
  {
    title: 'WhatsApp Chats Hub',
    description: 'List recent chats on WhatsApp.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Number of chats.'),
      onlyUnread: z.boolean().optional().describe('Show only chats with unread messages.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/whatsapp-inbox.html',
      },
    },
  },
  async (args) => formatWhatsAppVisual(await callGatewayRpc('whatsapp.listChats', args))
)

server.tool(
  'whatsapp_list_messages',
  'Get messages from a WhatsApp chat.',
  {
    chatId: z.string().min(1).describe('The WhatsApp chat ID (e.g. "123456789@c.us").'),
    limit: z.number().int().min(1).max(100).optional().describe('Max messages to return.'),
  },
  async (args) => textResult(await callGatewayRpc('whatsapp.listMessages', args))
)

server.tool(
  'whatsapp_send',
  'Send a message to a WhatsApp chat or contact.',
  {
    chatId: z.string().min(1).describe('Recipient chat ID (phone number or JID).'),
    text: z.string().min(1).describe('Message text to send.'),
  },
  async (args) => textResult(await callGatewayRpc('whatsapp.send', args))
)

server.registerTool(
  'whatsapp_unread',
  {
    title: 'WhatsApp Unread Inbox',
    description: 'Get all unread WhatsApp chats with their recent messages.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Max chats to return.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/whatsapp-inbox.html',
      },
    },
  },
  async (args) => formatWhatsAppVisual(await callGatewayRpc('whatsapp.unread', args))
)

server.tool(
  'whatsapp_api_chats',
  'Fast in-session WhatsApp chat list (<200ms response). Returns recent conversations with IDs, names, and unread counts.',
  {
    limit: z.number().int().min(1).max(100).optional().describe('Number of chats to return. Defaults to 20.'),
    onlyUnread: z.boolean().optional().describe('Filter to chats with unread messages only.'),
  },
  async (args) => textResult(await callGatewayRpc('whatsapp.api_chats', args))
)

server.tool(
  'whatsapp_api_messages',
  'Fast in-session WhatsApp messages reader for a specific conversation.',
  {
    chatId: z.string().min(1).describe('WhatsApp chat ID (phone number or JID, e.g. "123456789@c.us").'),
    limit: z.number().int().min(1).max(100).optional().describe('Max messages to return. Defaults to 20.'),
  },
  async (args) => textResult(await callGatewayRpc('whatsapp.api_messages', args))
)

// ── LINKEDIN TOOLS ───────────────────────────────────────────────────────────

server.tool(
  'linkedin_accounts',
  'List all connected LinkedIn accounts in FlowDesk (Account 1, Account 2, etc.) with authentication status, name, publicId, headline, partition, and active state.',
  {},
  async () => textResult(await callGatewayRpc('linkedin.accounts'))
)

server.tool(
  'linkedin_switch_account',
  'Switch the currently active displayed LinkedIn account profile in FlowDesk.',
  {
    account: z.string().describe('Target account ID, label/name, or partition (e.g. "1", "2", "Personal", "Sales", "social-linkedin-2").'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.switchAccount', args))
)

server.tool(
  'linkedin_status',
  'Check LinkedIn authentication status and profile.',
  {
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition (e.g. "1", "2", "Personal", "Sales"). Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.status', args))
)

server.registerTool(
  'linkedin_feed',
  {
    title: 'LinkedIn Feed Explorer',
    description: 'Read recent posts from LinkedIn feed.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Number of updates.'),
      sort: z.string().optional().describe('Sorting algorithm.'),
      account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/social-radar.html',
      },
    },
  },
  async (args) => formatLinkedInVisual(await callGatewayRpc('linkedin.feed', args))
)

server.registerTool(
  'linkedin_search',
  {
    title: 'LinkedIn Search Radar',
    description: 'Search LinkedIn for people, content or companies.',
    inputSchema: {
      query: z.string().min(1).describe('Search query keyword.'),
      limit: z.number().int().min(1).max(50).optional().describe('Number of results.'),
      account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/social-radar.html',
      },
    },
  },
  async (args) => formatLinkedInVisual(await callGatewayRpc('linkedin.search', args))
)

server.tool(
  'linkedin_send',
  'Send a message in an existing LinkedIn conversation.',
  {
    conversationUrn: z.string().min(1).describe('Target conversation URN.'),
    text: z.string().min(1).describe('Message text.'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.send', args))
)

server.tool(
  'linkedin_api_feed',
  'Fast in-session LinkedIn feed via Voyager API (<300ms response). Returns structured posts, authors, text, and engagement metrics.',
  {
    limit: z.number().int().min(1).max(100).optional().describe('Max posts to fetch (1-100). Defaults to 20.'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.api_feed', args))
)

server.tool(
  'linkedin_outlier',
  'LinkedIn viral hook analyzer and format classifier. Computes median scores, flags viral breakout posts, extracts hooks and classifies post format templates.',
  {
    minMultiplier: z.number().min(1.0).optional().describe('Minimum outlier multiplier threshold. Defaults to 3.0x.'),
    limit: z.number().int().min(5).max(100).optional().describe('Max sample posts to inspect. Defaults to 30.'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.outlier', args))
)

server.tool(
  'linkedin_get_profile',
  'Retrieve full authenticated LinkedIn profile details including name, headline, summary/about, location, email, education, experience, publicIdentifier, profilePicture, and backgroundPicture.',
  {
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.getProfile', args))
)

server.tool(
  'linkedin_update_profile',
  'Update authenticated LinkedIn profile intro details (firstName, lastName, headline, location, summary).',
  {
    firstName: z.string().optional().describe('First name.'),
    lastName: z.string().optional().describe('Last name.'),
    headline: z.string().optional().describe('Professional headline.'),
    location: z.string().optional().describe('Location or city.'),
    summary: z.string().optional().describe('Summary / about text.'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.updateProfile', args))
)

server.tool(
  'linkedin_upload_photo',
  'Upload and set a new profile avatar photo for the authenticated LinkedIn user.',
  {
    imagePath: z.string().min(1).describe('Absolute local file path to the image (JPEG/PNG/GIF/WebP).'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.uploadProfilePhoto', args))
)

server.tool(
  'linkedin_upload_cover',
  'Upload and set a new background cover banner image for the authenticated LinkedIn user.',
  {
    imagePath: z.string().min(1).describe('Absolute local file path to the image (JPEG/PNG/GIF/WebP).'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.uploadCoverImage', args))
)

server.tool(
  'linkedin_list_chats',
  'Fetch recent LinkedIn conversations/threads with participant names, URNs, and last messages.',
  {
    limit: z.number().int().min(1).max(50).optional().describe('Max conversations to return (defaults to 20).'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.listChats', args))
)

server.tool(
  'linkedin_list_messages',
  'Read full message history for a specific LinkedIn conversation thread.',
  {
    conversationUrn: z.string().min(1).describe('LinkedIn conversation URN (e.g. "urn:li:msg_conversation:(...)").'),
    limit: z.number().int().min(1).max(100).optional().describe('Max messages to fetch (defaults to 20).'),
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.listMessages', args))
)

server.tool(
  'linkedin_unread',
  'Check for unread LinkedIn messages in the primary inbox.',
  {
    account: z.string().optional().describe('Target LinkedIn account ID, label, or partition. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('linkedin.unread', args))
)

// ── TIKTOK TOOLS ─────────────────────────────────────────────────────────────

server.tool(
  'tiktok_accounts',
  'List all connected TikTok accounts in FlowDesk (Account 1, Account 2, etc.) with authentication status and active state.',
  {},
  async () => textResult(await callGatewayRpc('tiktok.accounts'))
)

server.tool(
  'tiktok_switch_account',
  'Switch the currently active displayed TikTok account profile in FlowDesk.',
  {
    account: z.string().describe('Target account ID or partition (e.g. "1", "2", "social-tiktok-2").'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.switchAccount', args))
)

server.tool(
  'tiktok_api_upload_video',
  'Upload and publish a local video to TikTok over the web API (no Studio UI). Defaults to private ("Only you"). Returns the new item id only when TikTok confirms the post.',
  {
    filePath: z.string().min(1).describe('Absolute path to a local .mp4 file.'),
    caption: z.string().optional().describe('Post caption.'),
    privacy: z.enum(['private', 'friends', 'public']).optional().describe('Defaults to private. Scheduling needs friends or public.'),
    scheduleAt: z.string().optional().describe('Publish later: ISO date-time 15 minutes to 10 days ahead, e.g. "2026-09-30T18:00:00+05:00". Not allowed with private.'),
    account: z.string().optional().describe('Target account ID. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.apiUploadVideo', args))
)

server.tool(
  'tiktok_update_profile',
  'Change the signed-in TikTok bio over the web API. Limit is 80 by TikTok count (emoji count 2). Returns ok only after the new bio reads back.',
  {
    bio: z.string().describe('New bio text. Use \n for line breaks.'),
    account: z.string().optional().describe('Target account ID. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.updateProfile', args))
)

server.tool(
  'tiktok_get_profile',
  'Read the signed-in TikTok profile over the in-session API: nickname, bio, avatar, secUid, followers, following, likes, video count and privacy.',
  {
    account: z.string().optional().describe('Target account ID: "1", "2" or "3". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.getProfile', args))
)

server.tool(
  'tiktok_edit_video_caption',
  'Edit the caption of one of your own TikTok videos. Returns ok only when the page confirms the save.',
  {
    videoId: z.string().min(1).describe('Numeric TikTok video id.'),
    caption: z.string().min(1).describe('New caption text.'),
    account: z.string().optional().describe('Target account ID. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.editVideoCaption', args))
)

server.tool(
  'tiktok_status',
  'Check TikTok connection status in FlowDesk, returning whether session is authenticated or running in guest research mode.',
  {
    account: z.string().optional().describe('Target account ID: "1" for Account 1, "2" for Account 2. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.status', args))
)

server.registerTool(
  'tiktok_feed',
  {
    title: 'TikTok Feed & Viral Explorer',
    description: 'Read trending and explore videos from TikTok with view counts, creator handles, direct links, and video cover thumbnails. Does not require login.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Max videos to fetch (1-50). Defaults to 20.'),
      account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/tiktok-dashboard.html',
      },
    },
  },
  async (args) => formatTikTokVisual(await callGatewayRpc('tiktok.feed', args))
)

server.registerTool(
  'tiktok_search',
  {
    title: 'TikTok Search & Topic Radar',
    description: 'Search TikTok videos, viral hooks, and competitor creators by keyword or niche topic. Returns video metrics (view counts, "Top liked" badges, creator IDs). Essential for content research, viral trends, and SEO.',
    inputSchema: {
      query: z.string().min(1).describe('Search keyword or topic (e.g. "AI animation", "ecommerce", "fitness tips").'),
      limit: z.number().int().min(1).max(50).optional().describe('Max videos to return. Defaults to 20.'),
      account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/tiktok-dashboard.html',
      },
    },
  },
  async (args) => formatTikTokVisual(await callGatewayRpc('tiktok.search', args))
)

server.tool(
  'tiktok_video_detail',
  'Inspect single TikTok video page to extract likes count, comments count, shares count, caption, hashtags, and background sound/music.',
  {
    url: z.string().url().describe('TikTok video URL (e.g. "https://www.tiktok.com/@user/video/12345").'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.videoDetail', args))
)

server.tool(
  'tiktok_suggest',
  'Harvest high-intent SEO keywords, recommended sub-topics, and viral hashtag clusters from top search results on TikTok for a seed keyword.',
  {
    seed: z.string().min(1).describe('Seed keyword or niche (e.g. "ai animation", "kids cartoon", "baking").'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.suggest', args))
)

server.registerTool(
  'tiktok_outlier',
  {
    title: 'TikTok Viral Outlier Scanner',
    description: 'Mine mathematically proven viral outlier videos (Viral View Ratio / VVR >= 3x above creator median baseline) to find replicable winning formats.',
    inputSchema: {
      creator: z.string().min(1).describe('Creator username handle (e.g. "nexivo92") or niche keyword to scan.'),
      account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/tiktok-dashboard.html',
      },
    },
  },
  async (args) => formatTikTokVisual(await callGatewayRpc('tiktok.outlier', args))
)

// ── FAST BACKGROUND TIKTOK IN-SESSION APIS (Zero UI Page Loads) ─────────────

function buildMcpApiSearchScript(query, limit = 20, offset = 0) {
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const q = encodeURIComponent(${JSON.stringify(query)})
      const res = await fetch('/api/search/general/full/?keyword=' + q + '&offset=' + ${offset} + '&count=' + ${limit}, {
        headers: { 'Accept': 'application/json' }
      })
      if (!res.ok) {
        return { ok: false, error: 'TikTok API returned HTTP ' + res.status }
      }

      const json = await res.json()
      const data = json.data || []
      const videos = []
      const creators = []

      for (const entry of data) {
        if (entry.type === 4 && entry.user_list) {
          for (const u of entry.user_list) {
            const ui = u.user_info
            if (ui) {
              creators.push({
                uniqueId: ui.unique_id,
                nickname: ui.nickname,
                followerCount: ui.follower_count,
                totalFavorited: ui.total_favorited,
                verified: ui.custom_verify || Boolean(ui.verification_type),
                signature: ui.signature,
              })
            }
          }
        } else if (entry.type === 1 && entry.item) {
          const item = entry.item
          const ts = extractTs(item, item.id)
          videos.push({
            id: item.id,
            url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || 'user') + '/video/' + item.id,
            author: item.author?.uniqueId || 'unknown',
            authorNickname: item.author?.nickname || '',
            desc: item.desc || '',
            views: item.stats?.playCount || 0,
            likes: item.stats?.diggCount || 0,
            comments: item.stats?.commentCount || 0,
            shares: item.stats?.shareCount || 0,
            duration: item.video?.duration || 0,
            coverUrl: item.video?.cover || item.video?.originCover || null,
            uploadTimestamp: ts,
            uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
            timeAgo: formatTimeAgo(ts),
          })
        }
      }

      return {
        ok: true,
        mode: 'api_fast',
        query: ${JSON.stringify(query)},
        count: videos.length,
        hasMore: Boolean(json.has_more),
        cursor: json.cursor || 0,
        videos,
        creators
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

function buildMcpApiCreatorFeedScript(creatorHandle, limit = 30) {
  const cleanTarget = creatorHandle.replace(/^@/, '').trim().toLowerCase()
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const clean = ${JSON.stringify(cleanTarget)}
      const [searchRes, profileRes] = await Promise.allSettled([
        fetch('/api/search/general/full/?keyword=' + encodeURIComponent(clean) + '&offset=0&count=' + ${limit}, {
          headers: { 'Accept': 'application/json' }
        }).then(r => r.json()),
        fetch('https://www.tiktok.com/@' + clean).then(r => r.text())
      ])

      let profile = null
      if (profileRes.status === 'fulfilled' && profileRes.value) {
        const match = profileRes.value.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
        if (match) {
          try {
            const raw = JSON.parse(match[1])
            const uInfo = raw['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo || {}
            const user = uInfo.user || {}
            const stats = uInfo.stats || {}
            profile = {
              uniqueId: user.uniqueId || clean,
              nickname: user.nickname || '',
              followerCount: stats.followerCount || 0,
              heartCount: stats.heartCount || 0,
              videoCount: stats.videoCount || 0
            }
          } catch (e) {}
        }
      }

      const videos = []
      if (searchRes.status === 'fulfilled' && searchRes.value?.data) {
        for (const entry of searchRes.value.data) {
          if (entry.type === 1 && entry.item) {
            const item = entry.item
            const author = (item.author?.uniqueId || '').toLowerCase()
            if (author.includes(clean) || clean.includes(author)) {
              const ts = extractTs(item, item.id)
              videos.push({
                id: item.id,
                url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || clean) + '/video/' + item.id,
                author: item.author?.uniqueId || clean,
                authorNickname: item.author?.nickname || '',
                desc: item.desc || '',
                views: item.stats?.playCount || 0,
                likes: item.stats?.diggCount || 0,
                comments: item.stats?.commentCount || 0,
                shares: item.stats?.shareCount || 0,
                duration: item.video?.duration || 0,
                coverUrl: item.video?.cover || null,
                uploadTimestamp: ts,
                uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                timeAgo: formatTimeAgo(ts),
              })
            }
          }
        }
      }

      return {
        ok: true,
        mode: 'api_fast',
        creator: clean,
        profile,
        count: videos.length,
        videos
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

function buildMcpApiOutlierScript(creatorHandle, minMultiplier = 3.0) {
  const cleanTarget = creatorHandle.replace(/^@/, '').trim().toLowerCase()
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const clean = ${JSON.stringify(cleanTarget)}
      const minMult = ${minMultiplier}

      const [searchRes, profileRes] = await Promise.allSettled([
        fetch('/api/search/general/full/?keyword=' + encodeURIComponent(clean) + '&offset=0&count=35', {
          headers: { 'Accept': 'application/json' }
        }).then(r => r.json()),
        fetch('https://www.tiktok.com/@' + clean).then(r => r.text())
      ])

      let profile = null
      if (profileRes.status === 'fulfilled' && profileRes.value) {
        const match = profileRes.value.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
        if (match) {
          try {
            const raw = JSON.parse(match[1])
            const uInfo = raw['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo || {}
            const user = uInfo.user || {}
            const stats = uInfo.stats || {}
            profile = {
              uniqueId: user.uniqueId || clean,
              nickname: user.nickname || '',
              followerCount: stats.followerCount || 0,
              heartCount: stats.heartCount || 0,
              videoCount: stats.videoCount || 0
            }
          } catch (e) {}
        }
      }

      const allVideos = []
      if (searchRes.status === 'fulfilled' && searchRes.value?.data) {
        for (const entry of searchRes.value.data) {
          if (entry.type === 1 && entry.item) {
            const item = entry.item
            const author = (item.author?.uniqueId || '').toLowerCase()
            if (author.includes(clean) || clean.includes(author)) {
              const ts = extractTs(item, item.id)
              allVideos.push({
                id: item.id,
                url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || clean) + '/video/' + item.id,
                author: item.author?.uniqueId || clean,
                authorNickname: item.author?.nickname || '',
                desc: item.desc || '',
                views: item.stats?.playCount || 0,
                likes: item.stats?.diggCount || 0,
                comments: item.stats?.commentCount || 0,
                shares: item.stats?.shareCount || 0,
                duration: item.video?.duration || 0,
                coverUrl: item.video?.cover || null,
                uploadTimestamp: ts,
                uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                timeAgo: formatTimeAgo(ts),
              })
            }
          }
        }
      }

      const viewList = allVideos.map(v => v.views).filter(v => v > 0).sort((a, b) => a - b)
      let median = 0
      if (viewList.length > 0) {
        const mid = Math.floor(viewList.length / 2)
        median = viewList.length % 2 !== 0 ? viewList[mid] : Math.round((viewList[mid - 1] + viewList[mid]) / 2)
      }

      const now = Math.floor(Date.now() / 1000)
      const outliers = allVideos
        .map(v => {
          const ratio = median > 0 ? Math.round((v.views / median) * 10) / 10 : (v.views > 10000 ? 5.0 : 1.0)
          const isFresh = v.uploadTimestamp ? (now - v.uploadTimestamp) < (86400 * 4) : false
          return {
            ...v,
            baselineMedian: median,
            outlierMultiplier: ratio,
            isFreshViral: isFresh && ratio >= 2.0,
            viralityBadge: ratio >= 10 ? '🔥 SUPER_VIRAL (' + ratio + 'x)' : (ratio >= 3 ? '⭐ OUTLIER (' + ratio + 'x)' : 'NORMAL')
          }
        })
        .filter(v => (v.outlierMultiplier >= minMult && v.views >= 500) || v.isFreshViral)
        .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

      return {
        ok: true,
        mode: 'api_fast',
        creator: clean,
        profile,
        totalVideosScanned: allVideos.length,
        baselineMedianViews: median,
        outlierCount: outliers.length,
        outliers
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

function buildMcpApiBatchOutliersScript(creators, minMultiplier = 2.5) {
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const creatorList = ${JSON.stringify(creators)}.map(c => c.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)
      const minMult = ${minMultiplier}
      const now = Math.floor(Date.now() / 1000)

      const results = await Promise.allSettled(
        creatorList.map(async (creator) => {
          const res = await fetch('/api/search/general/full/?keyword=' + encodeURIComponent(creator) + '&offset=0&count=25', {
            headers: { 'Accept': 'application/json' }
          })
          if (!res.ok) return { creator, ok: false, error: 'HTTP ' + res.status }
          const json = await res.json()
          const videos = []
          for (const entry of (json.data || [])) {
            if (entry.type === 1 && entry.item) {
              const item = entry.item
              const author = (item.author?.uniqueId || '').toLowerCase()
              if (author.includes(creator) || creator.includes(author)) {
                const ts = extractTs(item, item.id)
                videos.push({
                  id: item.id,
                  url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || creator) + '/video/' + item.id,
                  author: item.author?.uniqueId || creator,
                  desc: item.desc || '',
                  views: item.stats?.playCount || 0,
                  likes: item.stats?.diggCount || 0,
                  comments: item.stats?.commentCount || 0,
                  shares: item.stats?.shareCount || 0,
                  coverUrl: item.video?.cover || null,
                  uploadTimestamp: ts,
                  uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                  timeAgo: formatTimeAgo(ts),
                })
              }
            }
          }

          const viewList = videos.map(v => v.views).filter(v => v > 0).sort((a, b) => a - b)
          let median = 0
          if (viewList.length > 0) {
            const mid = Math.floor(viewList.length / 2)
            median = viewList.length % 2 !== 0 ? viewList[mid] : Math.round((viewList[mid - 1] + viewList[mid]) / 2)
          }

          const outliers = videos
            .map(v => {
              const ratio = median > 0 ? Math.round((v.views / median) * 10) / 10 : 1.0
              const isFresh = v.uploadTimestamp ? (now - v.uploadTimestamp) < (86400 * 4) : false
              return {
                ...v,
                baselineMedian: median,
                outlierMultiplier: ratio,
                isFreshViral: isFresh && ratio >= 2.0,
                viralityBadge: ratio >= 10 ? '🔥 SUPER_VIRAL (' + ratio + 'x)' : (ratio >= 3 ? '⭐ OUTLIER (' + ratio + 'x)' : 'ELEVATED (' + ratio + 'x)')
              }
            })
            .filter(v => (v.outlierMultiplier >= minMult && v.views >= 500) || v.isFreshViral)
            .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

          return {
            creator,
            ok: true,
            totalScanned: videos.length,
            baselineMedian: median,
            outliers
          }
        })
      )

      const successful = []
      const allOutliers = []

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          successful.push(r.value)
          for (const o of r.value.outliers) {
            allOutliers.push(o)
          }
        }
      }

      allOutliers.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

      return {
        ok: true,
        mode: 'api_fast_batch',
        creatorsRequested: creatorList.length,
        creatorsSuccessful: successful.length,
        totalOutliersFound: allOutliers.length,
        allOutliers,
        byCreator: successful
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

server.tool(
  'tiktok_api_search',
  'Ultra-fast background JSON search for TikTok videos, trending hooks, and creators. Zero page navigation, runs in ~250ms with exact view counts and upload time ago.',
  {
    query: z.string().min(1).describe('Search keyword or topic (e.g. "AI animals", "talking fruit").'),
    limit: z.number().int().min(1).max(50).optional().describe('Max videos to return. Defaults to 20.'),
    offset: z.number().int().min(0).optional().describe('Pagination offset. Defaults to 0.'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => {
    try {
      return formatTikTokVisual(await callGatewayRpc('tiktok.api.search', args))
    } catch (err) {
      if (String(err.message).includes('Method not found')) {
        const code = buildMcpApiSearchScript(args.query, args.limit || 20, args.offset || 0)
        return formatTikTokVisual(await callGatewayRpc('tiktok.eval', { code, account: args.account }))
      }
      throw err
    }
  }
)

server.tool(
  'tiktok_api_creator_feed',
  'Fetch full video catalog and profile metadata for any TikTok creator in ~300ms without opening their page. Returns exact views, likes, and upload timestamps.',
  {
    creator: z.string().min(1).describe('Creator username handle (e.g. "camelaiuniverse").'),
    limit: z.number().int().min(1).max(50).optional().describe('Max videos to return. Defaults to 30.'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => {
    try {
      return formatTikTokVisual(await callGatewayRpc('tiktok.api.creatorFeed', args))
    } catch (err) {
      if (String(err.message).includes('Method not found')) {
        const code = buildMcpApiCreatorFeedScript(args.creator, args.limit || 30)
        return formatTikTokVisual(await callGatewayRpc('tiktok.eval', { code, account: args.account }))
      }
      throw err
    }
  }
)

server.tool(
  'tiktok_api_outlier',
  'Ultra-fast mathematical outlier scanner for a creator. Calculates baseline median views, outlier multiplier (3x, 5x, 10x, 80x), and exact days/hours ago uploaded.',
  {
    creator: z.string().min(1).describe('Creator username handle (e.g. "camelaiuniverse").'),
    minMultiplier: z.number().min(1.5).optional().describe('Minimum outlier multiplier threshold. Defaults to 3.0x.'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => {
    try {
      return formatTikTokVisual(await callGatewayRpc('tiktok.api.outlier', args))
    } catch (err) {
      if (String(err.message).includes('Method not found')) {
        const code = buildMcpApiOutlierScript(args.creator, args.minMultiplier || 3.0)
        return formatTikTokVisual(await callGatewayRpc('tiktok.eval', { code, account: args.account }))
      }
      throw err
    }
  }
)

server.tool(
  'tiktok_api_video_detail',
  'Deep forensic inspection of a single TikTok video in ~300ms without UI navigation. Returns exact view count, likes, shares, comments, create time, and sound title.',
  {
    url: z.string().describe('TikTok video URL or video ID.'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => {
    try {
      return textResult(await callGatewayRpc('tiktok.api.videoDetail', args))
    } catch (err) {
      if (String(err.message).includes('Method not found')) {
        const code = `(async () => {
          try {
            const res = await fetch(${JSON.stringify(args.url)})
            const html = await res.text()
            const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
            if (!match) return { ok: false, error: 'Metadata not found' }
            const raw = JSON.parse(match[1])
            const item = raw['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct
            return { ok: true, item }
          } catch(e) { return { ok: false, error: e.message } }
        })()`
        return textResult(await callGatewayRpc('tiktok.eval', { code, account: args.account }))
      }
      throw err
    }
  }
)

server.tool(
  'tiktok_api_batch_outliers',
  'Parallel bulk outlier scanning across multiple creators in a single call. Scans all requested channels in parallel and aggregates ranked viral outliers.',
  {
    creators: z.array(z.string()).min(1).describe('List of creator username handles to scan in parallel.'),
    minMultiplier: z.number().min(1.5).optional().describe('Minimum outlier multiplier threshold. Defaults to 2.5x.'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => {
    try {
      return formatTikTokVisual(await callGatewayRpc('tiktok.api.batchOutliers', args))
    } catch (err) {
      if (String(err.message).includes('Method not found')) {
        const code = buildMcpApiBatchOutliersScript(args.creators, args.minMultiplier || 2.5)
        return formatTikTokVisual(await callGatewayRpc('tiktok.eval', { code, account: args.account }))
      }
      throw err
    }
  }
)

server.tool(
  'tiktok_upload_video',
  'Upload a video file to TikTok Studio with title, caption, hashtags, interaction permissions (allowComment, allowDuet), and optional future scheduling.',
  {
    videoFilePath: z.string().min(1).describe('Absolute local path to the MP4 video file to upload.'),
    caption: z.string().min(1).describe('Full video caption including description and hashtags (e.g. "#alphapaws #gymcat").'),
    scheduleTime: z.string().optional().describe('Future ISO date/time string (e.g. "2026-09-24T18:00:00") to schedule the video on TikTok Studio instead of posting immediately.'),
    allowComment: z.boolean().optional().describe('Whether to allow comments on the video (defaults to true).'),
    allowDuet: z.boolean().optional().describe('Whether to allow Duet and Stitch reuse (defaults to true).'),
    account: z.string().optional().describe('Target account ID: "1" for Account 1, "2" for Account 2. Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.uploadVideo', args))
)

server.tool(
  'tiktok_submit_post',
  'Submit and publish the currently prepared video on TikTok Studio.',
  {
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.submitPost', args))
)

server.tool(
  'tiktok_list_posts',
  'List all published or studio videos for a TikTok account, returning video IDs, captions, direct URLs, and view counts.',
  {
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.listPosts', args))
)

server.tool(
  'tiktok_delete_video',
  'Delete a specific video from TikTok by videoId or direct videoUrl.',
  {
    videoId: z.string().optional().describe('TikTok video ID (e.g. "7655981101353143574").'),
    videoUrl: z.string().url().optional().describe('Full TikTok video URL (e.g. "https://www.tiktok.com/@user/video/12345").'),
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.deleteVideo', args))
)

server.tool(
  'tiktok_delete_all_videos',
  'Safely and sequentially delete all videos from the specified TikTok account with automatic confirmation and rate-limit safety pauses.',
  {
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
    limit: z.number().int().min(1).max(200).optional().describe('Maximum number of videos to delete in this batch (defaults to 100).'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.deleteAllVideos', args))
)

server.tool(
  'tiktok_radar_niches',
  'List TikTok niche-radar niches (keywords, seed hashtags, watched creators) and whether each is collecting.',
  {},
  async () => textResult(await callGatewayRpc('tiktok.radarNiches'))
)

server.tool(
  'tiktok_radar_save_niche',
  'Create or update a TikTok niche for the radar. Creators are discovered automatically from the keywords on the first collection if none are given.',
  {
    id: z.string().min(1).describe('Slug id, e.g. "ai-cats".'),
    name: z.string().min(1).describe('Display name.'),
    keywords: z.array(z.string()).min(1).max(30).describe('Search keywords that define the niche, e.g. ["ai cat","funny cat","#catsoftiktok"].'),
    seedTags: z.array(z.string()).optional().describe('Core hashtags of the niche without #, e.g. ["cat","cats","aicat"].'),
    intervalMin: z.number().int().min(5).max(1440).optional().describe('Minutes between collections when started (default 20).'),
    enabled: z.boolean().optional(),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.radarSaveNiche', { niche: args }))
)

server.tool(
  'tiktok_radar_collect',
  'Run one read-only radar collection now for a niche: newest posts of watched creators, their stats, and sound usage counts. About 1-5 minutes (4 s between calls).',
  { id: z.string().min(1).describe('Niche id.') },
  async (args) => textResult(await callGatewayRpc('tiktok.radarCollect', args))
)

server.tool(
  'tiktok_radar_start',
  'Start background radar collection for a niche (every intervalMin). Snapshots over time are what reveal views/hour and sound growth.',
  { id: z.string().min(1).describe('Niche id.') },
  async (args) => textResult(await callGatewayRpc('tiktok.radarStart', args))
)

server.tool(
  'tiktok_radar_stop',
  'Stop background radar collection for a niche.',
  { id: z.string().min(1).describe('Niche id.') },
  async (args) => textResult(await callGatewayRpc('tiktok.radarStop', args))
)

server.tool(
  'tiktok_radar_report',
  'What is working in a TikTok niche right now: breakout and outlier videos (views/hour, x-times the creator normal, share/save rates, evidence), sounds with momentum and their phase (EARLY/PEAKING/SATURATED), 3-5 hashtags to use, and ranked content opportunities (idea + sound + tags + best hour + length). Includes caveats when data is thin. Use this before planning a video.',
  {
    id: z.string().min(1).describe('Niche id.'),
    hours: z.number().min(1).max(168).optional().describe('Look-back window for top videos (default 24).'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.radarReport', args))
)

server.tool(
  'tiktok_warmup_scroll',
  'Autonomously simulate human browsing on TikTok: smoothly scroll FYP or niche feed, watch videos with realistic 4-10s duration, and optionally like relevant posts. Wields account warming to boost trust score and FYP reach.',
  {
    account: z.string().optional().describe('Target account ID: "1" or "2". Defaults to active account.'),
    durationSeconds: z.number().int().min(10).max(600).optional().describe('Duration in seconds to scroll (e.g. 60 for 1 minute). Defaults to 60.'),
    niche: z.string().optional().describe('Optional niche keyword to search and warm on (e.g. "gym cats", "funny pets"). Defaults to FYP feed.'),
    autoLike: z.boolean().optional().describe('Whether to organically like videos (approx 20% rate). Defaults to false.'),
  },
  async (args) => textResult(await callGatewayRpc('tiktok.warmupScroll', args))
)


// ── AI BROWSER WORKERS (Via Logged-in Desktop Sessions) ──────────────────────

server.tool(
  'ask_chatgpt',
  'Ask OpenAI ChatGPT via the user\'s logged-in desktop browser session in FlowDesk. Good for general coding, writing, and broad reasoning.',
  { prompt: z.string().min(1).describe('The prompt or question to send to ChatGPT.') },
  async (args) => textResult(await callGatewayRpc('ask.chatgpt', args))
)

server.tool(
  'chatgpt_chats',
  'List the latest ChatGPT chats (newest first), merged across every signed-in account or on one. Returns id, title, last update and the account each chat lives on.',
  {
    limit: z.number().int().min(1).max(50).optional().describe('How many chats (default 10).'),
    account: z.string().optional().describe('Only this account (email or partition from chatgpt_image_accounts).'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.chats', args))
)

server.tool(
  'chatgpt_chat_read',
  'Read one ChatGPT chat: what was said, in order, and the ids of images in it. Finds the owning account itself unless one is given.',
  {
    chatId: z.string().min(1).describe('Chat id from chatgpt_chats.'),
    account: z.string().optional().describe('Account that owns the chat (optional).'),
    lastN: z.number().int().min(1).max(200).optional().describe('Only the last N messages.'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.chatRead', args))
)

server.tool(
  'chatgpt_image_library',
  'Every image an account ever generated in ChatGPT, newest first, across ALL chats at once (no chat needs opening). Each item has fileId, title, conversationId, size and time. Pass the returned cursor to get the next page. Download one with chatgpt_download_image.',
  {
    account: z.string().optional().describe('Account (email or partition); default is the first account.'),
    limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20).'),
    cursor: z.string().optional().describe('cursor from the previous page.'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.imageLibrary', args))
)

server.tool(
  'chatgpt_search_chats',
  'Full-text search over ChatGPT chat titles and messages on every account, returning chatId, title and the matching snippet. Use the chatId with chatgpt_chat_read or chatgpt_ask.',
  {
    query: z.string().min(1).describe('Words to look for.'),
    account: z.string().optional().describe('Only this account.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 10).'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.searchChats', args))
)

server.tool(
  'chatgpt_download_image',
  'Save one ChatGPT image to disk and return its flowdesk-image:// link and file path. Use fileId and conversationId from chatgpt_image_library or chatgpt_chat_read.',
  {
    fileId: z.string().min(1).describe('fileId (file_… without the sediment:// prefix).'),
    conversationId: z.string().min(1).describe('Chat the image belongs to.'),
    account: z.string().optional().describe('Account that owns the chat.'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.downloadImage', args))
)

server.tool(
  'chatgpt_chat_update',
  'Rename and/or archive/unarchive a ChatGPT chat. Verified by reading the chat back. There is no delete.',
  {
    chatId: z.string().min(1).describe('Chat id from chatgpt_chats.'),
    title: z.string().optional().describe('New title.'),
    archived: z.boolean().optional().describe('true archives, false restores.'),
    account: z.string().optional().describe('Account that owns the chat (optional).'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.updateChat', args))
)

server.tool(
  'chatgpt_ask',
  'Send a message to ChatGPT and return the answer. Starts a NEW chat by default; pass chatId to continue an existing chat (it runs on the account that owns it). Without account, the first signed-in account answers and a limit or sign-out moves the message to the next. Different accounts run in parallel; one at a time per account.',
  {
    prompt: z.string().min(1).describe('The message to send.'),
    chatId: z.string().optional().describe('Continue this chat instead of starting a new one.'),
    account: z.string().optional().describe('Preferred account (email or partition).'),
    model: z.string().optional().describe('Model slug from chatgpt_models (default: ChatGPT auto).'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.ask', args))
)

server.tool(
  'chatgpt_models',
  'List the ChatGPT models an account can use (slug, title, description). Pass a slug as `model` to chatgpt_ask.',
  { account: z.string().optional().describe('Account (email or partition); default is the first account.') },
  async (args) => textResult(await callGatewayRpc('chatgpt.models', args))
)

server.tool(
  'chatgpt_image_accounts',
  'List every FlowDesk account for ChatGPT image generation: signed in or not, plan, images left today, when the limit resets, and whether it is parked after a limit refusal. Reads quota without generating anything.',
  { refresh: z.boolean().optional().describe('Re-read quota from ChatGPT (default true).') },
  async (args) => textResult(await callGatewayRpc('chatgpt.imageAccounts', args))
)

server.tool(
  'chatgpt_generate_image',
  'Generate images with ChatGPT through the signed-in accounts. Each image is its own job in a fresh "Create image" chat; jobs run in parallel across accounts (one at a time per account), and when an account hits its image limit the job moves to the next account automatically. Returns saved file paths and flowdesk-image:// links.',
  {
    prompt: z.string().min(1).describe('What to draw. Sent as-is in ChatGPT image mode.'),
    count: z.number().int().min(1).max(20).optional().describe('How many separate images (default 1).'),
    account: z.string().optional().describe('Preferred account (email or partition). Others are used when it is out of quota.'),
    wait: z.boolean().optional().describe('Wait for the images (default true). false returns job ids to read with chatgpt_image_jobs.'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.generateImage', args))
)

server.tool(
  'chatgpt_edit_image',
  'Edit an image with ChatGPT. A FlowDesk-generated image is edited inside its own conversation on the account that made it; any other image (or when that account is out of quota) is uploaded to a fresh chat on an account with quota left.',
  {
    image: z.string().min(1).describe('flowdesk-image:// link, saved file name, or an absolute local file path.'),
    prompt: z.string().min(1).describe('The change to make.'),
    count: z.number().int().min(1).max(10).optional().describe('How many variations (default 1).'),
    account: z.string().optional().describe('Preferred account (email or partition).'),
    wait: z.boolean().optional().describe('Wait for the result (default true).'),
  },
  async (args) => textResult(await callGatewayRpc('chatgpt.editImage', args))
)

server.tool(
  'chatgpt_image_jobs',
  'Status of ChatGPT image jobs (queued, running, done, failed) with their saved images. Omit jobId for the 50 newest.',
  { jobId: z.string().optional().describe('One job id from chatgpt_generate_image / chatgpt_edit_image.') },
  async (args) => textResult(await callGatewayRpc('chatgpt.imageJobs', args))
)

server.tool(
  'chatgpt_open_login',
  'Open a visible ChatGPT sign-in window on one account (partition from chatgpt_image_accounts) so the user can sign in once.',
  { partition: z.string().min(1).describe('Account partition, e.g. gmail-….') },
  async (args) => textResult(await callGatewayRpc('chatgpt.openLogin', args))
)

server.tool(
  'ask_claude',
  'Ask Claude (claude.ai) via the user\'s logged-in desktop browser session in FlowDesk.',
  { prompt: z.string().min(1).describe('The prompt or question to send to Claude.') },
  async (args) => textResult(await callGatewayRpc('ask.claude', args))
)

server.tool(
  'ask_gemini',
  'Ask Google Gemini via the user\'s logged-in desktop browser session in FlowDesk.',
  { prompt: z.string().min(1).describe('The prompt or question to send to Gemini.') },
  async (args) => textResult(await callGatewayRpc('ask.gemini', args))
)

server.tool(
  'ask_grok',
  'Ask xAI Grok via the user\'s logged-in desktop browser session in FlowDesk.',
  { prompt: z.string().min(1).describe('The prompt or question to send to Grok.') },
  async (args) => textResult(await callGatewayRpc('ask.grok', args))
)

server.tool(
  'ask_perplexity',
  'Ask Perplexity via the user\'s logged-in desktop browser session in FlowDesk. Source-backed web research.',
  { prompt: z.string().min(1).describe('The research query to send to Perplexity.') },
  async (args) => textResult(await callGatewayRpc('ask.perplexity', args))
)

// ── GOOGLE FLOW (Studio Media & Generations) ─────────────────────────────────

server.tool(
  'flow_list_projects',
  'List all Google Flow projects on one Google account (default account when omitted).',
  { account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'), },
  async (args) => textResult(await callGatewayRpc('flow.listProjects', args))
)

server.tool(
  'flow_create_project',
  'Create a new project in Google Flow.',
  { title: z.string().min(1).describe('Project title.'), account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'), },
  async (args) => textResult(await callGatewayRpc('flow.createProject', args))
)

server.tool(
  'flow_generate_image',
  'Generate an AI image in Google Flow (uses real Flow credits). Runs on the project\'s account; if that account is out of credits it moves to the next account with credits, into that account\'s "FlowDesk" project, and the result names the account and projectId it used.',
  {
    account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'),
    projectId: z.string().min(1).describe('Project ID where generation will occur.'),
    prompt: z.string().min(1).describe('Detailed prompt describing the image.'),
    aspectRatio: z.enum(['LANDSCAPE', 'PORTRAIT', 'SQUARE']).optional().describe('Aspect ratio.'),
  },
  async (args) => textResult(await callGatewayRpc('flow.generateImage', args))
)

server.tool(
  'flow_credits',
  'Check available Google Flow credits on one account (default account when omitted). flow_accounts lists every account.',
  { account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'), },
  async (args) => textResult(await callGatewayRpc('flow.credits', args))
)

server.tool(
  'flow_accounts',
  'Every Google account FlowDesk holds, with its Flow sign-in and credit balance. Generations fail over between these when one runs out of credits.',
  {},
  async () => textResult(await callGatewayRpc('flow.accounts'))
)

server.registerTool(
  'flow_media_status',
  {
    title: 'Google Flow Media Status & Player',
    description: 'Check status of a running media generation in Google Flow and display player preview.',
    inputSchema: {
      mediaId: z.string().min(1).describe('Media ID.'),
      account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/flow-studio.html',
      },
    },
  },
  async (args) => formatFlowVisual(await callGatewayRpc('flow.mediaStatus', args))
)

server.registerTool(
  'flow_generate_video',
  {
    title: 'Google Flow Video Generator',
    description: 'Generate an AI video from a text prompt in Google Flow (spends Flow credits). Fails over to the next account with credits like flow_generate_image; the result names the account and projectId used.',
    inputSchema: {
      account: z.string().optional().describe('Google account (email or partition from flow_accounts). Omit to use the project\'s own account, else the default.'),
      projectId: z.string().min(1).describe('Project ID.'),
      prompt: z.string().min(1).describe('Video scene prompt.'),
      modelKey: z.string().min(1).describe('Model key from flow_video_models (e.g. abra_t2v_8s).'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/flow-studio.html',
      },
    },
  },
  async (args) => formatFlowVisual(await callGatewayRpc('flow.generateVideo', args))
)

server.registerTool(
  'flow_generate_video_from_image',
  {
    title: 'Google Flow Image-to-Video Generator',
    description: 'Generate an AI video starting from an uploaded image in Google Flow.',
    inputSchema: {
      projectId: z.string().min(1).describe('Project ID.'),
      prompt: z.string().min(1).describe('How the image should animate.'),
      mediaId: z.string().min(1).describe('Image media ID in the project.'),
      modelKey: z.string().min(1).describe('Model key from flow_video_models (e.g. abra_r2v_10s).'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/flow-studio.html',
      },
    },
  },
  async (args) => formatFlowVisual(await callGatewayRpc('flow.generateVideoFromImage', args))
)

server.tool(
  'flow_extend_video',
  'Extend an existing Google Flow video scene.',
  {
    projectId: z.string().min(1).describe('Project ID.'),
    prompt: z.string().min(1).describe('Continuation prompt.'),
    sourceVideoId: z.string().min(1).describe('Source video ID to extend.'),
    sceneId: z.string().min(1).describe('Scene ID.'),
  },
  async (args) => textResult(await callGatewayRpc('flow.extendVideo', args))
)

server.tool(
  'flow_upload_image',
  'Upload a local image into a Google Flow project.',
  {
    projectId: z.string().min(1).describe('Target project ID.'),
    localFilePath: z.string().min(1).describe('Absolute path to the local image file.'),
  },
  async (args) => textResult(await callGatewayRpc('flow.uploadImage', args))
)

server.tool(
  'flow_download_media',
  'Download a Google Flow media file by its URL to disk.',
  {
    mediaUrl: z.string().min(1).describe('Media URL obtained from project listing.'),
  },
  async (args) => textResult(await callGatewayRpc('flow.downloadMedia', args))
)

server.tool(
  'flow_video_models',
  'List accepted Google Flow video model keys.',
  {},
  async () => textResult(await callGatewayRpc('flow.videoModels'))
)

// ── FLOWDESK BRAIN (Memory & Atlas Knowledge Graph) ──────────────────────────

server.tool(
  'brain_status',
  'Check FlowDesk Brain health, memory count, and vector index status.',
  {},
  async () => textResult(await callGatewayRpc('brain.status'))
)

server.registerTool(
  'brain_overview',
  {
    title: 'Brain Overview Atlas',
    description: 'Get an overview of the active Brain scope, candidates, and insights.',
    inputSchema: {
      scopeId: z.string().optional().describe('Scope ID to inspect.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/brain-atlas.html',
      },
    },
  },
  async (args) => formatBrainVisual(await callGatewayRpc('brain.overview', args))
)

server.registerTool(
  'brain_search',
  {
    title: 'Brain Semantic Search',
    description: 'Search semantic memories and knowledge graph in FlowDesk Brain.',
    inputSchema: {
      query: z.string().min(1).describe('Search query for semantic search.'),
      scopeId: z.string().optional().describe('Optional scope ID.'),
      limit: z.number().int().min(1).max(50).optional().describe('Result limit.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/brain-atlas.html',
      },
    },
  },
  async (args) => formatBrainVisual(await callGatewayRpc('brain.search', args))
)

server.tool(
  'brain_remember',
  'Store a new learned memory or fact into FlowDesk Brain.',
  {
    text: z.string().min(1).describe('Fact or insight text to remember.'),
    scopeId: z.string().optional().describe('Optional scope ID.'),
    kind: z.enum(['fact', 'preference', 'decision', 'goal', 'person', 'organization', 'opportunity', 'procedure', 'note']).optional().describe('Memory category.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.remember', args))
)

server.registerTool(
  'brain_list_memories',
  {
    title: 'Brain Memories List',
    description: 'List recent memories stored in the Brain.',
    inputSchema: {
      scopeId: z.string().optional().describe('Optional scope ID.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/brain-atlas.html',
      },
    },
  },
  async (args) => formatBrainVisual(await callGatewayRpc('brain.listMemories', args))
)

server.tool(
  'brain_answer_pack',
  'Get an assembled answer pack from FlowDesk local knowledge with relevant citations in a single call.',
  {
    question: z.string().min(1).describe('The question about user, projects, decisions or work.'),
    tokenBudget: z.number().int().min(200).max(4000).optional().describe('Max token budget for evidence passages.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.answerPack', args))
)

server.tool(
  'brain_read_document',
  'Read a knowledge markdown document from the Brain vault by relative path.',
  {
    path: z.string().min(1).describe('Vault-relative document path (e.g. "projects/demo.md").'),
    scopeId: z.string().optional().describe('Optional scope ID.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.readDocument', args))
)

server.tool(
  'brain_search_documents',
  'Search structured knowledge documents in the Brain vault.',
  {
    query: z.string().min(1).describe('Query to match documents against.'),
    scopeId: z.string().optional().describe('Optional scope ID.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max documents to return.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.searchDocuments', args))
)

server.tool(
  'brain_neighbors',
  'Fetch semantic graph neighbors and links for a knowledge document.',
  {
    path: z.string().min(1).describe('Vault-relative document path.'),
    depth: z.number().int().min(1).max(2).optional().describe('Graph traversal depth.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.neighbors', args))
)

server.tool(
  'brain_list_candidates',
  'List pending knowledge or memory candidates waiting for review.',
  { scopeId: z.string().optional().describe('Optional scope ID.') },
  async (args) => textResult(await callGatewayRpc('brain.listCandidates', args))
)

server.tool(
  'brain_decide_candidate',
  'Accept or reject a pending knowledge candidate.',
  {
    id: z.string().min(1).describe('Candidate ID.'),
    decision: z.enum(['accept', 'reject']).describe('Review decision.'),
    editedText: z.string().optional().describe('Optional edited text when accepting.'),
  },
  async (args) => textResult(await callGatewayRpc('brain.decideCandidate', args))
)

// ── META-TOOL TIER: SKILLS & WORKFLOW ENGINE (<250 TOKENS) ───────────────────

server.tool(
  'flowdesk_skills_list',
  'Discover available atomic skills and workflows in FlowDesk. Returns a token-efficient summary (<250 tokens) with ID, 1-line description, domain, and required tools. Filter by domain or keyword.',
  {
    domain: z.string().optional().describe('Filter by domain (e.g. "flow", "tiktok", "whatsapp", "linkedin", "brain", "testing", "design", "general").'),
    query: z.string().optional().describe('Search keyword in skill/workflow name or description.'),
  },
  async (args) => {
    const [skillsRaw, workflowsRaw] = await Promise.all([
      callGatewayRpc('skills.list', { domain: args.domain, query: args.query }),
      callGatewayRpc('workflows.list', { domain: args.domain }),
    ])

    const skills = Array.isArray(skillsRaw) ? skillsRaw : []
    let workflows = Array.isArray(workflowsRaw) ? workflowsRaw : []

    if (args.query) {
      const q = args.query.toLowerCase()
      workflows = workflows.filter(w =>
        (w.name && w.name.toLowerCase().includes(q)) ||
        (w.description && w.description.toLowerCase().includes(q)) ||
        (w.id && w.id.toLowerCase().includes(q))
      )
    }

    // Limit to keep response strictly <250 tokens
    const compactSkills = skills.slice(0, 10).map(s => ({
      id: s.id,
      type: 'skill',
      name: s.name,
      domain: s.domain,
      desc: s.description ? s.description.slice(0, 75) + (s.description.length > 75 ? '...' : '') : '',
      tools: s.tools && s.tools.length > 0 ? s.tools.slice(0, 3) : undefined,
    }))

    const compactWorkflows = workflows.slice(0, 5).map(w => ({
      id: w.id,
      type: 'workflow',
      name: w.name,
      domains: w.domains || [],
      desc: w.description ? w.description.slice(0, 75) + (w.description.length > 75 ? '...' : '') : '',
      steps: w.steps?.length || 0,
    }))

    return textResult({
      totalSkills: skills.length,
      totalWorkflows: workflows.length,
      items: [...compactSkills, ...compactWorkflows],
      note: 'Use flowdesk_skill_get with an id for full playbook and parameters.',
    })
  }
)

server.tool(
  'flowdesk_skill_get',
  'Fetch the complete markdown playbook, input parameter schemas, and best practices for an atomic skill or workflow.',
  {
    id: z.string().min(1).describe('The unique skill ID or workflow ID (e.g. "flow-video-director", "flowdesk-video-creator", "marketing-campaign").'),
  },
  async (args) => {
    // Check skills first
    const skill = await callGatewayRpc('skills.get', { id: args.id })
    if (skill) {
      return textResult(skill)
    }
    // Check workflows next
    const wf = await callGatewayRpc('workflows.get', { id: args.id })
    if (wf) {
      return textResult(wf)
    }
    throw new Error(`Skill or workflow "${args.id}" was not found in FlowDesk registry.`)
  }
)

server.registerTool(
  'flowdesk_workflow_run',
  {
    title: 'FlowDesk Workflow Runner',
    description: 'Triggers a multi-skill workflow in FlowDesk and returns step-by-step execution results.',
    inputSchema: {
      workflowId: z.string().min(1).describe('Unique ID of the workflow to run.'),
      inputs: z.record(z.any()).optional().describe('Input parameter values passed to the workflow execution.'),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://flowdesk/workflow-pipeline.html',
      },
    },
  },
  async (args) => {
    const res = await callGatewayRpc('workflows.run', { id: args.workflowId, inputs: args.inputs || {} })
    return formatWorkflowVisual(res)
  }
)

server.tool(
  'flowdesk_workflow_resume',
  'Resume a failed workflow run from the step that failed. Finished steps keep their results and are not run again (a rendered video is not re-rendered). Run ids come from flowdesk_workflow_run results.',
  { runId: z.string().min(1).describe('Id of the failed run.') },
  async (args) => formatWorkflowVisual(await callGatewayRpc('workflows.resume', { runId: args.runId }))
)

server.tool(
  'flowdesk_skill_save',
  'Allows external agents (Claude Code, Antigravity) to create or update an atomic skill directly in FlowDesk.',
  {
    skill: z.record(z.any()).describe('The atomic skill object (must include at least id, name, description, playbook).'),
  },
  async (args) => {
    const res = await callGatewayRpc('skills.save', { skill: args.skill })
    return textResult(res)
  }
)

server.tool(
  'flowdesk_workflow_save',
  'Allows external agents (Claude Code, Antigravity) to author or update multi-skill workflows in FlowDesk.',
  {
    workflow: z.record(z.any()).describe('The workflow object (must include id, name, description, steps).'),
  },
  async (args) => {
    const res = await callGatewayRpc('workflows.save', { workflow: args.workflow })
    return textResult(res)
  }
)

server.tool(
  'flowdesk_open_hud',
  'Pops open FlowDesk\'s native floating desktop HUD widget window on Windows desktop. Floats over your IDE or ChatGPT, showing live responsive dashboards for TikTok Outliers, Google Flow Studio, WhatsApp, or Social Radar.',
  {
    app: z.enum(['tiktok', 'flow', 'whatsapp', 'social', 'workflow', 'brain']).optional().describe('The dashboard app to load in the HUD (default: tiktok).'),
    alwaysOnTop: z.boolean().optional().describe('Whether the HUD window should stay pinned floating above all other windows (default: true).'),
  },
  async (args) => {
    const res = await callGatewayRpc('hud.open', args)
    return textResult({
      ok: true,
      message: `✨ FlowDesk Native Floating HUD Widget popped open on your Windows desktop with [${args.app || 'tiktok'}].`,
      result: res,
    })
  }
)

server.tool(
  'flowdesk_close_hud',
  'Closes the native floating HUD widget window on desktop.',
  {},
  async () => {
    const res = await callGatewayRpc('hud.close')
    return textResult({ ok: true, message: 'FlowDesk HUD Widget closed.', result: res })
  }
)

// ── AGENT TOOL PARITY ────────────────────────────────────────────────────────
// Mirror every in-app agent tool (LinkedIn, WhatsApp, Facebook) that has no
// hand-written wrapper above. Skipped silently when FlowDesk is not running.
async function registerGatewayAgentTools() {
  const cfg = findGatewayConfig()
  if (!cfg || !cfg.port || !cfg.token) return
  let tools
  try {
    tools = await Promise.race([
      callGatewayRpc('tools.list'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tools.list timeout')), 3000)),
    ])
  } catch {
    return
  }
  if (!Array.isArray(tools)) return
  const existing = new Set(Object.keys(server._registeredTools ?? {}))
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || existing.has(t.name)) continue
    let shape = {}
    try {
      const schema = z.fromJSONSchema(t.inputSchema ?? { type: 'object', properties: {} })
      shape = schema && schema.shape ? schema.shape : {}
    } catch {
      shape = {}
    }
    const name = t.name
    server.registerTool(
      name,
      { description: String(t.description ?? ''), inputSchema: shape },
      async (args) => {
        const out = await callGatewayRpc('tools.call', { name, args: args ?? {} })
        const content = Array.isArray(out) ? out : out?.content
        return {
          content: Array.isArray(content) ? content : [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          ...(out?.isError ? { isError: true } : {}),
        }
      }
    )
    existing.add(name)
  }
}

await registerGatewayAgentTools()

const transport = new StdioServerTransport()
await server.connect(transport)
