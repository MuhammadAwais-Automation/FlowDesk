import { describe, expect, it, vi, afterEach } from 'vitest'
import { startLocalGateway, type GatewayServer } from './localGateway'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execAsync = promisify(exec)

vi.mock('../reddit', () => ({
  rdStatus: vi.fn(async () => ({ ok: true })),
  rdFeed: vi.fn(async () => ({ ok: true, posts: [] })),
  rdPostComments: vi.fn(async () => ({ ok: true })),
  rdSearch: vi.fn(async () => ({ ok: true })),
  rdVotePost: vi.fn(async () => ({ ok: true })),
  rdVoteComment: vi.fn(async () => ({ ok: true })),
  rdCreateComment: vi.fn(async () => ({ ok: true })),
  rdCreatePost: vi.fn(async () => ({ ok: true })),
  rdSubscribe: vi.fn(async () => ({ ok: true })),
  rdMarkRead: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../whatsapp', () => ({
  waStatus: vi.fn(async () => ({ ok: true })),
  waListChats: vi.fn(async () => ({ ok: true, chats: [] })),
  waListMessages: vi.fn(async () => ({ ok: true, messages: [] })),
  waSend: vi.fn(async () => ({ ok: true })),
  waUnreadWithMessages: vi.fn(async () => ({ ok: true, unread: [] })),
}))

vi.mock('../linkedin', () => ({
  liStatus: vi.fn(async () => ({ ok: true })),
  liFeed: vi.fn(async () => ({ ok: true, updates: [] })),
  liPostComments: vi.fn(async () => ({ ok: true })),
  liSearch: vi.fn(async () => ({ ok: true })),
  liSend: vi.fn(async () => ({ ok: true })),
  liMarkRead: vi.fn(async () => ({ ok: true })),
  liListChats: vi.fn(async () => ({ ok: true })),
  liListMessages: vi.fn(async () => ({ ok: true })),
  liUnread: vi.fn(async () => ({ ok: true })),
}))

// Keep the suite off the real ~/.flowdesk/gateway.json the running app uses.
process.env.FLOWDESK_HOME = require('node:os').tmpdir() + '/flowdesk-skills-test'

describe('Skills & Workflow Engine Integration', () => {
  let server: GatewayServer | null = null
  const testUserData = join(tmpdir(), 'flowdesk-skills-test-' + Math.random().toString(36).slice(2))

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('runs CLI commands against live gateway', async () => {
    server = await startLocalGateway(testUserData, 0)
    expect(server.info.port).toBeGreaterThan(0)

    // Save a custom test skill first
    const token = server.info.token
    const saveRes = await fetch(`http://127.0.0.1:${server.info.port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        method: 'skills.save',
        params: {
          skill: {
            id: 'campaign-director',
            name: 'Campaign Director',
            version: '1.0.0',
            domain: 'flow',
            description: 'Directs end-to-end video campaigns',
            tools: ['flow.generateVideo'],
            playbook: '# Campaign Director Playbook\nStep 1: define script.',
          },
        },
      }),
    })
    const saveJson = await saveRes.json()
    expect(saveJson.ok).toBe(true)

    // Also save a test workflow
    const saveWfRes = await fetch(`http://127.0.0.1:${server.info.port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        method: 'workflows.save',
        params: {
          workflow: {
            id: 'quick-video-launch',
            name: 'Quick Video Launch',
            version: '1.0.0',
            description: 'Automated video launch workflow',
            domains: ['flow'],
            skills: ['campaign-director'],
            steps: [
              {
                id: 'gen-script',
                title: 'Generate Script',
                skillId: 'campaign-director',
                params: { topic: 'AI Agent' },
              },
            ],
          },
        },
      }),
    })
    const saveWfJson = await saveWfRes.json()
    expect(saveWfJson.ok).toBe(true)

    // Now test CLI: flowdesk skills list
    const cliEnv = { ...process.env, FLOWDESK_GATEWAY_CONFIG: join(testUserData, 'gateway.json') }
    const { stdout: skillsListOutput } = await execAsync('node ./bin/flowdesk-cli.mjs skills list', { env: cliEnv })
    expect(skillsListOutput).toContain('FlowDesk Skills Registry')
    expect(skillsListOutput).toContain('campaign-director')

    // Test CLI: flowdesk skills get campaign-director
    const { stdout: skillGetOutput } = await execAsync('node ./bin/flowdesk-cli.mjs skills get campaign-director', { env: cliEnv })
    expect(skillGetOutput).toContain('Campaign Director')
    expect(skillGetOutput).toContain('Playbook')

    // Test CLI: flowdesk workflow list
    const { stdout: wfListOutput } = await execAsync('node ./bin/flowdesk-cli.mjs workflow list', { env: cliEnv })
    expect(wfListOutput).toContain('FlowDesk Workflows')
    expect(wfListOutput).toContain('quick-video-launch')

    // Test CLI: flowdesk workflow run quick-video-launch
    const { stdout: wfRunOutput } = await execAsync('node ./bin/flowdesk-cli.mjs workflow run quick-video-launch', { env: cliEnv })
    expect(wfRunOutput).toContain('Starting workflow "quick-video-launch"')
    expect(wfRunOutput).toContain('COMPLETED')
  })
})
