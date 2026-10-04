import { describe, expect, it, vi, afterEach } from 'vitest'
import { startLocalGateway, type GatewayServer } from './localGateway'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../reddit', () => ({
  rdStatus: vi.fn(async () => ({ ok: true, signedIn: true, username: 'TestUser', totalKarma: 42 })),
  rdFeed: vi.fn(async () => ({ ok: true, count: 1, posts: [] })),
  rdPostComments: vi.fn(async () => ({ ok: true })),
  rdSearch: vi.fn(async () => ({ ok: true })),
  rdVotePost: vi.fn(async () => ({ ok: true })),
  rdVoteComment: vi.fn(async () => ({ ok: true })),
  rdCreateComment: vi.fn(async () => ({ ok: true, created: true })),
  rdCreatePost: vi.fn(async () => ({ ok: true })),
  rdSubscribe: vi.fn(async () => ({ ok: true })),
  rdMarkRead: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../whatsapp', () => ({
  waStatus: vi.fn(async () => ({ ok: true, signedIn: true })),
  waListChats: vi.fn(async () => ({ ok: true, chats: [] })),
  waListMessages: vi.fn(async () => ({ ok: true, messages: [] })),
  waSend: vi.fn(async () => ({ ok: true, sent: true })),
  waUnreadWithMessages: vi.fn(async () => ({ ok: true, unread: [] })),
}))

vi.mock('../linkedin', () => ({
  liStatus: vi.fn(async () => ({ ok: true, signedIn: true })),
  liFeed: vi.fn(async () => ({ ok: true, updates: [] })),
  liPostComments: vi.fn(async () => ({ ok: true })),
  liSearch: vi.fn(async () => ({ ok: true })),
  liSend: vi.fn(async () => ({ ok: true })),
  liMarkRead: vi.fn(async () => ({ ok: true })),
  liListChats: vi.fn(async () => ({ ok: true })),
  liListMessages: vi.fn(async () => ({ ok: true })),
  liUnread: vi.fn(async () => ({ ok: true })),
}))

const fakeToolHandler = vi.fn(async (args: Record<string, unknown>) => ({ content: [{ type: 'text', text: `echo:${String(args.text)}` }] }))

vi.mock('../agent/linkedinTools', async () => {
  const { z } = await import('zod')
  return {
    createLinkedInTools: () => [{
      name: 'linkedin_fake_tool',
      description: 'A fake LinkedIn tool',
      inputSchema: { text: z.string().describe('Text to echo'), limit: z.number().int().optional() },
      handler: fakeToolHandler,
    }],
  }
})
vi.mock('../agent/whatsappTools', () => ({ createWhatsAppTools: () => [] }))
vi.mock('../agent/facebookTools', () => ({ createFacebookTools: () => [] }))

async function rpc(port: number, token: string, method: string, params: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  })
  return { status: res.status, json: await res.json() }
}

describe('localGateway server', () => {
  let server: GatewayServer | null = null
  const testUserData = join(tmpdir(), 'flowdesk-test-' + Math.random().toString(36).slice(2))
  // Keep the suite off the real ~/.flowdesk/gateway.json the running app uses.
  process.env.FLOWDESK_HOME = testUserData

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('starts on loopback, responds to /health unauthenticated, and enforces auth on /rpc', async () => {
    server = await startLocalGateway(testUserData, 0)
    const { port, token } = server.info
    expect(port).toBeGreaterThan(0)
    expect(token).toBeDefined()

    // 1. Health check (unauthenticated)
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`)
    expect(healthRes.status).toBe(200)
    const healthJson = await healthRes.json()
    expect(healthJson.ok).toBe(true)
    expect(healthJson.app).toBe('flowdesk')

    // 2. Unauthorized access to /status
    const unauthStatus = await fetch(`http://127.0.0.1:${port}/status`)
    expect(unauthStatus.status).toBe(401)

    // 3. Authorized access to /status
    const authStatus = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(authStatus.status).toBe(200)
    const statusJson = await authStatus.json()
    expect(statusJson.ok).toBe(true)
    expect(statusJson.providers.reddit.username).toBe('TestUser')

    // 4. Authorized RPC invocation
    const rpcRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: 'reddit.createComment', params: { postId: 't3_1', text: 'hi' } }),
    })
    expect(rpcRes.status).toBe(200)
    const rpcJson = await rpcRes.json()
    expect(rpcJson.ok).toBe(true)
    // 5. Test Brain and Flow RPC dispatches
    const flowRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: 'flow.listProjects', params: {} }),
    })
    expect(flowRes.status).toBe(200)

    const brainRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: 'brain.status', params: {} }),
    })
    expect(brainRes.status).toBe(200)
  })

  it('stops cleanly and removes discovery files', async () => {
    server = await startLocalGateway(testUserData, 0)
    const gatewayFile = join(testUserData, 'gateway.json')
    expect(existsSync(gatewayFile)).toBe(true)

    await server.stop()
    server = null
    expect(existsSync(gatewayFile)).toBe(false)
  })

  it('blocks cross-origin preflight requests from untrusted origins', async () => {
    server = await startLocalGateway(testUserData, 0)
    const { port } = server.info

    // 1. Untrusted origin OPTIONS preflight
    const evilPreflight = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://malicious-website.com' },
    })
    expect(evilPreflight.status).toBe(403)
    expect(evilPreflight.headers.get('access-control-allow-origin')).toBeNull()

    // 2. Loopback origin OPTIONS preflight
    const localPreflight = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:3000' },
    })
    expect(localPreflight.status).toBe(204)
    expect(localPreflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3000')
  })

  it('handles skills & workflow engine RPC endpoints', async () => {
    server = await startLocalGateway(testUserData, 0)
    const { port, token } = server.info

    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ method, params }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      return data.result
    }

    // 1. skills.save
    const testSkill = {
      id: 'test-agent-skill',
      name: 'Test Agent Skill',
      version: '1.0.0',
      domain: 'general',
      description: 'A test skill for gateway validation',
      tools: ['reddit.feed'],
      inputs: {},
      playbook: '# Test Playbook\nRun step 1.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const saveRes = await rpc('skills.save', { skill: testSkill })
    expect(saveRes.ok).toBe(true)
    expect(saveRes.id).toBe('test-agent-skill')

    // 2. skills.get
    const getRes = await rpc('skills.get', { id: 'test-agent-skill' })
    expect(getRes).toBeTruthy()
    expect(getRes.name).toBe('Test Agent Skill')
    expect(getRes.playbook).toContain('Test Playbook')

    // 3. skills.list
    const listRes = await rpc('skills.list', {})
    expect(Array.isArray(listRes)).toBe(true)
    expect(listRes.some((s: any) => s.id === 'test-agent-skill')).toBe(true)

    // 4. workflows.save
    const testWorkflow = {
      id: 'test-agent-workflow',
      name: 'Test Agent Workflow',
      version: '1.0.0',
      description: 'A test multi-skill workflow',
      domains: ['general'],
      skills: ['test-agent-skill'],
      steps: [
        {
          id: 'step-1',
          title: 'Run Reddit Feed',
          skillId: 'test-agent-skill',
          actionTool: 'reddit.feed',
          params: { limit: 2 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const saveWfRes = await rpc('workflows.save', { workflow: testWorkflow })
    expect(saveWfRes.ok).toBe(true)
    expect(saveWfRes.id).toBe('test-agent-workflow')

    // 5. workflows.get
    const getWfRes = await rpc('workflows.get', { id: 'test-agent-workflow' })
    expect(getWfRes).toBeTruthy()
    expect(getWfRes.name).toBe('Test Agent Workflow')

    // 6. workflows.list
    const listWfRes = await rpc('workflows.list', {})
    expect(Array.isArray(listWfRes)).toBe(true)
    expect(listWfRes.some((w: any) => w.id === 'test-agent-workflow')).toBe(true)

    // 7. workflows.run
    const runWfRes = await rpc('workflows.run', { id: 'test-agent-workflow' })
    expect(runWfRes.status).toBe('completed')
    expect(runWfRes.stepResults['step-1']).toBeDefined()
    expect(runWfRes.stepResults['step-1'].status).toBe('completed')

    // 8. workflows.runs
    const runsRes = await rpc('workflows.runs', { workflowId: 'test-agent-workflow' })
    expect(Array.isArray(runsRes)).toBe(true)
    expect(runsRes.length).toBeGreaterThan(0)
    expect(runsRes[0].workflowId).toBe('test-agent-workflow')

    // 9. skills.delete
    const delRes = await rpc('skills.delete', { id: 'test-agent-skill' })
    expect(delRes.ok).toBe(true)
    const getDeleted = await rpc('skills.get', { id: 'test-agent-skill' })
    expect(getDeleted).toBeNull()
  })
  it('lists agent tools with JSON schemas and calls them through tools.call', async () => {
    server = await startLocalGateway(testUserData, 0)
    const { port, token } = server.info

    const list = await rpc(port, token, 'tools.list', {})
    expect(list.status).toBe(200)
    const fake = list.json.result.find((t: { name: string }) => t.name === 'linkedin_fake_tool')
    expect(fake.description).toBe('A fake LinkedIn tool')
    expect(fake.inputSchema.type).toBe('object')
    expect(fake.inputSchema.properties.text.type).toBe('string')
    expect(fake.inputSchema.required).toEqual(['text'])

    const call = await rpc(port, token, 'tools.call', { name: 'linkedin_fake_tool', args: { text: 'hi' } })
    expect(call.status).toBe(200)
    expect(call.json.result).toEqual({ content: [{ type: 'text', text: 'echo:hi' }], isError: false })
    expect(fakeToolHandler).toHaveBeenCalledWith({ text: 'hi' }, expect.anything())
  })

  it('rejects unknown tool names and invalid tool arguments', async () => {
    server = await startLocalGateway(testUserData, 0)
    const { port, token } = server.info

    const unknown = await rpc(port, token, 'tools.call', { name: 'nope_tool', args: {} })
    expect(unknown.json.ok).toBe(false)
    expect(unknown.json.error).toMatch(/Unknown tool/)

    const invalid = await rpc(port, token, 'tools.call', { name: 'linkedin_fake_tool', args: { text: 5 } })
    expect(invalid.json.ok).toBe(false)
  })
})
