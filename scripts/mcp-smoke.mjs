#!/usr/bin/env node
/**
 * Live smoke test for the FlowDesk MCP server, end to end:
 * MCP stdio → bin/flowdesk-mcp.mjs → local gateway → running app → page.
 *
 * Spawns its own copy of the MCP server, so an edit to bin/flowdesk-mcp.mjs
 * is exercised without restarting whatever MCP client is attached to it.
 * Calls read-only tools only; write tools are listed as skipped.
 *
 *   node scripts/mcp-smoke.mjs                 # every read-only tool
 *   node scripts/mcp-smoke.mjs reddit linkedin # only tools with these prefixes
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Arguments for read tools that need one. Anything absent here is called with {}.
const ARGS = {
  pinterest_user: { username: 'pinterest' },
  pinterest_user_boards: { username: 'pinterest', limit: 3 },
  pinterest_user_pins: { username: 'pinterest', limit: 3 },
  pinterest_board_pins: { boardUrl: '/pinterest/girls-night-in/', limit: 3 },
  pinterest_pin: { pinId: '424605071145711021' },
  pinterest_related_pins: { pinId: '424605071145711021', limit: 3 },
  pinterest_suggest: { term: 'minimal logo' },
  pinterest_outlier: { username: 'pinterest', limit: 20 },
  whatsapp_list_chats: { limit: 3 },
  whatsapp_api_chats: { limit: 3 },
  whatsapp_unread: { limit: 3 },
  linkedin_feed: { limit: 3 },
  linkedin_api_feed: { limit: 3 },
  linkedin_search: { query: 'AI agents', limit: 3 },
  linkedin_outlier: { limit: 10 },
  reddit_feed: { subreddit: 'LocalLLaMA', limit: 3 },
  reddit_api_feed: { subreddit: 'LocalLLaMA', limit: 3 },
  reddit_search: { query: 'mcp server', limit: 3 },
  reddit_api_search: { query: 'mcp server', limit: 3 },
  reddit_outlier: { subreddit: 'LocalLLaMA' },
  tiktok_api_search: { query: 'ai tools', limit: 3 },
  tiktok_search: { query: 'ai tools', limit: 3 },
  tiktok_suggest: { seed: 'ai tools' },
  tiktok_feed: { limit: 3 },
  tiktok_api_creator_feed: { creator: 'openai', limit: 3 },
  tiktok_api_outlier: { creator: 'openai' },
  tiktok_outlier: { creator: 'openai' },
  tiktok_api_batch_outliers: { creators: ['openai'] },
  brain_search: { query: 'flowdesk', limit: 3 },
  brain_search_documents: { query: 'flowdesk', limit: 3 },
  brain_list_memories: { limit: 3 },
  brain_list_candidates: { limit: 3 },
  flowdesk_skills_list: {},
}

// Anything that changes state somewhere, or needs an id only a prior call yields.
const SKIP = /(_send|_create|_delete|_vote|_subscribe|_mark_read|_update|_upload|_submit|_switch|_remember|_decide|_save|_run|_generate|_extend|_download|warmup|open_hud|close_hud|^ask_|_list_messages|_api_messages|_post_comments|_api_comments|_video_detail|_read_document|_neighbors|_answer_pack|_media_status|_skill_get|_create_project)/

const prefixes = process.argv.slice(2)
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin', 'flowdesk-mcp.mjs')] })
const client = new Client({ name: 'flowdesk-smoke', version: '1.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
const rows = []
for (const tool of tools) {
  if (prefixes.length && !prefixes.some(p => tool.name.startsWith(p))) continue
  // Also skip anything whose required inputs this script has no value for:
  // those are writes or id-driven reads, covered by CHAINS below.
  const required = tool.inputSchema?.required ?? []
  if (SKIP.test(tool.name) || required.some(k => !(k in (ARGS[tool.name] ?? {})))) { rows.push({ tool: tool.name, result: 'skip (write/needs id)' }); continue }
  const started = Date.now()
  try {
    const res = await client.callTool({ name: tool.name, arguments: ARGS[tool.name] ?? {} }, undefined, { timeout: 180_000 })
    const text = (res.content ?? []).map(c => c.text ?? '').join('\n')
    const failed = res.isError || /"ok":\s*false/.test(text)
    rows.push({ tool: tool.name, result: failed ? 'FAIL' : 'ok', ms: Date.now() - started, detail: failed ? text.replace(/\s+/g, ' ').slice(0, 160) : '' })
  } catch (e) {
    rows.push({ tool: tool.name, result: 'FAIL', ms: Date.now() - started, detail: String(e?.message ?? e).slice(0, 160) })
  }
}
// Read tools that need an id: take it from a first call, then call the tool.
async function payload(name, args) {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })
  const texts = (res.content ?? []).map(c => c.text ?? '')
  for (const t of texts.reverse()) { try { return JSON.parse(t) } catch {} }
  return null
}
const CHAINS = [
  ['whatsapp_list_messages', async () => ({ chatId: (await payload('whatsapp_api_chats', { limit: 1 }))?.chats?.[0]?.id, limit: 3 })],
  ['whatsapp_api_messages', async () => ({ chatId: (await payload('whatsapp_api_chats', { limit: 1 }))?.chats?.[0]?.id, limit: 3 })],
  ['reddit_post_comments', async () => { const p = (await payload('reddit_api_feed', { subreddit: 'LocalLLaMA', limit: 1 }))?.items?.[0]; return { subreddit: 'LocalLLaMA', postId: p?.id } }],
  ['reddit_api_comments', async () => ({ postId: (await payload('reddit_api_feed', { subreddit: 'LocalLLaMA', limit: 1 }))?.items?.[0]?.id })],
  ['tiktok_api_video_detail', async () => { const v = await payload('tiktok_api_search', { query: 'ai tools', limit: 1 }); const it = v?.items?.[0] ?? v?.videos?.[0] ?? v?.results?.[0]; return { url: String(it?.url ?? it?.link ?? it?.videoUrl ?? it?.id ?? '') } }],
  ['brain_read_document', async () => { const d = await payload('brain_search_documents', { query: 'flowdesk', limit: 1 }); const hit = Array.isArray(d) ? d[0] : d?.results?.[0]; return { path: hit?.path } }],
]
for (const [name, argsFor] of CHAINS) {
  if (prefixes.length && !prefixes.some(p => name.startsWith(p))) continue
  const started = Date.now()
  try {
    const args = await argsFor()
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })
    const text = (res.content ?? []).map(c => c.text ?? '').join('\n')
    const failed = res.isError || /"ok":\s*false/.test(text)
    rows.push({ tool: `${name} (chained)`, result: failed ? 'FAIL' : 'ok', ms: Date.now() - started, detail: failed ? `${JSON.stringify(args)} → ${text.replace(/\s+/g, ' ').slice(0, 140)}` : '' })
  } catch (e) {
    rows.push({ tool: `${name} (chained)`, result: 'FAIL', ms: Date.now() - started, detail: String(e?.message ?? e).slice(0, 160) })
  }
}

await client.close()

console.table(rows)
const failed = rows.filter(r => r.result === 'FAIL').length
console.log(`${tools.length} tools listed, ${rows.filter(r => r.result === 'ok').length} ok, ${failed} failed`)
process.exit(failed ? 1 : 0)
