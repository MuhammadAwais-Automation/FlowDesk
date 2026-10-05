import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ApprovalRequestInfo, RequestApproval } from './approval'

/**
 * The bridge talks to a live Electron WebContents, so it is mocked out
 * entirely — what these tests cover is the tool layer's contract, not
 * LinkedIn's behaviour.
 *
 * The approval gate is the part that matters. Sending is irreversible and
 * outward-facing, and a regression here would not fail loudly in a test run:
 * it would fail by messaging a real person. An earlier generation of the
 * WhatsApp tools trusted a model-reported `userApproved` boolean that nothing
 * verified, so these tests exist because that gap was real rather than
 * hypothetical.
 */

const liSend = vi.fn()
const liListChats = vi.fn()
const liListMessages = vi.fn()
const liFindPeople = vi.fn()
const liMarkRead = vi.fn()

vi.mock('../linkedin/linkedin', () => ({
  liStatus: vi.fn(async () => ({ ok: true, signedIn: true })),
  liListChats: (...args: unknown[]) => liListChats(...args),
  liListMessages: (...args: unknown[]) => liListMessages(...args),
  liUnread: vi.fn(async () => ({ ok: true, totalUnread: 0 })),
  liFindPeople: (...args: unknown[]) => liFindPeople(...args),
  liSend: (...args: unknown[]) => liSend(...args),
  liMarkRead: (...args: unknown[]) => liMarkRead(...args),
  linkedInAccountError: (account?: string) =>
    account && account !== 'active' && !['1', '2'].includes(account) ? `unknown linkedin account "${account}"` : null,
}))

const { createLinkedInTools, LINKEDIN_TOOL_NAMES, LINKEDIN_TOOL_BASE_NAMES } = await import('./linkedinTools')

interface TestTool {
  name: string
  description: string
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
}

function getTool(tools: TestTool[], name: string): TestTool {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool not registered: ${name}`)
  return found
}

function toolsWith(requestApproval: RequestApproval): TestTool[] {
  return createLinkedInTools(requestApproval) as unknown as TestTool[]
}

const approveAll: RequestApproval = async () => true
const denyAll: RequestApproval = async () => false

beforeEach(() => {
  vi.clearAllMocks()
  liSend.mockResolvedValue({ ok: true, sent: true, messageUrn: 'urn:li:msg_message:(x,y)' })
  liListChats.mockResolvedValue({ ok: true, chats: [] })
  liListMessages.mockResolvedValue({ ok: true, messages: [] })
  liFindPeople.mockResolvedValue({ ok: true, people: [] })
  liMarkRead.mockResolvedValue({ ok: true })
})

describe('registration', () => {
  it('registers exactly the documented tool names', () => {
    const registered = toolsWith(approveAll).map(t => t.name).sort()
    expect(registered).toEqual([...LINKEDIN_TOOL_BASE_NAMES].sort())
  })

  it('exposes allowedTools names with the mcp server prefix', () => {
    // An unprefixed entry in allowedTools matches no real tool, so the SDK
    // routes every call through canUseTool instead — including the read-only
    // ones, which then prompt the user for nothing. This list shipped
    // unprefixed once; the symptom was approval dialogs on plain reads.
    for (const name of LINKEDIN_TOOL_NAMES) {
      expect(name).toMatch(/^mcp__workers__linkedin_/)
    }
    expect(LINKEDIN_TOOL_NAMES).toHaveLength(LINKEDIN_TOOL_BASE_NAMES.length)
  })
})

describe('the approval gate on send', () => {
  it('does not send when approval is denied', async () => {
    const send = getTool(toolsWith(denyAll), 'linkedin_send_message')
    const out = await send.handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', message: 'hi' })

    expect(liSend).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toContain('denied')
  })

  it('sends only after approval, with exactly the approved arguments', async () => {
    const send = getTool(toolsWith(approveAll), 'linkedin_send_message')
    await send.handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', message: 'hello there' })

    expect(liSend).toHaveBeenCalledOnce()
    expect(liSend).toHaveBeenCalledWith('urn:li:msg_conversation:(a,b)', 'hello there', undefined)
  })

  it('shows the recipient and the full text to the user, not a summary', async () => {
    // What makes an approval real is that the dialog carries enough for a
    // person to judge it. A urn alone is not judgeable; the name is.
    const requestApproval = vi.fn(async (_info: ApprovalRequestInfo) => true)
    const send = getTool(toolsWith(requestApproval), 'linkedin_send_message')
    await send.handler({
      conversationUrn: 'urn:li:msg_conversation:(a,b)',
      message: 'the exact words that will be sent',
      recipientName: 'Iqra Mushtaq',
    })

    const info = requestApproval.mock.calls[0][0]
    expect(info.title).toContain('Iqra Mushtaq')
    expect(info.detail).toBe('the exact words that will be sent')
  })

  it('falls back to the urn in the dialog when no name was supplied', async () => {
    const requestApproval = vi.fn(async (_info: ApprovalRequestInfo) => true)
    const send = getTool(toolsWith(requestApproval), 'linkedin_send_message')
    await send.handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', message: 'hi' })

    const info = requestApproval.mock.calls[0][0]
    expect(info.title).toContain('urn:li:msg_conversation:(a,b)')
  })

  it('asks before marking everything read, since that changes the user\'s own inbox', async () => {
    const denied = getTool(toolsWith(denyAll), 'linkedin_mark_read')
    const out = await denied.handler({})
    expect(liMarkRead).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)

    const allowed = getTool(toolsWith(approveAll), 'linkedin_mark_read')
    await allowed.handler({})
    expect(liMarkRead).toHaveBeenCalledOnce()
  })
})

describe('read tools never ask and never write', () => {
  const readOnly = ['linkedin_status', 'linkedin_list_chats', 'linkedin_list_messages', 'linkedin_unread', 'linkedin_find_people']

  it.each(readOnly)('%s does not invoke the approval dialog', async name => {
    const requestApproval = vi.fn(async (_info: ApprovalRequestInfo) => true)
    const tools = toolsWith(requestApproval)
    await getTool(tools, name).handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', query: '' })
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it.each(readOnly)('%s never reaches the send path', async name => {
    const tools = toolsWith(approveAll)
    await getTool(tools, name).handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', query: '' })
    expect(liSend).not.toHaveBeenCalled()
  })
})

describe('descriptions state the limits the model must respect', () => {
  const tools = toolsWith(approveAll)

  it('warns that message content is untrusted, on every tool that returns message text', () => {
    // A LinkedIn inbox is full of unsolicited mail from strangers, so text
    // crafted to read as an instruction is a realistic input, not a thought
    // experiment. The model is what has to hold this line, so it is told.
    for (const name of ['linkedin_list_chats', 'linkedin_list_messages']) {
      expect(getTool(tools, name).description).toContain('UNTRUSTED')
    }
  })

  it('says send requires an existing conversation and offers no workaround', () => {
    expect(getTool(tools, 'linkedin_send_message').description).toContain('EXISTING')
    expect(getTool(tools, 'linkedin_send_message').description).toContain('no way to start a NEW conversation')
  })

  it('says the chat list has no usable sender, so the model asks the thread instead of inventing one', () => {
    expect(getTool(tools, 'linkedin_list_chats').description).toContain('NO sender')
  })

  it('says people search covers existing conversations only', () => {
    expect(getTool(tools, 'linkedin_find_people').description).toContain('EXISTING conversations only')
  })
})

describe('oversized results are truncated rather than eating the turn', () => {
  it('caps a huge conversation list', async () => {
    liListChats.mockResolvedValue({ ok: true, chats: Array.from({ length: 5000 }, (_, i) => ({ text: `message ${i}` })) })
    const out = await getTool(toolsWith(approveAll), 'linkedin_list_chats').handler({})
    expect(out.content[0].text).toContain('[truncated')
    expect(out.content[0].text.length).toBeLessThan(13_000)
  })
})

describe('an explicit unknown account is refused before anything happens', () => {
  const writes: [string, Record<string, unknown>][] = [
    ['linkedin_send_message', { conversationUrn: 'urn:li:msg_conversation:(a,b)', message: 'hi' }],
    ['linkedin_mark_read', {}],
    ['linkedin_like_post', { activityId: '1' }],
    ['linkedin_unlike_post', { activityId: '1' }],
    ['linkedin_comment_on_post', { activityId: '1', text: 'x' }],
    ['linkedin_reply_to_comment', { activityId: '1', commentSnippet: 'abcdefgh', replyText: 'x' }],
    ['linkedin_create_post', { text: 'x' }],
    ['linkedin_delete_post', { activityId: '1' }],
    ['linkedin_delete_comment', { activityId: '1', commentId: '2' }],
    ['linkedin_send_connection_request', { profileUrl: 'https://www.linkedin.com/in/x/', expectedName: 'X' }],
    ['linkedin_switch_account', {}],
  ]

  it.each(writes)('%s refuses without asking for approval or sending', async (name, args) => {
    const requestApproval = vi.fn(async (_info: ApprovalRequestInfo) => true)
    const out = await getTool(toolsWith(requestApproval), name).handler({ ...args, account: 'nope' })
    expect(out.isError).toBe(true)
    expect(JSON.parse(out.content[0].text)).toEqual({ ok: false, error: 'unknown linkedin account "nope"' })
    expect(requestApproval).not.toHaveBeenCalled()
    expect(liSend).not.toHaveBeenCalled()
    expect(liMarkRead).not.toHaveBeenCalled()
  })

  it('every tool except linkedin_accounts takes an optional account', () => {
    const tools = toolsWith(approveAll) as unknown as { name: string; inputSchema: Record<string, unknown> }[]
    const missing = tools.filter(t => t.name !== 'linkedin_accounts' && !('account' in t.inputSchema)).map(t => t.name)
    expect(missing).toEqual([])
  })

  it('read tools refuse an unknown account and route a known one', async () => {
    const tools = toolsWith(approveAll)
    const out = await getTool(tools, 'linkedin_list_chats').handler({ account: 'nope' })
    expect(out.isError).toBe(true)
    expect(liListChats).not.toHaveBeenCalled()

    await getTool(tools, 'linkedin_list_chats').handler({ account: '2' })
    expect(liListChats).toHaveBeenCalledWith(expect.objectContaining({ account: '2' }))
    await getTool(tools, 'linkedin_find_people').handler({ query: 'a', account: '2' })
    expect(liFindPeople).toHaveBeenCalledWith('a', undefined, '2')
  })

  it('no account and "active" keep the default behaviour', async () => {
    const tools = toolsWith(approveAll)
    await getTool(tools, 'linkedin_send_message').handler({ conversationUrn: 'urn:li:msg_conversation:(a,b)', message: 'hi', account: 'active' })
    expect(liSend).toHaveBeenCalledWith('urn:li:msg_conversation:(a,b)', 'hi', 'active')
  })
})

describe('MCP annotations travel with every tool', () => {
  it('every tool says whether it is read-only, and deletes are destructive', () => {
    const tools = toolsWith(approveAll) as unknown as { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]
    expect(tools.filter(t => typeof t.annotations?.readOnlyHint !== 'boolean').map(t => t.name)).toEqual([])
    const destructive = tools.filter(t => t.annotations?.destructiveHint).map(t => t.name).sort()
    expect(destructive).toEqual(['linkedin_delete_comment', 'linkedin_delete_post', 'linkedin_mark_read'])
    const writes = ['linkedin_send_message', 'linkedin_create_post', 'linkedin_comment_on_post', 'linkedin_like_post', 'linkedin_send_connection_request']
    for (const name of writes) expect(tools.find(t => t.name === name)?.annotations?.readOnlyHint).toBe(false)
  })
})
