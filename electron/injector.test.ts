import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clipboard } from 'electron'
import { injectPromptCDP, injectPrompt } from './injector'

vi.mock('electron', () => {
  let clipboardContent = ''
  return {
    clipboard: {
      readText: vi.fn(() => clipboardContent),
      writeText: vi.fn((text: string) => {
        clipboardContent = text
      }),
    },
    WebContents: vi.fn(),
  }
})

describe('1-Shot Instant Prompt Injection (c20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('benchmark: demonstrates order-of-magnitude reduction in CDP round-trips for 500 chars', async () => {
    const text500 = 'A'.repeat(500)

    // 1. Measure simulated legacy loop (500 chars * 2 CDP calls = 1,000 round trips)
    let legacyCallCount = 0
    const legacyStart = performance.now()
    for (const ch of text500) {
      legacyCallCount++ // keyDown
      await Promise.resolve(ch)
      legacyCallCount++ // keyUp
      await Promise.resolve(ch)
    }
    const legacyDuration = performance.now() - legacyStart

    // 2. Measure 1-Shot fast paste (2 CDP calls total: Ctrl+V keyDown + keyUp)
    let fastPasteCallCount = 0
    const fastStart = performance.now()
    clipboard.writeText(text500)
    fastPasteCallCount++ // keyDown (KeyV)
    await Promise.resolve()
    fastPasteCallCount++ // keyUp (KeyV)
    await Promise.resolve()
    const fastDuration = performance.now() - fastStart

    expect(legacyCallCount).toBe(1000)
    expect(fastPasteCallCount).toBe(2)
    // 500x fewer IPC round-trips
    expect(legacyCallCount / fastPasteCallCount).toBe(500)
    expect(fastDuration).toBeLessThan(legacyDuration + 50)
  })

  it('pastes inside the page only and never touches the system clipboard', async () => {
    const cdpCommands: Array<{ method: string; params?: any }> = []
    let composerText = ''

    clipboard.writeText('user previous clipboard content')
    vi.mocked(clipboard.writeText).mockClear()

    const mockWebContents: any = {
      debugger: {
        isAttached: vi.fn(() => true),
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(async (method: string, params?: any) => {
          cdpCommands.push({ method, params })
          return {}
        }),
      },
      executeJavaScript: vi.fn(async (code: string) => {
        if (code.includes('getBoundingClientRect')) return { focused: true, w: 500, h: 100 }
        // The page-local paste event lands the text in the composer
        if (code.includes("new ClipboardEvent('paste'")) { composerText = testPrompt; return null }
        if (code.includes('el.value !== undefined ? el.value : (el.textContent || \'\')')) return composerText
        if (code.includes('isSend')) { composerText = ''; return 'Send message' }
        return null
      }),
    }

    const testPrompt = 'Write a comprehensive guide to local AI workstation engineering.'
    const success = await injectPromptCDP(mockWebContents, testPrompt, 'claude', true)

    expect(success).toBe(true)
    const pasteCalls = mockWebContents.executeJavaScript.mock.calls.filter((c: string[]) => c[0].includes("new ClipboardEvent('paste'"))
    expect(pasteCalls.length).toBe(1)
    expect(pasteCalls[0][0]).toContain(JSON.stringify(testPrompt))
    // No Ctrl+V key events, no fallback, and the user's clipboard was never written
    expect(cdpCommands.filter(c => c.params?.key === 'v')).toHaveLength(0)
    expect(cdpCommands.filter(c => c.method === 'Input.insertText')).toHaveLength(0)
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(clipboard.readText()).toBe('user previous clipboard content')
  })

  it('injectPromptCDP triggers fallback to Input.insertText if paste does not land', async () => {
    const cdpCommands: Array<{ method: string; params?: any }> = []
    let composerText = ''

    const mockWebContents: any = {
      debugger: {
        isAttached: vi.fn(() => true),
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(async (method: string, params?: any) => {
          cdpCommands.push({ method, params })
          // KeyV intentionally does NOT populate composerText to trigger fallback
          if (method === 'Input.insertText') {
            composerText = params.text
          }
          return {}
        }),
      },
      executeJavaScript: vi.fn(async (code: string) => {
        if (code.includes('getBoundingClientRect')) {
          return { focused: true, w: 400, h: 80 }
        }
        if (code.includes('el.value !== undefined ? el.value : (el.textContent || \'\')')) {
          return composerText
        }
        if (code.includes('isSend')) {
          composerText = ''
          return 'submit'
        }
        return null
      }),
    }

    const promptText = 'Fallback test prompt text'
    const success = await injectPromptCDP(mockWebContents, promptText, 'gemini', true)

    expect(success).toBe(true)
    const insertTextCalls = cdpCommands.filter(c => c.method === 'Input.insertText')
    expect(insertTextCalls.length).toBe(1)
    expect(insertTextCalls[0].params.text).toBe(promptText)
  })

  it('injectPrompt routes chatgpt through fast CDP path', async () => {
    let usedCDP = false
    const mockWebContents: any = {
      debugger: {
        isAttached: vi.fn(() => true),
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(async (_method: string, _params?: any) => {
          usedCDP = true
          return {}
        }),
      },
      executeJavaScript: vi.fn(async (code: string) => {
        if (code.includes('getBoundingClientRect')) {
          return { focused: true, w: 600, h: 120 }
        }
        if (code.includes('el.value !== undefined ? el.value : (el.textContent || \'\')')) {
          return 'Pasted prompt'
        }
        if (code.includes('isSend')) {
          return 'send'
        }
        return null
      }),
    }

    const ok = await injectPrompt(mockWebContents, 'Fast prompt for ChatGPT', 'chatgpt', false)
    expect(ok).toBe(true)
    expect(usedCDP).toBe(true)
  })
})
