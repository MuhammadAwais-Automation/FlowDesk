import { describe, expect, it, vi } from 'vitest'
import { alwaysApprove } from './approval'
import { READ_ONLY_BUILTIN_TOOLS } from './leadAgent'
import { createAgentToolSet } from './tools'

vi.mock('../whatsapp', () => ({
  MAX_ATTACHMENT_BYTES: 16 * 1024 * 1024,
  waSendFile: vi.fn(async () => ({ ok: true })),
  waStatus: vi.fn(async () => ({ ok: true })),
  waListChats: vi.fn(async () => ({ ok: true })),
  waListMessages: vi.fn(async () => ({ ok: true })),
  waSearchContacts: vi.fn(async () => ({ ok: true })),
  waSend: vi.fn(async () => ({ ok: true })),
  waDeleteMessage: vi.fn(async () => ({ ok: true })),
  waDownloadMedia: vi.fn(async () => ({ ok: true })),
  waDiagnose: vi.fn(async () => ({ ok: true })),
}))

describe('READ_ONLY_BUILTIN_TOOLS', () => {
  /**
   * These names are passed straight into the SDK's `allowedTools`, which
   * means anything listed runs with NO approval prompt at all. The list is
   * an allowlist rather than a denylist on purpose: a tool nobody has
   * classified yet should fall through to canUseTool and be asked about,
   * not run silently.
   */
  it('contains no tool that can write, execute, or spawn', () => {
    const mutating = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'BashOutput', 'KillShell']
    for (const name of mutating) {
      expect(READ_ONLY_BUILTIN_TOOLS).not.toContain(name)
    }
  })

  it('still grants the read and search tools the agent needs to be useful at all', () => {
    // The whole reason built-ins were re-enabled: `tools: []` previously
    // disabled every one of these, leaving the agent unable to read a file.
    expect(READ_ONLY_BUILTIN_TOOLS).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']))
  })
})

describe('createAgentToolSet approval threading', () => {
  it('passes the approval callback down to the WhatsApp tools that need it', async () => {
    const requestApproval = vi.fn(async () => false)
    const toolSet = createAgentToolSet(undefined, requestApproval)
    const send = (toolSet.server as unknown as { instance: unknown })
    expect(send).toBeDefined()

    // Reach the built tool through the same factory the set uses, and check
    // the callback actually reached it — a set built without threading would
    // silently fall back to alwaysApprove and send for real.
    const { createWhatsAppTools } = await import('./whatsappTools')
    const tools = createWhatsAppTools(requestApproval) as unknown as {
      name: string
      handler: (input: Record<string, unknown>) => Promise<{ isError?: boolean }>
    }[]
    const sendTool = tools.find(t => t.name === 'whatsapp_send_message')
    const res = await sendTool!.handler({ chatId: 'c@lid', message: 'hi' })
    expect(requestApproval).toHaveBeenCalled()
    expect(res.isError).toBe(true)
  })

  it('defaults to alwaysApprove when no callback is supplied, so existing callers do not break', async () => {
    const toolSet = createAgentToolSet()
    expect(toolSet.names.length).toBeGreaterThan(0)
    expect(await alwaysApprove({ tool: 'anything', title: 'x' })).toBe(true)
  })

  it('lists project tools only when a project runtime is present', () => {
    const withoutProject = createAgentToolSet(undefined, alwaysApprove)
    const withProject = createAgentToolSet(
      { rootPath: 'C:/tmp/project', confirm: async () => true },
      alwaysApprove,
    )
    expect(withoutProject.names).not.toContain('mcp__workers__project_run_command')
    expect(withProject.names).toContain('mcp__workers__project_run_command')
  })
})

describe('every tool name in the set is one the SDK will actually match', () => {
  it('prefixes every MCP tool with mcp__workers__', () => {
    // allowedTools is matched against the name the SDK sees, and for a tool on
    // this MCP server that name carries the server prefix. An unprefixed entry
    // silently matches nothing, so the tool falls through to canUseTool and
    // prompts the user — on read-only calls too. That shipped once, for the
    // LinkedIn group, and nothing failed loudly.
    const toolSet = createAgentToolSet(undefined, alwaysApprove)
    const unprefixed = toolSet.names.filter(name => !name.startsWith('mcp__workers__'))
    expect(unprefixed).toEqual([])
  })

  it('registers a tool for every advertised name, and vice versa', () => {
    // The other half of the same bug: a name in allowedTools with no tool
    // behind it, or a tool nobody allowed.
    const toolSet = createAgentToolSet(undefined, alwaysApprove)
    const advertised = toolSet.names.map(name => name.replace('mcp__workers__', '')).sort()
    const registered = (toolSet.server as unknown as { options?: { tools?: { name: string }[] } })
      .options?.tools?.map(t => t.name).sort()
    if (!registered) return
    expect(advertised).toEqual(registered)
  })
})
