import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('./flow', () => ({ withFlowPage: vi.fn(), flowIdError: () => null }))
vi.mock('./chatgptImages', () => ({ withCdp: vi.fn(), waitFor: vi.fn() }))

const { checkCount, checkRatio, modelName, newMediaIds, flowUiGenerateImage } = await import('./flowUi')

describe('flowUi', () => {
  it('accepts only the ratios Flow offers', () => {
    expect(checkRatio('3:4')).toBe('3:4')
    expect(checkRatio(undefined)).toBeNull()
    expect(checkRatio('2:3')).toEqual({ error: expect.stringContaining('16:9') })
  })

  it('accepts counts 1 to 4', () => {
    expect(checkCount(2)).toBe(2)
    expect(checkCount(null)).toBeNull()
    expect(checkCount(5)).toEqual({ error: expect.any(String) })
    expect(checkCount(1.5)).toEqual({ error: expect.any(String) })
  })

  it('compares model labels without their emoji', () => {
    expect(modelName('🍌 Nano Banana 2')).toBe('Nano Banana 2')
    expect(modelName('  Nano  Banana Pro ')).toBe('Nano Banana Pro')
  })

  it('finds only media that were not there before', () => {
    expect(newMediaIds(['a', 'b'], ['c', 'a', 'b', 'd'])).toEqual(['c', 'd'])
  })

  it('rejects bad input before touching the page', async () => {
    expect(await flowUiGenerateImage({ prompt: ' ', projectId: 'p' })).toMatchObject({ ok: false })
    expect(await flowUiGenerateImage({ prompt: 'x', projectId: 'p', aspectRatio: '2:3' })).toMatchObject({ ok: false, error: expect.stringContaining('aspectRatio') })
    expect(await flowUiGenerateImage({ prompt: 'x', projectId: 'p', count: 9 })).toMatchObject({ ok: false })
  })
})
