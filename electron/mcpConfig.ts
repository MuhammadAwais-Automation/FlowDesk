import { join } from 'node:path'

export interface McpServerEntry { command: string; args: string[]; env?: Record<string, string> }

/**
 * The `flowdesk` entry an MCP client (Claude Code's .mcp.json, Claude Desktop)
 * needs to start FlowDesk's MCP server. The installed app runs its bundled
 * copy with its own exe as Node, so no Node install or repo is needed.
 */
export function mcpServerEntry(o: { packaged: boolean; execPath: string; resourcesPath: string; appPath: string }): McpServerEntry {
  if (o.packaged) return { command: o.execPath, args: [join(o.resourcesPath, 'mcp', 'flowdesk-mcp.mjs')], env: { ELECTRON_RUN_AS_NODE: '1' } }
  return { command: 'node', args: [join(o.appPath, 'bin', 'flowdesk-mcp.mjs')] }
}
