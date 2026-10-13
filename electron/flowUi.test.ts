import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('./flow', () => ({ withFlowPage: vi.fn(), flowIdError: () => null }))
vi.mock('./chatgptImages', () => ({ withCdp: vi.fn(), waitFor: vi.fn() }))
vi.mock('./flowHolds', () => ({ flowHold: () => null, heldError: () => '', holdFlowAccount: vi.fn(), UNUSUAL_ACTIVITY: /unusual activity/i }))
vi.mock('./localImageFile', () => ({ readLocalImage: vi.fn() }))

const { checkCount, checkRatio, checkRequest, modelName, newMediaIds, flowUiGenerateImage, flowUiGenerate } = await import('./flowUi')
const flow = await import('./flow')

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

  it('compares model labels without their emoji or icon name', () => {
    expect(modelName('🍌 Nano Banana 2')).toBe('Nano Banana 2')
    expect(modelName('volume_up Veo 3.1 - Fast')).toBe('Veo 3.1 - Fast')
    expect(modelName('Omni 1.1 Flash')).toBe('Omni 1.1 Flash')
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

  it('checks video settings and images before opening Flow', async () => {
    const v = (extra: object) => checkRequest({ kind: 'video', prompt: 'a cat', projectId: 'p', ...extra })
    expect(v({})).toBeNull()
    expect(v({ aspectRatio: '1:1' })?.error).toContain('16:9, 9:16')
    expect(v({ resolution: '1080p' })?.error).toContain('360p or 720p')
    expect(v({ seconds: 5 })?.error).toContain('4, 6, 8, 10')
    expect(v({ endFrame: 'img-2' })?.error).toContain('needs a startFrame')
    expect(v({ startFrame: 'img-1', ingredients: ['img-2'] })?.error).toContain('not both')
    expect(v({ ingredients: Array.from({ length: 8 }, (_, i) => `img-${i}`) })?.error).toContain('at most 7')
    expect(v({ startFrame: 'C:/pics/first.png', endFrame: 'img-9' })).toBeNull()
    expect(checkRequest({ kind: 'image', prompt: 'x', projectId: 'p', seconds: 8 })?.error).toContain('videos only')
    expect(await flowUiGenerate({ kind: 'video', prompt: 'x', projectId: 'p', seconds: 3 })).toMatchObject({ ok: false })
    expect(flow.withFlowPage).not.toHaveBeenCalled()
  })
})
