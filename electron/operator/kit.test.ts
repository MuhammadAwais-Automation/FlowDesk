import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kitFiles, writeKit } from './kit'

const files = () => kitFiles({ agentsMd: '# AGENTS.md\nrules', claudeMd: '# FlowDesk operator\nread AGENTS.md', mcpEntry: { command: 'C:/FD/FlowDesk.exe', args: ['C:/FD/resources/mcp/flowdesk-mcp.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } } })

describe('operator kit', () => {
  it('writes the rules, the MCP config and settings that deny file edits and shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-'))
    expect(writeKit(dir, files()).sort()).toEqual(['.claude/settings.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'README.md'])
    expect(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers.flowdesk.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.enabledMcpjsonServers).toEqual(['flowdesk'])
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']))
    expect(writeKit(dir, files())).toEqual([])
  })

  it('refuses a folder that holds a code project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(() => writeKit(dir, files())).toThrow(/code project/)
    const git = mkdtempSync(join(tmpdir(), 'kit-'))
    mkdirSync(join(git, '.git'))
    expect(() => writeKit(git, files())).toThrow(/code project/)
  })
})
