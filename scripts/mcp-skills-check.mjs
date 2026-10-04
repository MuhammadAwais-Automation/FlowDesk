#!/usr/bin/env node
/**
 * Checks what a fresh MCP client is told: the server instructions on connect,
 * and the chatgpt / google-flow skills through flowdesk_skill_get. Read-only.
 *
 *   node scripts/mcp-skills-check.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = new Client({ name: 'skills-check', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin', 'flowdesk-mcp.mjs')], stderr: 'inherit' }))
let failed = 0
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`); if (!cond) failed++ }

const instructions = client.getInstructions() ?? ''
check('server instructions point to both skills', /"chatgpt"/.test(instructions) && /"google-flow"/.test(instructions), `${instructions.length} chars`)
for (const id of ['chatgpt', 'google-flow']) {
  const r = await client.callTool({ name: 'flowdesk_skill_get', arguments: { id } })
  const text = r.content.map(c => c.text).join('\n')
  check(`flowdesk_skill_get ${id}`, !r.isError && /## Which tool for which job/.test(text), `${text.length} chars`)
}
const list = await client.callTool({ name: 'flowdesk_skills_list', arguments: {} })
const names = list.content.map(c => c.text).join('\n')
check('flowdesk_skills_list shows the new skills and not the removed ones', /google-flow/.test(names) && /\bchatgpt\b/.test(names) && !/flow-video-director|chatgpt-image-studio|flow-image-artist/.test(names))
await client.close()
process.exit(failed ? 1 : 0)
