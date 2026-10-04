#!/usr/bin/env node
/**
 * MCP-level check of the Google Flow tools: spawns bin/flowdesk-mcp.mjs over
 * stdio and exercises the read tools plus the guard that rejects a model family
 * as a generation key. Spends nothing. Optional: pass mediaIds to read their status.
 *
 *   node scripts/mcp-flow-check.mjs [mediaId ...]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = new Client({ name: 'flow-check', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin', 'flowdesk-mcp.mjs')], stderr: 'inherit' }))
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  let data = null
  try { data = JSON.parse(r.content.at(-1).text) } catch { data = r.content.at(-1)?.text }
  return { isError: !!r.isError, data }
}
let failed = 0
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`); if (!cond) failed++ }

const { tools } = await client.listTools()
const flow = tools.filter(t => t.name.startsWith('flow_'))
console.log(`${flow.length} Flow tools: ${flow.map(t => t.name).join(', ')}`)
check('flow_generate_image no longer offers aspectRatio', !('aspectRatio' in (flow.find(t => t.name === 'flow_generate_image')?.inputSchema?.properties ?? {})))

const acc = await call('flow_accounts')
check('flow_accounts', !acc.isError && Array.isArray(acc.data.accounts), (acc.data.accounts || []).map(a => `${a.account}:${a.credits}`).join(' '))
const models = await call('flow_video_models')
check('flow_video_models gives verified keys', !models.isError && models.data.verifiedModelKeys?.textToVideo?.length > 0, JSON.stringify(models.data.verifiedModelKeys))
const projects = await call('flow_list_projects')
check('flow_list_projects', !projects.isError && projects.data.count > 0, `${projects.data.count} projects`)
const pid = projects.data.projects?.[0]?.projectId
const media = await call('flow_list_project_media', { projectId: pid })
check('flow_list_project_media', !media.isError && Array.isArray(media.data.media), `${media.data.count} items`)
const fam = await call('flow_generate_video', { projectId: pid, prompt: 'x', modelKey: 'veo_3_1_lite' })
check('a model family as modelKey is refused before spending (isError)', fam.isError && /model family/.test(JSON.stringify(fam.data)))
for (const id of process.argv.slice(2)) {
  const s = await call('flow_media_status', { mediaId: id })
  const d = s.data
  check(`flow_media_status ${id.slice(0, 8)}`, !s.isError && d.done === true, `${d.kind} ${d.status}`)
}
await client.close()
process.exit(failed ? 1 : 0)
