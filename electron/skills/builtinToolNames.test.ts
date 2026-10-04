import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './skillRegistry'

/**
 * Every tool a built-in skill names, and every tool a built-in workflow step
 * calls, must exist. Stale names are how flow-video-director came to list five
 * `studio_flow_*` tools that no longer existed, and how two workflows
 * "published" through a `tiktok.publishVideo` that was never written.
 *
 * Read from source on purpose: the gateway and the MCP server cannot be
 * imported into a unit test (Electron, stdio), and the names are literals.
 */
const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const rpc = new Set([...read('electron/gateway/localGateway.ts').matchAll(/^\s+'([a-z]+\.[a-zA-Z]+)':/gm)].map(m => m[1]))
const mcp = new Set([...read('bin/flowdesk-mcp.mjs').matchAll(/server\.(?:tool|registerTool)\(\s*'([a-z_]+)'/g)].map(m => m[1]))
const agentDir = 'electron/agent'
const agent = new Set(
  readdirSync(join(root, agentDir))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap(f => [...read(`${agentDir}/${f}`).matchAll(/tool\(\s*'([a-z_]+)'/g)].map(m => m[1])),
)

const builtins = 'electron/skills/builtins'
const files = readdirSync(join(root, builtins)).filter(f => f.endsWith('.json'))
const skillFolders = readdirSync(join(root, builtins), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, builtins, entry.name, 'SKILL.md')))
  .map(entry => entry.name)

describe('built-in skills and workflows name real tools', () => {
  it('found the tool registries it checks against', () => {
    expect(rpc.size).toBeGreaterThan(50)
    expect(mcp.size).toBeGreaterThan(50)
    expect(agent.size).toBeGreaterThan(20)
  })

  for (const f of files) {
    const def = JSON.parse(read(`${builtins}/${f}`)) as { tools?: string[]; steps?: { id: string; actionTool?: string }[] }

    it(`${f}: every listed tool exists`, () => {
      const missing = (def.tools ?? []).filter(t => !rpc.has(t) && !mcp.has(t) && !agent.has(t))
      expect(missing).toEqual([])
    })

    if (def.steps) {
      it(`${f}: every step calls a gateway method`, () => {
        const missing = def.steps!.map(s => s.actionTool).filter((t): t is string => !!t && !rpc.has(t))
        expect(missing).toEqual([])
      })
    }
  }

  for (const id of skillFolders) {
    const { attributes } = parseFrontmatter(read(`${builtins}/${id}/SKILL.md`))

    it(`${id}/SKILL.md: has valid identity and description`, () => {
      expect(attributes.name).toBe(id)
      expect(typeof attributes.description).toBe('string')
      expect(attributes.description.trim().length).toBeGreaterThan(0)
      expect(attributes.description.length).toBeLessThanOrEqual(300)
    })

    it(`${id}/SKILL.md: every listed tool exists`, () => {
      expect(Array.isArray(attributes.tools)).toBe(true)
      const missing = (attributes.tools as unknown[])
        .filter((tool): tool is string => typeof tool === 'string')
        .filter(tool => !rpc.has(tool) && !mcp.has(tool) && !agent.has(tool))
      expect(missing).toEqual([])
    })
  }
})
