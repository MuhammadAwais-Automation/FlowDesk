import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null, listViewUrls: () => ['https://mail.google.com/'] }))

const { flowGenerateImage, flowCreateProject, flowUploadImage, flowDownloadImage, flowGenerateVideo, flowGetVideoStatus, flowGetCredits, flowViewImage } = await import('./flow')

describe('flow generate image', () => {
  it('refuses an empty prompt before touching the network', () => {
    return flowGenerateImage('   ', 'proj-1').then(out => {
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('prompt')
    })
  })

  it('refuses without a projectId', () => {
    return flowGenerateImage('a cat', '   ').then(out => {
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('projectId')
    })
  })

  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowGenerateImage('a cat', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
    // The message has to say what IS open, or 'not open' is undiagnosable.
    expect(String(out.error)).toContain('mail.google.com')
  })
})

describe('flow create project', () => {
  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowCreateProject('My Project')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })

  it('defaults to a timestamp title when none is given', async () => {
    const out = await flowCreateProject('')
    expect(out.ok).toBe(false) // still fails (not open), but should not throw on the empty title
  })
})

describe('flow upload image', () => {
  it('refuses without a local file path', async () => {
    const out = await flowUploadImage('   ', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('local file path')
  })

  it('refuses without a projectId', async () => {
    const out = await flowUploadImage('C:/x/photo.jpg', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('projectId')
  })

  it('reports a missing file as a result, not a throw', async () => {
    const out = await flowUploadImage('C:/definitely/does/not/exist.jpg', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('could not read')
  })
})

describe('flow download image', () => {
  it('refuses without a mediaId', async () => {
    const out = await flowDownloadImage('   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('mediaId')
  })

  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowDownloadImage('media-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })
})

describe('flow generate video', () => {
  it('refuses without any mediaIds', async () => {
    const out = await flowGenerateVideo('INGREDIENTS', 'VEO_3_1_LITE', [], 'a dog running', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('mediaId')
  })

  it('refuses when mediaIds are all blank', async () => {
    const out = await flowGenerateVideo('INGREDIENTS', 'VEO_3_1_LITE', ['   '], 'a dog running', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('mediaId')
  })

  it('refuses an empty prompt', async () => {
    const out = await flowGenerateVideo('INGREDIENTS', 'VEO_3_1_LITE', ['media-1'], '   ', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('prompt')
  })

  it('refuses without a projectId', async () => {
    const out = await flowGenerateVideo('INGREDIENTS', 'VEO_3_1_LITE', ['media-1'], 'a dog running', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('projectId')
  })

  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowGenerateVideo('FRAMES', 'OMNI_FLASH', ['media-1'], 'a dog running', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })
})

describe('flow get video status', () => {
  it('refuses without a mediaId', async () => {
    const out = await flowGetVideoStatus('   ', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('mediaId')
  })

  it('refuses without a projectId', async () => {
    const out = await flowGetVideoStatus('media-1', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('projectId')
  })

  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowGetVideoStatus('media-1', 'proj-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })
})

describe('flow view image', () => {
  it('refuses without a mediaId', async () => {
    const out = await flowViewImage('   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('mediaId')
  })

  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowViewImage('media-1')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })
})

describe('flow get credits', () => {
  it('reports Google Flow not being open as a result, not a throw', async () => {
    const out = await flowGetCredits()
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Google Flow is not open')
  })
})
