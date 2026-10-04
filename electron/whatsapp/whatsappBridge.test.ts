import { beforeEach, describe, expect, it, vi } from 'vitest'

let evaluate: (expression: string) => unknown = () => ({ ok: true })
let evaluateDelayMs = 0
let mockViewExists = true

vi.mock('../sessions', () => ({
  getWhatsAppView: () => (mockViewExists ? {
    webContents: {
      executeJavaScript: async (expression: string) => {
        if (evaluateDelayMs > 0) {
          await new Promise(r => setTimeout(r, evaluateDelayMs))
        }
        return evaluate(expression)
      },
    },
  } : null),
  ensureBackgroundView: () => null,
}))

const {
  waStatus,
  waListChats,
  waApiListChats,
  waListMessages,
  waApiListMessages,
  waSend,
  waSendFile,
  call,
  safePayload,
} = await import('./whatsapp')

describe('WhatsApp Bridge - Parameter Serialization', () => {
  let capturedExpr = ''

  beforeEach(() => {
    mockViewExists = true
    evaluateDelayMs = 0
    capturedExpr = ''
    evaluate = expr => {
      capturedExpr = expr
      return { ok: true }
    }
  })

  it('serializes waListChats parameters with defaults', async () => {
    await waListChats()
    expect(capturedExpr).toBe('window.__fdWaListChats({})')
  })

  it('serializes waListChats with limit and onlyUnread flags', async () => {
    await waListChats(25, true)
    expect(capturedExpr).toBe('window.__fdWaListChats({"limit":25,"onlyUnread":true})')

    await waListChats(10)
    expect(capturedExpr).toBe('window.__fdWaListChats({"limit":10})')

    await waListChats(undefined, false)
    expect(capturedExpr).toBe('window.__fdWaListChats({"onlyUnread":false})')
  })

  it('sanitizes invalid waListChats limit values', async () => {
    await waListChats(-10)
    expect(capturedExpr).toBe('window.__fdWaListChats({})')

    await waListChats(NaN)
    expect(capturedExpr).toBe('window.__fdWaListChats({})')
  })

  it('delegates waApiListChats to waListChats', async () => {
    const res = await waApiListChats(15, true)
    expect(res.ok).toBe(true)
    expect(capturedExpr).toBe('window.__fdWaListChats({"limit":15,"onlyUnread":true})')
  })

  it('serializes waListMessages chatId and default limit', async () => {
    await waListMessages('12345@c.us')
    expect(capturedExpr).toBe('window.__fdWaListMessages("12345@c.us", 20)')
  })

  it('serializes waListMessages with custom limit and escapes special characters in chatId', async () => {
    await waListMessages('user"quote"\\slash@c.us', 45)
    expect(capturedExpr).toBe('window.__fdWaListMessages("user\\"quote\\"\\\\slash@c.us", 45)')
  })

  it('delegates waApiListMessages to waListMessages', async () => {
    const res = await waApiListMessages('chat@g.us', 30)
    expect(res.ok).toBe(true)
    expect(capturedExpr).toBe('window.__fdWaListMessages("chat@g.us", 30)')
  })

  it('rejects waListMessages when chatId is missing or not a string', async () => {
    const res1 = await waListMessages('')
    expect(res1.ok).toBe(false)
    expect(res1.error).toContain('chatId is required')

    const res2 = await waListMessages(null as unknown as string)
    expect(res2.ok).toBe(false)
    expect(res2.error).toContain('chatId is required')
    expect(capturedExpr).toBe('')
  })

  it('serializes waSend with chatId and text', async () => {
    await waSend('12345@c.us', 'Hello from FlowDesk!\nNewline test.')
    expect(capturedExpr).toBe('window.__fdWaSend("12345@c.us", "Hello from FlowDesk!\\nNewline test.")')
  })

  it('rejects waSend when parameters are missing or invalid', async () => {
    const res1 = await waSend('', 'text')
    expect(res1.ok).toBe(false)
    expect(res1.error).toContain('chatId is required')

    const res2 = await waSend('123@c.us', null as unknown as string)
    expect(res2.ok).toBe(false)
    expect(res2.error).toContain('text is required')
    expect(capturedExpr).toBe('')
  })
})

describe('WhatsApp Bridge - Error Handling & Timeout Protection', () => {
  beforeEach(() => {
    mockViewExists = true
    evaluateDelayMs = 0
    evaluate = () => ({ ok: true })
  })

  it('returns clean error when WhatsApp view is not open', async () => {
    mockViewExists = false
    const status = await waStatus()
    expect(status.ok).toBe(false)
    expect(status.error).toContain('WhatsApp is not open')
  })

  it('handles bridge execution exceptions cleanly without throwing', async () => {
    evaluate = () => {
      throw new Error('Evaluation error in page context')
    }
    const status = await waStatus()
    expect(status.ok).toBe(false)
    expect(status.error).toContain('Evaluation error in page context')
  })

  it('handles non-object responses from bridge cleanly', async () => {
    evaluate = () => 'plain string'
    const status = await waStatus()
    expect(status.ok).toBe(false)
    expect(status.error).toContain('bridge returned a non-object')
  })

  it('times out when page execution hangs without hanging the main process', async () => {
    evaluateDelayMs = 150
    const res = await call('window.__hang()', 40)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('timed out after 40ms')
  })

  it('validates file paths in waSendFile', async () => {
    const res = await waSendFile('123@c.us', '')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('filePath is required')
  })
})

describe('WhatsApp Bridge - Safe Payload Serialization', () => {
  it('serializes primitives without mutation', () => {
    expect(safePayload(null)).toBe(null)
    expect(safePayload(undefined)).toBe(undefined)
    expect(safePayload('hello')).toBe('hello')
    expect(safePayload(123)).toBe(123)
    expect(safePayload(true)).toBe(true)
  })

  it('transforms unclonable types (functions, symbols, bigints)', () => {
    const unclonable = {
      fn: () => 'execute',
      sym: Symbol('id'),
      big: BigInt(9007199254740991),
    }

    const safe = safePayload(unclonable)
    expect(safe.fn).toBe('[function]')
    expect(safe.sym).toBe('Symbol(id)')
    expect(safe.big).toBe('9007199254740991')

    // structuredClone would fail on unclonable, but passes on safePayload result
    expect(() => structuredClone(safe)).not.toThrow()
  })

  it('handles circular references safely without infinite recursion', () => {
    const circularObj: Record<string, unknown> = { name: 'circular test' }
    circularObj.self = circularObj

    const safe = safePayload(circularObj)
    expect(safe.name).toBe('circular test')
    expect(safe.self).toBe('[circular]')
    expect(() => structuredClone(safe)).not.toThrow()
  })

  it('serializes Error objects with stack and message', () => {
    const err = new Error('Test error message')
    const safe = safePayload(err)
    expect(safe.message).toBe('Test error message')
    expect(safe.name).toBe('Error')
    expect(typeof safe.stack).toBe('string')
    expect(() => structuredClone(safe)).not.toThrow()
  })

  it('bounds recursion depth for deeply nested objects', () => {
    let deep: Record<string, unknown> = { level: 0 }
    let curr = deep
    for (let i = 1; i <= 15; i++) {
      const next = { level: i }
      curr.nested = next
      curr = next
    }

    const safe = safePayload(deep)
    expect(() => structuredClone(safe)).not.toThrow()
  })
})
