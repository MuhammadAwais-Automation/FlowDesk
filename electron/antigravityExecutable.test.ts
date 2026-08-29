import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * The bug this guards against: the previous version only checked hand-guessed
 * install locations and never found a real Antigravity install (verified: on a
 * real machine with `agy` on PATH and working, every guessed path was wrong).
 * PATH resolution is what actually tracks where the installer put the binary,
 * so it is the mechanism under test here — not another guessed path.
 */

const execFileSync = vi.fn()
vi.mock('node:child_process', () => ({ execFileSync: (...args: unknown[]) => execFileSync(...args) }))

const existsSync = vi.fn()
vi.mock('node:fs', () => ({ existsSync: (...args: unknown[]) => existsSync(...args) }))

const { getAntigravityExecutablePath } = await import('./antigravityExecutable')

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.ANTIGRAVITY_PATH
  delete process.env.AGY_PATH
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('PATH resolution is the primary mechanism', () => {
  it('uses the path where/which resolves, when it exists', () => {
    execFileSync.mockReturnValue('C:\\Users\\ethic\\AppData\\Local\\agy\\bin\\agy.exe\r\n')
    existsSync.mockReturnValue(true)

    expect(getAntigravityExecutablePath()).toBe('C:\\Users\\ethic\\AppData\\Local\\agy\\bin\\agy.exe')
  })

  it('takes the first line when where reports more than one match', () => {
    execFileSync.mockReturnValue('C:\\first\\agy.exe\r\nC:\\second\\agy.exe\r\n')
    existsSync.mockReturnValue(true)

    expect(getAntigravityExecutablePath()).toBe('C:\\first\\agy.exe')
  })

  it('falls through to guessed candidates when PATH lookup throws (not on PATH)', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('not found')
    })
    existsSync.mockImplementation((p: string) => p.includes('agy'))

    const result = getAntigravityExecutablePath()
    expect(result).toBeDefined()
    expect(result).toContain('agy')
  })

  it('returns undefined when neither PATH nor any guessed candidate exists', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('not found')
    })
    existsSync.mockReturnValue(false)

    expect(getAntigravityExecutablePath()).toBeUndefined()
  })
})

describe('explicit overrides win over everything', () => {
  it('honours ANTIGRAVITY_PATH when it points to a real file', () => {
    process.env.ANTIGRAVITY_PATH = 'C:\\custom\\agy.exe'
    existsSync.mockReturnValue(true)

    expect(getAntigravityExecutablePath()).toBe('C:\\custom\\agy.exe')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('ignores ANTIGRAVITY_PATH when it points nowhere, rather than trusting it blindly', () => {
    process.env.ANTIGRAVITY_PATH = 'C:\\nonexistent\\agy.exe'
    execFileSync.mockReturnValue('C:\\real\\agy.exe\r\n')
    existsSync.mockImplementation((p: string) => p === 'C:\\real\\agy.exe')

    expect(getAntigravityExecutablePath()).toBe('C:\\real\\agy.exe')
  })

  it('honours AGY_PATH as a secondary override', () => {
    process.env.AGY_PATH = 'C:\\also-custom\\agy.exe'
    existsSync.mockReturnValue(true)

    expect(getAntigravityExecutablePath()).toBe('C:\\also-custom\\agy.exe')
  })
})
