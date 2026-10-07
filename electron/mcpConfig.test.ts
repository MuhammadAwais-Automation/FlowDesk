import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpServerEntry } from './mcpConfig'

describe('mcpServerEntry', () => {
  it('runs the bundled server with the installed exe as Node', () => {
    expect(mcpServerEntry({ packaged: true, execPath: 'C:/FD/FlowDesk.exe', resourcesPath: 'C:/FD/resources', appPath: 'C:/FD/resources/app.asar' })).toEqual({
      command: 'C:/FD/FlowDesk.exe',
      args: [join('C:/FD/resources', 'mcp', 'flowdesk-mcp.mjs')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('runs the repo script with node in development', () => {
    expect(mcpServerEntry({ packaged: false, execPath: 'electron.exe', resourcesPath: 'x', appPath: 'E:/FlowDesk' })).toEqual({
      command: 'node',
      args: [join('E:/FlowDesk', 'bin', 'flowdesk-mcp.mjs')],
    })
  })
})
