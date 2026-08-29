import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ensureBackgroundView } from '../sessions'
import { injectPrompt } from '../injector'

vi.mock('../sessions', () => ({
  ensureBackgroundView: vi.fn(async () => ({ webContents: {} })),
  getViewById: vi.fn(() => ({ webContents: {} })),
}))
vi.mock('../injector', () => ({ injectPrompt: vi.fn(async () => true) }))
vi.mock('../providerUrls', () => ({ PROVIDER_URLS: { chatgpt: 'https://chatgpt.com/' } }))

const { askBrowserProvider, configureBrowserWorkerQueue, notifyCaptureActivity, notifyCaptureComplete } =
  await import('./browserWorkerQueue')

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

/**
 * The bug these pin, confirmed against real runs rather than assumed:
 * ChatGPT's image-generation stream delivers the image, the pipeline fetches
 * its bytes and writes a real PNG to disk — and then the stream simply goes
 * quiet, never sending `done`. emitCaptureComplete therefore never fires for
 * that turn, and the idle timeout used to reject, throwing away an image
 * that had already succeeded.
 */
describe('idle timeout with content already received', () => {
  it('resolves with the partial text instead of discarding it', async () => {
    const call = askBrowserProvider('chatgpt' as never, 'draw a ship')
    await vi.advanceTimersByTimeAsync(1_000)

    notifyCaptureActivity('chatgpt', '![generated image](flowdesk-image://abc.png)')
    await vi.advanceTimersByTimeAsync(130_000)

    await expect(call).resolves.toContain('flowdesk-image://abc.png')
  })

  it('still rejects when the stream produced nothing at all', async () => {
    const call = askBrowserProvider('chatgpt' as never, 'hello')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(130_000)
    await expect(call).rejects.toThrow(/no content at all/)
  })

  it('keeps waiting while the stream is still producing activity', async () => {
    const call = askBrowserProvider('chatgpt' as never, 'slow one')
    await vi.advanceTimersByTimeAsync(100)

    let settled = false
    void call.then(() => { settled = true }, () => { settled = true })

    // Three 90s gaps, each under the 120s idle limit — a fixed 60s (or even
    // a non-resetting 120s) deadline would have killed this turn twice over.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(90_000)
      notifyCaptureActivity('chatgpt', 'still working…')
    }
    expect(settled).toBe(false)

    notifyCaptureComplete('chatgpt', 'final answer')
    await expect(call).resolves.toBe('final answer')
  })
})

describe('account-specific provider windows', () => {
  it('creates a different background window after the selected account changes', async () => {
    vi.setSystemTime(1_000_000)
    let partition = 'gmail-first'
    configureBrowserWorkerQueue({ getAccounts: () => [{ email: 'selected@example.com', partition }] })

    const first = askBrowserProvider('chatgpt' as never, 'first account')
    await vi.advanceTimersByTimeAsync(1_000)
    notifyCaptureComplete('chatgpt', 'first reply')
    await expect(first).resolves.toBe('first reply')

    partition = 'gmail-second'
    const second = askBrowserProvider('chatgpt' as never, 'second account')
    await vi.advanceTimersByTimeAsync(1_000)
    notifyCaptureComplete('chatgpt', 'second reply')
    await expect(second).resolves.toBe('second reply')

    expect(vi.mocked(ensureBackgroundView)).toHaveBeenLastCalledWith(
      'agent-gmail-second-chatgpt',
      'gmail-second',
      'https://chatgpt.com/'
    )
  })
})

describe('account failover', () => {
  it('retries the next account after a confirmed quota failure', async () => {
    vi.setSystemTime(10_000_000)
    vi.mocked(injectPrompt)
      .mockRejectedValueOnce(new Error('Usage limit reached'))
      .mockResolvedValueOnce(true)
    configureBrowserWorkerQueue({ getAccounts: () => [
      { email: 'first@example.com', partition: 'gmail-first' },
      { email: 'second@example.com', partition: 'gmail-second' },
    ] })

    const call = askBrowserProvider('chatgpt' as never, 'hello')
    await vi.advanceTimersByTimeAsync(2_000)
    notifyCaptureComplete('chatgpt', 'second reply')

    await expect(call).resolves.toBe('second reply')
    expect(vi.mocked(ensureBackgroundView)).toHaveBeenLastCalledWith(
      'agent-gmail-second-chatgpt',
      'gmail-second',
      'https://chatgpt.com/'
    )
  })

  it('stops after an unknown error without using another account', async () => {
    vi.setSystemTime(20_000_000)
    vi.mocked(injectPrompt).mockRejectedValueOnce(new Error('Composer selector changed'))
    configureBrowserWorkerQueue({ getAccounts: () => [
      { email: 'first@example.com', partition: 'gmail-first' },
      { email: 'second@example.com', partition: 'gmail-second' },
    ] })

    const call = askBrowserProvider('chatgpt' as never, 'hello')
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(call).rejects.toThrow('Composer selector changed')
    expect(vi.mocked(ensureBackgroundView)).toHaveBeenCalledTimes(1)
  })
})
