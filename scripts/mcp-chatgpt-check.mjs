#!/usr/bin/env node
/**
 * MCP-level check of the ChatGPT tools: spawns bin/flowdesk-mcp.mjs over stdio,
 * lists the chatgpt tools with their annotations, calls two read-only tools,
 * and confirms a failing call comes back with isError (MCP spec). Read-only.
 *
 *   node scripts/mcp-chatgpt-check.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = new Client({ name: 'chatgpt-check', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin', 'flowdesk-mcp.mjs')], stderr: 'inherit' }))

const { tools } = await client.listTools()
const gpt = tools.filter(t => /chatgpt/.test(t.name))
console.log(`${tools.length} tools, ${gpt.length} ChatGPT:`)
for (const t of gpt) console.log(` ${t.name.padEnd(24)} readOnly=${t.annotations?.readOnlyHint ?? '-'} destructive=${t.annotations?.destructiveHint ?? '-'}`)

let failed = 0
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) failed++ }

const models = await client.callTool({ name: 'chatgpt_models', arguments: {} })
check('chatgpt_models answers without isError', !models.isError && /"slug"/.test(models.content[0].text))
const chats = await client.callTool({ name: 'chatgpt_chats', arguments: { limit: 2 } })
check('chatgpt_chats answers without isError', !chats.isError && /"chats"/.test(chats.content[0].text))
const bad = await client.callTool({ name: 'chatgpt_chat_read', arguments: { chatId: '00000000-0000-0000-0000-000000000000' } })
check('a chat that does not exist comes back with isError', bad.isError === true)
const badArgs = await client.callTool({ name: 'chatgpt_ask', arguments: {} }).catch(e => ({ isError: true, thrown: String(e) }))
check('missing required argument is rejected', badArgs.isError === true)

await client.close()
process.exit(failed ? 1 : 0)
