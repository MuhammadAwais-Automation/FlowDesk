import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from './service'

const roots: string[] = []

interface UtilityResponse {
  id?: string
  ok?: boolean
  result?: unknown
  error?: { message?: string }
}

function runBuiltUtility(databasePath: string) {
  const utilityEntryPath = resolve(process.cwd(), 'out', 'main', 'brainUtility.js')
  expect(existsSync(utilityEntryPath)).toBe(true)

  const harnessPath = join(dirname(databasePath), 'brain-utility-harness.cjs')
  mkdirSync(dirname(harnessPath), { recursive: true })
  writeFileSync(harnessPath, `
const { app, utilityProcess } = require('electron')
const [utilityEntryPath, databasePath] = process.argv.slice(2)
app.whenReady().then(() => {
  const child = utilityProcess.fork(utilityEntryPath, [databasePath], { serviceName: 'FlowDesk Brain Smoke' })
  child.on('message', message => {
    process.stdout.write('BRAIN_SMOKE:' + JSON.stringify(message) + '\\n')
    if (message.id === 'status') child.postMessage({ id: 'shutdown', method: 'shutdown', payload: {} })
    if (message.id === 'shutdown') child.kill()
  })
  child.on('exit', () => app.quit())
  child.postMessage({ id: 'status', method: 'status', payload: {} })
})
`)

  const electronPath = resolve(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
  return new Promise<UtilityResponse[]>((resolveRun, reject) => {
    const child = spawn(electronPath, [harnessPath, utilityEntryPath, databasePath], {
      windowsHide: true,
      // Editor terminals (VS Code) set this, which makes electron.exe a plain Node and require('electron') fail.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    })
    const responses: UtilityResponse[] = []
    let stderr = ''
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('BRAIN_SMOKE:')) continue
        responses.push(JSON.parse(line.slice('BRAIN_SMOKE:'.length)) as UtilityResponse)
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveRun(responses)
      else reject(new Error(`Built Brain utility exited with code ${code}: ${stderr}`))
    })
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Brain runtime smoke', () => {
  it('starts with FTS5 and reopens its user data database', () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'flowdesk-brain-runtime-'))
    roots.push(userDataRoot)
    const databasePath = join(userDataRoot, 'brain', 'brain.sqlite')

    const first = new BrainService(databasePath)
    expect(first.handle({ id: 'first-status', method: 'status', payload: {} })).toMatchObject({ ready: true, fts5: true })
    expect(first.handle({ id: 'first-shutdown', method: 'shutdown', payload: {} })).toEqual({ closed: true })

    const reopened = new BrainService(databasePath)
    expect(reopened.handle({ id: 'reopened-status', method: 'status', payload: {} })).toMatchObject({ ready: true, fts5: true })
    reopened.close()
  })

  it('runs the built utility entry through Electron and reopens its database', async () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'flowdesk-brain-utility-runtime-'))
    roots.push(userDataRoot)
    const databasePath = join(userDataRoot, 'brain', 'brain.sqlite')

    const firstRun = await runBuiltUtility(databasePath)
    expect(firstRun).toEqual([
      { id: 'status', ok: true, result: expect.objectContaining({ ready: true, fts5: true }) },
      { id: 'shutdown', ok: true, result: { closed: true } },
    ])

    const reopenedRun = await runBuiltUtility(databasePath)
    expect(reopenedRun).toEqual([
      { id: 'status', ok: true, result: expect.objectContaining({ ready: true, fts5: true }) },
      { id: 'shutdown', ok: true, result: { closed: true } },
    ])
  }, 60_000) // Electron boot is slow while the full suite runs in parallel
})
