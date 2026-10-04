import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { RequestApproval } from './approval'

/**
 * The bridge talks to a live Electron WebContents, so it is mocked out
 * entirely — what these tests are about is the tool layer's own contract,
 * not WhatsApp's behaviour.
 *
 * The approval gate is the piece worth locking down: sending and deleting
 * are irreversible and outward-facing, and during development a single name
 * lookup returned two different ids for the same person. An earlier version
 * of these tools trusted a model-reported `userApproved: true` boolean,
 * which nothing actually verified — these tests exist because that gap was
 * real, not hypothetical, and a regression here would not fail loudly in a
 * test run, it would fail by messaging or deleting something for real.
 */

const waSend = vi.fn()
const waListChats = vi.fn()
const waDeleteMessage = vi.fn()
const waDownloadMedia = vi.fn()
const waDiagnose = vi.fn()
const waSendFile = vi.fn()

vi.mock('../whatsapp/whatsapp', () => ({
  MAX_ATTACHMENT_BYTES: 16 * 1024 * 1024,
  waSendFile: (...args: unknown[]) => waSendFile(...args),
  waStatus: vi.fn(async () => ({ ok: true })),
  waListChats: (...args: unknown[]) => waListChats(...args),
  waListMessages: vi.fn(async () => ({ ok: true })),
  waSearchContacts: vi.fn(async () => ({ ok: true })),
  waSend: (...args: unknown[]) => waSend(...args),
  waDeleteMessage: (...args: unknown[]) => waDeleteMessage(...args),
  waDownloadMedia: (...args: unknown[]) => waDownloadMedia(...args),
  waDiagnose: (...args: unknown[]) => waDiagnose(...args),
}))

const { createWhatsAppTools, WHATSAPP_TOOL_NAMES } = await import('./whatsappTools')

interface TestTool {
  name: string
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
}

function getTool(tools: TestTool[], name: string): TestTool {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool not registered: ${name}`)
  return found
}

function toolsWith(requestApproval: RequestApproval): TestTool[] {
  return createWhatsAppTools(requestApproval) as unknown as TestTool[]
}

beforeEach(() => {
  waSend.mockReset()
  waListChats.mockReset()
  waDeleteMessage.mockReset()
  waDownloadMedia.mockReset()
  waDiagnose.mockReset()
  waSend.mockResolvedValue({ ok: true })
  waDeleteMessage.mockResolvedValue({ ok: true })
  waDownloadMedia.mockResolvedValue({ ok: true, path: 'C:/tmp/x.ogg' })
  waDiagnose.mockResolvedValue({ ok: true, status: {} })
  waListChats.mockResolvedValue({ ok: true, chats: [] })
})

describe('whatsapp_send_message approval gate', () => {
  it('does not send when the approval callback denies', async () => {
    const requestApproval = vi.fn(async () => false)
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_message')
    const res = await send.handler({ chatId: '123@lid', message: 'hi' })
    expect(waSend).not.toHaveBeenCalled()
    expect(res.isError).toBe(true)
  })

  it('asks for approval with the real recipient and message text, not a model-reported flag', async () => {
    const requestApproval = vi.fn(async () => true)
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_message')
    await send.handler({ chatId: '65339874390087@lid', message: 'Asslam.o.alikum' })
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'whatsapp_send_message',
        detail: 'Asslam.o.alikum',
        input: { chatId: '65339874390087@lid', message: 'Asslam.o.alikum' },
      }),
    )
    expect(waSend).toHaveBeenCalledWith('65339874390087@lid', 'Asslam.o.alikum')
  })

  it('sends without any userApproved-style parameter from the model', async () => {
    // The old exploitable pattern: a model could set userApproved: true
    // itself, with nothing verifying that a real confirmation happened. The
    // call below carries only chatId/message — no such flag — and approval
    // is still enforced (asserted above), because it now comes from the
    // requestApproval callback rather than anything the model reports.
    const requestApproval = vi.fn(async () => true)
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_message')
    await send.handler({ chatId: '123@lid', message: 'hi' })
    expect(requestApproval).toHaveBeenCalled()
  })
})

describe('whatsapp_send_file approval gate', () => {
  /**
   * Sending a file is less recoverable than sending text: the recipient gets a
   * copy immediately, and the wrong file can carry anything that happened to be
   * on disk. The approval has to name the PATH, not just the file name — two
   * different report.pdf files are indistinguishable by name alone.
   */
  it('does not send when the approval callback denies', async () => {
    const requestApproval = vi.fn(async () => false)
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_file')

    const out = await send.handler({ chatId: '123@lid', filePath: 'C:/files/report.pdf' })

    expect(waSendFile).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
  })

  it('shows the full path and the caption, not just the file name', async () => {
    const requestApproval = vi.fn(async () => true)
    waSendFile.mockResolvedValue({ ok: true })
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_file')

    await send.handler({ chatId: '123@lid', filePath: 'C:/files/report.pdf', caption: 'here you go' })

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'whatsapp_send_file',
        title: expect.stringContaining('123@lid'),
        detail: expect.stringContaining('C:/files/report.pdf'),
      }),
    )
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('here you go') }),
    )
  })

  it('passes the arguments through unchanged once approved', async () => {
    const requestApproval = vi.fn(async () => true)
    waSendFile.mockResolvedValue({ ok: true })
    const send = getTool(toolsWith(requestApproval), 'whatsapp_send_file')

    await send.handler({ chatId: '123@lid', filePath: 'C:/a.png', caption: 'x', asDocument: true })

    expect(waSendFile).toHaveBeenCalledWith('123@lid', 'C:/a.png', 'x', true)
  })

  it('is not marked read-only, so it can never be auto-allowed', async () => {
    // readOnlyHint is what puts a tool on the no-prompt path. A send that got
    // that annotation by accident would deliver files with no dialog at all.
    const tools = toolsWith(vi.fn(async () => true)) as unknown as { name: string; annotations?: { readOnlyHint?: boolean } }[]
    const send = tools.find(t => t.name === 'whatsapp_send_file')
    expect(send?.annotations?.readOnlyHint).not.toBe(true)
  })
})

describe('whatsapp_delete_message approval gate', () => {
  it('does not delete when the approval callback denies', async () => {
    const requestApproval = vi.fn(async () => false)
    const del = getTool(toolsWith(requestApproval), 'whatsapp_delete_message')
    const res = await del.handler({ chatId: 'c@lid', msgId: 'M1', forEveryone: true })
    expect(waDeleteMessage).not.toHaveBeenCalled()
    expect(res.isError).toBe(true)
  })

  it('passes the mode through unchanged once approved', async () => {
    const requestApproval = vi.fn(async () => true)
    const del = getTool(toolsWith(requestApproval), 'whatsapp_delete_message')
    await del.handler({ chatId: 'c@lid', msgId: 'M1', forEveryone: true })
    expect(waDeleteMessage).toHaveBeenCalledWith('c@lid', 'M1', true)
  })

  it('does not silently upgrade a delete-for-me into a delete-for-everyone', async () => {
    const requestApproval = vi.fn(async () => true)
    const del = getTool(toolsWith(requestApproval), 'whatsapp_delete_message')
    await del.handler({ chatId: 'c@lid', msgId: 'M1', forEveryone: false })
    expect(waDeleteMessage).toHaveBeenCalledWith('c@lid', 'M1', false)
  })

  it('shows a different title for forEveryone vs this-account-only, so the dialog cannot mislead the user', async () => {
    const requestApproval = vi.fn(async () => true)
    const del = getTool(toolsWith(requestApproval), 'whatsapp_delete_message')
    await del.handler({ chatId: 'c@lid', msgId: 'M1', forEveryone: true })
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('everyone') }))
    requestApproval.mockClear()
    await del.handler({ chatId: 'c@lid', msgId: 'M1', forEveryone: false })
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('this account only') }))
  })
})

describe('whatsapp_download_media', () => {
  it('needs no approval — it only reads, and writes to the local downloads folder', async () => {
    const requestApproval = vi.fn(async () => true)
    const dl = getTool(toolsWith(requestApproval), 'whatsapp_download_media')
    const res = await dl.handler({ chatId: 'c@lid', msgId: 'M1' })
    expect(requestApproval).not.toHaveBeenCalled()
    expect(waDownloadMedia).toHaveBeenCalledWith('c@lid', 'M1')
    expect(res.content[0].text).toContain('x.ogg')
  })
})

describe('whatsapp_unread', () => {
  it('asks the bridge for unread chats only, rather than filtering after the fact', async () => {
    const tools = toolsWith(vi.fn(async () => true))
    await getTool(tools, 'whatsapp_unread').handler({ limit: 5 })
    expect(waListChats).toHaveBeenCalledWith(5, true)
  })

  it('leaves whatsapp_list_chats unfiltered', async () => {
    const tools = toolsWith(vi.fn(async () => true))
    await getTool(tools, 'whatsapp_list_chats').handler({ limit: 5 })
    expect(waListChats).toHaveBeenCalledWith(5)
  })
})

describe('tool result bounding', () => {
  it('truncates an oversized result instead of returning it whole', async () => {
    waListChats.mockResolvedValue({ ok: true, chats: Array.from({ length: 5000 }, (_, i) => ({ id: `${i}@lid`, name: `Chat number ${i}` })) })
    const tools = toolsWith(vi.fn(async () => true))
    const res = await getTool(tools, 'whatsapp_list_chats').handler({})
    expect(res.content[0].text).toContain('[truncated')
    expect(res.content[0].text.length).toBeLessThan(13_000)
  })
})

describe('whatsapp_diagnose', () => {
  it('is registered, so a failure can be investigated without restarting the app', async () => {
    const tools = toolsWith(vi.fn(async () => true))
    await getTool(tools, 'whatsapp_diagnose').handler({})
    expect(waDiagnose).toHaveBeenCalled()
  })
})

describe('registration', () => {
  it('exposes every tool under the workers MCP namespace', () => {
    const tools = toolsWith(vi.fn(async () => true))
    expect(WHATSAPP_TOOL_NAMES).toContain('mcp__workers__whatsapp_send_message')
    expect(WHATSAPP_TOOL_NAMES).toHaveLength(tools.length)
  })
})
