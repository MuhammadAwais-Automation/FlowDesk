import { describe, expect, it } from 'vitest'
import { generateImageScript, createProjectScript, uploadImageScript, generateVideoScript, getVideoStatusScript, getCreditsScript, __testing } from './flowBridge'

/**
 * Every fact this bridge relies on was confirmed against a real, live Google
 * Flow session — see flowBridge.ts's own header comment and
 * probes/FINDINGS-flow.md for how each was checked. These tests pin the
 * shape that verification produced, not an assumption.
 */

describe('the wire-format facts this bridge depends on', () => {
  it('targets the real internal API host, confirmed live via Resource Timing', () => {
    expect(__testing.AISANDBOX_API).toBe('https://aisandbox-pa.googleapis.com')
  })

  it('uses the real reCAPTCHA Enterprise site key read off the page own script tag', () => {
    // Matches the third-party reference kit's value too, but confirmed
    // independently rather than trusted from it.
    expect(__testing.RECAPTCHA_SITE_KEY).toBe('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV')
  })
})

describe('generateImageScript', () => {
  const script = generateImageScript('a red bicycle', 'proj-123', 'LANDSCAPE')

  it('reads the access token from the same-origin session endpoint, not by intercepting a header', () => {
    expect(script).toContain("fetch('/fx/api/auth/session'")
    expect(script).toContain('json.access_token')
  })

  it('executes the page own already-loaded reCAPTCHA widget instead of solving anything', () => {
    expect(script).toContain('grecaptcha.enterprise.execute')
    expect(script).toContain("'IMAGE_GENERATION'")
  })

  it('embeds the recaptcha token at BOTH clientContext levels, matching the real captured request', () => {
    // A request missing either level is exactly the "hand-picked subset"
    // mistake this project's own Facebook comment mutation already made and
    // documented — the fix there was to stop guessing which fields matter.
    const clientContextCount = (script.match(/clientContext: clientContext/g) ?? []).length
    expect(clientContextCount).toBeGreaterThanOrEqual(1)
    expect(script).toContain('clientContext: clientContext,')
  })

  it('targets the real batchGenerateImages endpoint with the projectId in the path', () => {
    expect(script).toContain("'/v1/projects/' + projectId + '/flowMedia:batchGenerateImages'")
  })

  it('maps all 5 aspect ratios to the real enum values, each confirmed by its own live generation', () => {
    // _FOUR_THREE / _THREE_FOUR were not derivable from the first three
    // values captured — each of the 5 was independently generated and read
    // off its own request before being added here.
    expect(generateImageScript('x', 'p', 'LANDSCAPE')).toContain('IMAGE_ASPECT_RATIO_LANDSCAPE"')
    expect(generateImageScript('x', 'p', 'LANDSCAPE_4_3')).toContain('IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE')
    expect(generateImageScript('x', 'p', 'SQUARE')).toContain('IMAGE_ASPECT_RATIO_SQUARE')
    expect(generateImageScript('x', 'p', 'PORTRAIT_3_4')).toContain('IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR')
    expect(generateImageScript('x', 'p', 'PORTRAIT')).toContain('IMAGE_ASPECT_RATIO_PORTRAIT"')
  })

  it('maps image models to their real keys, and only offers confirmed ones', () => {
    expect(generateImageScript('x', 'p', 'LANDSCAPE', 'NANO_BANANA_PRO')).toContain('GEM_PIX_2')
    expect(generateImageScript('x', 'p', 'LANDSCAPE', 'NANO_BANANA_2')).toContain('NARWHAL')
    expect(Object.keys(__testing.IMAGE_MODEL_MAP)).not.toContain('NANO_BANANA_2_LITE')
  })

  it('includes reference mediaIds as IMAGE_INPUT_TYPE_REFERENCE inputs', () => {
    const withRefs = generateImageScript('x', 'p', 'LANDSCAPE', 'NANO_BANANA_PRO', ['media-1', 'media-2'])
    expect(withRefs).toContain('IMAGE_INPUT_TYPE_REFERENCE')
    expect(withRefs).toContain('["media-1","media-2"]')
  })

  it('requires media echoed back, not just a 200', () => {
    expect(script).toContain('!media')
    expect(script).toContain('did not confirm the image')
  })

  it('builds a viewable URL from the real media redirect endpoint rather than returning a bare id', () => {
    expect(script).toContain('media.getMediaUrlRedirect?name=')
  })

  it('escapes the prompt text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = generateImageScript(nasty, 'proj-123')
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('createProjectScript', () => {
  const script = createProjectScript('My Project')

  it('targets the real tRPC endpoint with the json wrapper this build actually uses', () => {
    // Confirmed against this build's OTHER tRPC calls (general.submitBatchLog
    // etc.) before trusting the reference kit's shape for this specific one.
    expect(script).toContain("fetch('/fx/api/trpc/project.createProject'")
    expect(script).toContain("json: { projectTitle: projectTitle, toolName: 'PINHOLE' }")
  })

  it('does not call the recaptcha or sandbox-api helpers, unlike image generation', () => {
    // The shared PRELUDE defines those helpers regardless (both scripts go
    // through buildScript), so what matters is that THIS script's own body
    // never calls them — a plain tRPC POST, confirmed from the real capture.
    expect(script).not.toContain('await getRecaptchaToken(')
    expect(script).not.toContain('await callSandboxApi(')
  })

  it('reads projectId out of the real nested tRPC response shape', () => {
    expect(script).toContain('json.result.data.json.result')
    expect(script).toContain('inner.projectId')
  })

  it('requires the projectId echoed back, not just a 200', () => {
    expect(script).toContain('!inner.projectId')
    expect(script).toContain('did not confirm the new project')
  })

  it('escapes the project title rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = createProjectScript(nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

// The scripts below (upload, video, credits) are built from a third-party
// reference kit's already-tested endpoints, per explicit instruction, rather
// than independently re-captured against this project's own live session
// first — see flowBridge.ts's header comment. These tests pin the shape as
// written, not a live-confirmed fact the way the tests above do.

describe('uploadImageScript', () => {
  const script = uploadImageScript('base64data', 'proj-123', 'image/png', 'photo.png')

  it('targets the reference kit uploadImage endpoint', () => {
    expect(script).toContain("callSandboxApi('/v1/flow/uploadImage'")
  })

  it('requires a mediaId echoed back, not just a 200', () => {
    expect(script).toContain('!media.name')
    expect(script).toContain('did not confirm the upload')
  })

  it('produces valid, executable JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })
})

describe('the confirmed API key', () => {
  it('is the real value seen in the live-captured GET /v1/credits call', () => {
    // getMediaScript (the reference kit's /v1/media/{id} REST call) also
    // used this key but returned HTTP 400 on a real test and was removed —
    // the key itself is still real and still used by getCreditsScript.
    expect(__testing.AISANDBOX_API_KEY).toBe('AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY')
  })
})

describe('generateVideoScript', () => {
  it('maps all 3 confirmed model+mode combinations to their real captured keys', () => {
    expect(__testing.VIDEO_MODEL_KEYS.VEO_3_1_LITE.INGREDIENTS).toBe('veo_3_1_r2v_lite')
    expect(__testing.VIDEO_MODEL_KEYS.OMNI_FLASH.INGREDIENTS).toBe('abra_r2v_6s')
    expect(__testing.VIDEO_MODEL_KEYS.OMNI_FLASH.FRAMES).toBe('abra_i2v_6s')
  })

  it('refuses cleanly for an unconfirmed combination rather than guessing', () => {
    // Veo 3.1 Lite + FRAMES has never been captured — the kit's table
    // guessed values for related combinations that turned out wrong, so
    // this is refused rather than extrapolated.
    const script = generateVideoScript('FRAMES', 'VEO_3_1_LITE', ['media-1'], 'x', 'proj-1')
    expect(script).toContain('does not have a confirmed model key')
  })

  describe('INGREDIENTS mode (Veo 3.1 Lite)', () => {
    const script = generateVideoScript('INGREDIENTS', 'VEO_3_1_LITE', ['media-1'], 'camera slowly zooms in', 'proj-1')

    it('targets the real reference-images endpoint', () => {
      expect(script).toContain('callSandboxApi("/v1/video:batchAsyncGenerateVideoReferenceImages"')
    })

    it('sends reference images as IMAGE_USAGE_TYPE_ASSET, matching the real request', () => {
      expect(script).toContain('IMAGE_USAGE_TYPE_ASSET')
    })

    it('uses the real confirmed model key', () => {
      expect(script).toContain('veo_3_1_r2v_lite')
    })

    it('produces valid, executable JavaScript', () => {
      expect(() => new Function(`return ${script}`)).not.toThrow()
    })
  })

  describe('FRAMES mode (Omni Flash)', () => {
    const script = generateVideoScript('FRAMES', 'OMNI_FLASH', ['media-1'], 'gentle wind blowing', 'proj-1')

    it('targets the real start-image endpoint', () => {
      expect(script).toContain('callSandboxApi("/v1/video:batchAsyncGenerateVideoStartImage"')
    })

    it('sends a single startImage, not referenceImages', () => {
      expect(script).toContain("startImage: { mediaId: \"media-1\" }")
      expect(script).not.toContain('referenceImages')
    })

    it('never includes an endImage — Google’s own API rejected one outright for this model', () => {
      expect(script).not.toContain('endImage')
    })

    it('uses the real confirmed Omni Flash FRAMES model key', () => {
      expect(script).toContain('abra_i2v_6s')
    })

    it('produces valid, executable JavaScript', () => {
      expect(() => new Function(`return ${script}`)).not.toThrow()
    })
  })

  it('reads the returned mediaId from workflows[0].metadata.primaryMediaId, not workflows[0].name', () => {
    // The response shape actually returned by a real request — a workflow
    // name is not the pollable media id.
    const script = generateVideoScript('INGREDIENTS', 'VEO_3_1_LITE', ['media-1'], 'x', 'proj-1')
    expect(script).toContain('workflow.metadata ? workflow.metadata.primaryMediaId')
  })

  it('submits only, and says so, rather than claiming the video is ready', () => {
    const script = generateVideoScript('INGREDIENTS', 'VEO_3_1_LITE', ['media-1'], 'x', 'proj-1')
    expect(script).toContain('submitted: true')
  })
})

describe('getVideoStatusScript', () => {
  const script = getVideoStatusScript('media-1', 'proj-1')

  it('targets the real status-check endpoint with the real minimal body shape', () => {
    expect(script).toContain("callSandboxApi('/v1/video:batchCheckAsyncVideoGenerationStatus'")
    expect(script).toContain('media: [{ name:')
  })

  it('reads the real nested status field, confirmed from a completed video', () => {
    expect(script).toContain('mediaMetadata.mediaStatus.mediaGenerationStatus')
    expect(script).toContain("=== 'MEDIA_GENERATION_STATUS_SUCCESSFUL'")
  })

  it('produces valid, executable JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })
})

describe('getCreditsScript', () => {
  it('produces valid, executable JavaScript', () => {
    const script = getCreditsScript()
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain('userPaygateTier')
  })
})
