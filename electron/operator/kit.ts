/**
 * The operator kit (docs/brain-v3-plan.md §7): a folder outside the FlowDesk
 * code where the user opens Claude for day-to-day work. Claude there gets the
 * FlowDesk MCP server and the user's AGENTS.md rules, and is not allowed to
 * edit files or run shell commands, so a failing tool gets reported instead of
 * "fixed" by changing code.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { McpServerEntry } from '../mcpConfig'

export const KIT_README = `# FlowDesk operator folder

Is folder mein Claude kholo aur kaam karwao (pins, posts, research). Pehli baar Claude
"trust this folder?" aur "flowdesk MCP server?" poochega, dono ko Yes karo. Yahan Claude:
- sirf FlowDesk ke tools chala sakta hai (FlowDesk app chalu honi chahiye);
- koi file badal nahi sakta, terminal command nahi chala sakta;
- har session \`brain_start\` se shuru aur \`brain_wrap\` par khatam karta hai.

Agar koi tool toot jaye to Claude report banata hai: FlowDesk → Settings → About → Export reports.

Qaide badalne hain to FlowDesk → Brain → Rules mein AGENTS.md edit karo, phir is folder ko
Settings → About → "Create operator folder" se dobara banao.
`

export type KitFiles = Record<string, string>

export function kitFiles(input: { agentsMd: string; claudeMd: string; mcpEntry: McpServerEntry }): KitFiles {
  return {
    'AGENTS.md': input.agentsMd,
    'CLAUDE.md': input.claudeMd,
    'README.md': KIT_README,
    '.mcp.json': `${JSON.stringify({ mcpServers: { flowdesk: input.mcpEntry } }, null, 2)}\n`,
    '.claude/settings.json': `${JSON.stringify({
      enabledMcpjsonServers: ['flowdesk'],
      permissions: {
        allow: ['mcp__flowdesk'],
        deny: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'],
      },
    }, null, 2)}\n`,
  }
}

/**
 * Writes the kit into `dir`. Refuses a folder that looks like a code project
 * (a package.json or .git): the point is a folder with no code in it, and
 * denying edits inside a project would surprise the user.
 */
export function writeKit(dir: string, files: KitFiles): string[] {
  if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, '.git'))) {
    throw new Error('This folder holds a code project; choose an empty folder for the operator kit')
  }
  const written: string[] = []
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target) && readFileSync(target, 'utf8') === text) continue
    writeFileSync(target, text)
    written.push(rel)
  }
  return written
}
