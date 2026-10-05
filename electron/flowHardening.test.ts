import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({
  ensureBackgroundView: () => Promise.reject(new Error('no windows in tests')),
  listViewUrls: () => [],
}))

const {
  classifyFlowMediaUrl, flowHostAllowed, matchFlowAccount, videoKeyError, parseOwnersFile, flowIdError, OWNERS_CAP,
  flowGenerateVideo, flowGenerateVideoFromImage, flowUploadImage, flowDownloadMedia, flowMediaStatus, flowExtendVideo,
  flowGenerateImage, flowListProjects, setGoogleAccountsGetter,
} = await import('./flow')
const { fetchMediaUrlScript } = await import('./flowBridge')

describe('flow media URL allowlist', () => {
  it('sends flow-content.google image and video URLs to the cookie-less fetch', () => {
    expect(classifyFlowMediaUrl('https://flow-content.google/video/10aa7bf8-0324-483e-843d-7743a5bb78c7?x=1')).toMatchObject({ ok: true, via: 'direct' })
    expect(classifyFlowMediaUrl('https://flow-content.google/image/abc')).toMatchObject({ ok: true, via: 'direct' })
  })

  it('sends signed-in media (Flow /asb/, lh3 thumbnails) to the page fetch', () => {
    expect(classifyFlowMediaUrl('https://flow.google.com/asb/token')).toMatchObject({ ok: true, via: 'page' })
    expect(classifyFlowMediaUrl('https://lh3.googleusercontent.com/asb/token')).toMatchObject({ ok: true, via: 'page' })
  })

  it('rejects look-alike hosts that a substring check let through', () => {
    for (const url of [
      'https://flow-content.google.evil.com/video/x',
      'https://evil.com/flow-content.google/video/x',
      'https://evil.com/?u=https://flow-content.google/video/x',
      'https://notflow-content.google/video/x',
      'https://lh3.googleusercontent.com.evil.com/asb/x',
      'https://evil.com/asb/x',
    ]) expect(classifyFlowMediaUrl(url).ok).toBe(false)
  })

  it('rejects http, credentials in the URL, ports and non-media paths', () => {
    expect(classifyFlowMediaUrl('http://flow-content.google/video/x').ok).toBe(false)
    expect(classifyFlowMediaUrl('https://user:pw@flow-content.google/video/x').ok).toBe(false)
    expect(classifyFlowMediaUrl('https://flow-content.google:8443/video/x').ok).toBe(false)
    expect(classifyFlowMediaUrl('https://flow-content.google/other/x').ok).toBe(false)
    // The session endpoint answers with an access token: never a "media" URL.
    expect(classifyFlowMediaUrl('https://flow.google.com/fx/api/auth/session').ok).toBe(false)
    expect(classifyFlowMediaUrl('file:///C:/Windows/win.ini').ok).toBe(false)
    expect(classifyFlowMediaUrl('not a url').ok).toBe(false)
  })

  it('matches hosts exactly or on a real dot-suffix only', () => {
    expect(flowHostAllowed('a.google.com', ['.google.com'])).toBe(true)
    expect(flowHostAllowed('google.com', ['.google.com'])).toBe(false)
    expect(flowHostAllowed('evilgoogle.com', ['.google.com'])).toBe(false)
    expect(flowHostAllowed('FLOW.GOOGLE.COM.', ['flow.google.com'])).toBe(true)
  })

  it('refuses a bad media URL in the download tool before any network or page', async () => {
    const out = await flowDownloadMedia('https://evil.example/video/x')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('refusing')
  })

  it('re-checks the URL inside the page script too', () => {
    const script = fetchMediaUrlScript('https://flow.google.com/asb/x')
    expect(script).toContain('lh3.googleusercontent.com')
    expect(script).toContain("parsed.protocol !== 'https:'")
    expect(script).not.toContain("indexOf('googleusercontent.com')")
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })
})

describe('flow account resolution', () => {
  const accounts = [
    { email: 'alice@example.com', partition: 'gmail-aaa', label: 'Main' },
    { email: 'bob@example.com', partition: 'gmail-bbb', label: null },
  ]

  it('matches partition, email and label exactly', () => {
    expect(matchFlowAccount(accounts, 'gmail-bbb')).toEqual({ partition: 'gmail-bbb' })
    expect(matchFlowAccount(accounts, 'persist:gmail-bbb')).toEqual({ partition: 'gmail-bbb' })
    expect(matchFlowAccount(accounts, 'ALICE@example.com')).toEqual({ partition: 'gmail-aaa' })
    expect(matchFlowAccount(accounts, 'main')).toEqual({ partition: 'gmail-aaa' })
    expect(matchFlowAccount(accounts, 'bo***@example.com')).toEqual({ partition: 'gmail-bbb' })
  })

  it('rejects substrings and unknown accounts instead of falling back', () => {
    expect(matchFlowAccount(accounts, 'awais')).toHaveProperty('error')
    expect(matchFlowAccount(accounts, 'gmail')).toHaveProperty('error')
    expect(matchFlowAccount(accounts, 'gmail-')).toHaveProperty('error')
    const out = matchFlowAccount(accounts, 'nobody@x.com')
    expect('error' in out && out.error).toContain('unknown Google account')
    // Known accounts are listed masked, never in full.
    expect('error' in out && out.error).not.toContain('alice@example.com')
  })

  it('rejects an ambiguous masked label', () => {
    const twins = [{ email: 'al1@example.com', partition: 'p1' }, { email: 'al2@example.com', partition: 'p2' }]
    expect(matchFlowAccount(twins, 'al***@example.com')).toHaveProperty('error')
  })

  it('answers ok:false for an explicit unknown account on a real call', async () => {
    setGoogleAccountsGetter(() => accounts)
    try {
      const out = await flowListProjects('someone-else@example.com')
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('unknown Google account')
      const gen = await flowGenerateImage('a cat', 'e40771f3-d54b-4af4-b12b-c7551fadc241', undefined, 'awais')
      expect(gen.ok).toBe(false)
      expect(String(gen.error)).toContain('unknown Google account')
    } finally {
      setGoogleAccountsGetter(() => [])
    }
  })
})

describe('flow video mode guard', () => {
  it('text-to-video takes only t2v keys', () => {
    expect(videoKeyError('abra_t2v_8s', 'textToVideo')).toBeNull()
    expect(videoKeyError('veo_3_1_r2v_lite', 'textToVideo')).toContain('image-to-video key')
    expect(videoKeyError('abra_i2v_6s', 'textToVideo')).toContain('image-to-video key')
  })

  it('image-to-video takes only r2v/i2v keys', () => {
    expect(videoKeyError('veo_3_1_r2v_lite', 'imageToVideo')).toBeNull()
    expect(videoKeyError('abra_i2v_6s', 'imageToVideo')).toBeNull()
    expect(videoKeyError('abra_t2v_8s', 'imageToVideo')).toContain('text-to-video key')
  })

  it('still rejects family names and junk', () => {
    expect(videoKeyError('veo_3_1_lite', 'textToVideo')).toContain('model family')
    expect(videoKeyError('abra"); alert(1)//_t2v', 'textToVideo')).toContain('not a valid model key')
  })

  it('refuses the wrong mode before spending anything', async () => {
    const a = await flowGenerateVideo('a dog', 'e40771f3-d54b-4af4-b12b-c7551fadc241', 'veo_3_1_r2v_lite')
    expect(a.ok).toBe(false)
    expect(String(a.error)).toContain('image-to-video key')
    const b = await flowGenerateVideoFromImage('move', 'e40771f3-d54b-4af4-b12b-c7551fadc241', '10aa7bf8-0324-483e-843d-7743a5bb78c7', 'abra_t2v_8s')
    expect(b.ok).toBe(false)
    expect(String(b.error)).toContain('text-to-video key')
  })
})

describe('flow image model guard', () => {
  it('rejects an unknown imageModel before any call', async () => {
    const out = await flowGenerateImage('a cat', 'e40771f3-d54b-4af4-b12b-c7551fadc241', 'GEM_PIX_2')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('unknown imageModel')
    expect(String(out.error)).toContain('NANO_BANANA_2')
  })

  it('accepts the known models (fails later only because Flow is not open)', async () => {
    for (const m of ['NANO_BANANA_2', 'NANO_BANANA_PRO', undefined]) {
      const out = await flowGenerateImage('a cat', 'e40771f3-d54b-4af4-b12b-c7551fadc241', m)
      expect(String(out.error)).not.toContain('unknown imageModel')
    }
  })
})

describe('flow id and file validation', () => {
  it('accepts UUIDs and refuses path tricks', () => {
    expect(flowIdError('e40771f3-d54b-4af4-b12b-c7551fadc241', 'projectId')).toBeNull()
    for (const bad of ['../x', 'a/b', 'a?b', 'a#b', 'a b', '-lead', 'x'.repeat(200), '%2e%2e']) {
      expect(flowIdError(bad, 'projectId')).toContain('not a valid Google Flow id')
    }
  })

  it('refuses bad ids in every id-taking call', async () => {
    expect((await flowMediaStatus('../../x')).error).toContain('not a valid')
    expect((await flowExtendVideo('go', 'p1', 'v1', 'a/b')).error).toContain('sceneId')
    expect((await flowGenerateVideoFromImage('go', 'p1', 'm/1', 'veo_3_1_r2v_lite')).error).toContain('mediaId')
  })

  it('reads uploads only through the local image guard', async () => {
    const unc = await flowUploadImage('\\\\server\\share\\a.png', 'p1')
    expect(unc.ok).toBe(false)
    expect(String(unc.error)).toContain('Network and device paths')
    const rel = await flowUploadImage('a.png', 'p1')
    expect(String(rel.error)).toContain('absolute')
    const notImage = await flowUploadImage(process.cwd() + '/package.json', 'p1')
    expect(String(notImage.error)).toContain('.png')
  })
})

describe('flow owners file', () => {
  it('keeps valid id -> partition entries only', () => {
    const text = JSON.stringify({
      'e40771f3-d54b-4af4-b12b-c7551fadc241': 'gmail-aaa',
      '../evil': 'gmail-aaa',
      'good-id': 42,
      'other-id': 'persist:../x',
    })
    expect(parseOwnersFile(text)).toEqual([['e40771f3-d54b-4af4-b12b-c7551fadc241', 'gmail-aaa']])
  })

  it('ignores corrupt or wrongly shaped files', () => {
    expect(parseOwnersFile('{not json')).toEqual([])
    expect(parseOwnersFile('[["a","b"]]')).toEqual([])
    expect(parseOwnersFile('null')).toEqual([])
    expect(parseOwnersFile('"x"')).toEqual([])
  })

  it('keeps the newest entries up to the cap', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < OWNERS_CAP + 10; i++) big[`id${i}`] = 'p'
    const out = parseOwnersFile(JSON.stringify(big))
    expect(out).toHaveLength(OWNERS_CAP)
    expect(out[out.length - 1][0]).toBe(`id${OWNERS_CAP + 9}`)
  })
})
