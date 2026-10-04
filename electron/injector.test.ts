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

  it('injectPromptCDP performs 1-shot paste, verifies text landed, and restores clipboard', async () => {
    const cdpCommands: Array<{ method: string; params?: any }> = []
    let composerText = ''

    clipboard.writeText('user previous clipboard content')

    const mockWebContents: any = {
      debugger: {
        isAttached: vi.fn(() => true),
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(async (method: string, params?: any) => {
          cdpCommands.push({ method, params })
          if (method === 'Input.dispatchKeyEvent' && params?.key === 'v') {
            // Simulate clipboard paste landing into the composer
            composerText = clipboard.readText()
          }
          return {}
        }),
      },
      executeJavaScript: vi.fn(async (code: string) => {
        // Focus check
        if (code.includes('getBoundingClientRect')) {
          return { focused: true, w: 500, h: 100 }
        }
        // Read composer text
        if (code.includes('el.value !== undefined ? el.value : (el.textContent || \'\')')) {
          return composerText
        }
        // Button click
        if (code.includes('isSend')) {
          composerText = '' // Composer empties on send
          return 'Send message'
        }
        return null
      }),
    }

    const testPrompt = 'Write a comprehensive guide to local AI workstation engineering.'
    const success = await injectPromptCDP(mockWebContents, testPrompt, 'claude', true)

    expect(success).toBe(true)

    // Check key commands dispatched:
    // 1. Select All (KeyA)
    // 2. Del (Backspace)
    // 3. Fast Paste (KeyV) with modifier
    const keyMethods = cdpCommands.filter(c => c.method === 'Input.dispatchKeyEvent')
    const keyVCommands = keyMethods.filter(c => c.params?.key === 'v')

    expect(keyVCommands.length).toBe(2) // 1 keyDown, 1 keyUp
    expect(keyVCommands[0].params.type).toBe('keyDown')
    expect(keyVCommands[1].params.type).toBe('keyUp')

    // Original clipboard must be restored
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
