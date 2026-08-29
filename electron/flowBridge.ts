/**
 * Google Flow (labs.google) bridge — built entirely on what live capture
 * actually showed, not on a third-party open-source kit's documentation.
 *
 * ── Why this needed its own investigation ──
 *
 * A third-party project (google-flow-kit, MIT licensed) already reverse-
 * engineers this same API via a Chrome extension + Python backend. Its
 * approach was used as a starting hypothesis, not trusted outright — every
 * piece below was independently confirmed against a real, live session
 * before being relied on, the same standard every other bridge in this
 * project holds itself to.
 *
 * ── The recorder itself had a bug that had to be found first ──
 *
 * The CDP recorder's `urlMatch` was a single string checked against the
 * PAGE's own host (`labs.google`). Google Flow's real generation calls go to
 * a completely different host, `aisandbox-pa.googleapis.com` — so every one
 * of them was silently dropped, indistinguishable from "never happened"
 * until the page's own `performance.getEntriesByType('resource')` was
 * checked directly and showed 28+ real calls to that host in one session.
 * Fixed in `cdpRecorder.ts` by letting `urlMatch` accept an array of
 * substrings; `sessions.ts` now passes both hosts for labs.google.
 *
 * ── The wire format ──
 *
 * Three things, all confirmed live, none guessed:
 *
 * 1. Auth: `GET /fx/api/auth/session` (same-origin, cookies only) returns
 *    `{ access_token: "ya29...." }` directly in its JSON body — a NextAuth
 *    session endpoint that happens to carry the Google OAuth token Flow uses
 *    for its own API calls. No token capture/interception needed.
 *
 * 2. reCAPTCHA: the page already has `grecaptcha.enterprise` loaded (its own
 *    script tag confirmed the site key: `6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV`,
 *    matching the reference kit's value exactly). Calling
 *    `grecaptcha.enterprise.execute(siteKey, { action })` in-page, using the
 *    page's own already-loaded widget, produces a fresh token — the same
 *    thing the real client does, not a bypass of anything.
 *
 * 3. Generation: `POST https://aisandbox-pa.googleapis.com/v1/projects/
 *    {projectId}/flowMedia:batchGenerateImages`, with the recaptcha token
 *    embedded in `clientContext.recaptchaContext.token` at TWO levels (outer
 *    and per-request) — both required, confirmed from the real captured
 *    body of a request that returned 200 with real image data.
 *
 * ── Aspect ratios and image models ──
 *
 * All 5 aspect ratio buttons Flow's own UI offers were generated one at a
 * time and their real enum strings read off each captured request:
 * `IMAGE_ASPECT_RATIO_LANDSCAPE` (16:9), `_LANDSCAPE_FOUR_THREE` (4:3),
 * `_SQUARE` (1:1), `_PORTRAIT_THREE_FOUR` (3:4), `_PORTRAIT` (9:16) — none
 * guessed from naming convention alone, since `_FOUR_THREE`/`_THREE_FOUR`
 * were not derivable from the first three that came in.
 *
 * Only `GEM_PIX_2` ("Nano Banana Pro") has been captured live. The UI also
 * offers "Nano Banana 2" and "Nano Banana 2 Lite" — the reference kit's
 * `models.json` names `NARWHAL` for "Nano Banana 2" (used here, unverified
 * against this project's own capture), and has no value at all for
 * "Lite" — so `NANO_BANANA_2_LITE` is not offered as a selectable model
 * until its real key is captured.
 *
 * ── Reference images, upload, video: from the reference kit, then corrected ──
 *
 * Per explicit instruction, `uploadImageScript`, the reference-image
 * (`imageInputs`) extension to `generateImageScript`, and `generateVideoScript`
 * were first built from the reference kit's already-tested endpoints rather
 * than independently re-captured against THIS project's own live session —
 * the user had run the kit itself and confirmed those work. Live testing
 * afterward caught real, material mistakes in that starting point (see
 * `probes/FINDINGS-flow.md`): the video endpoint, model key, and response
 * shape were all wrong, and a `getMediaScript` built the same way (the kit's
 * `/v1/media/{id}` REST call) returned HTTP 400 on a real test and was
 * removed rather than shipped broken. Downloading now reuses the SAME
 * `media.getMediaUrlRedirect` endpoint image generation's `viewUrl` already
 * uses, confirmed live against a freshly uploaded image too.
 *
 * ── The account-risk this bridge carries, stated plainly ──
 *
 * This calls an internal API Google does not publish for third-party use.
 * It is not a documented, supported integration point. Using it is a
 * deliberate choice to spend a real Google account's Flow subscription
 * programmatically, with the attendant risk that Google could flag or
 * restrict that account for it. Nothing here randomizes headers or spoofs a
 * different client identity to evade detection — this bridge's requests are
 * honestly what FlowDesk's own Electron/Chromium build sends — but the
 * underlying fact remains: this is not how Google intends Flow to be
 * automated, and every call through this file should be one the user
 * explicitly approved, aware of that.
 */

const AISANDBOX_API = 'https://aisandbox-pa.googleapis.com'
const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'
/**
 * A restricted-by-referrer Google API key, confirmed live in the real
 * captured `GET /v1/credits?key=...` request — not a secret Google expects
 * kept private (it identifies the calling app, not the user), but included
 * here as the exact value this build's own client sent, not guessed.
 */
const AISANDBOX_API_KEY = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY'

/** All 5 confirmed live, one generation per value — see the header comment. */
export type ImageAspectRatio = 'LANDSCAPE' | 'LANDSCAPE_4_3' | 'SQUARE' | 'PORTRAIT_3_4' | 'PORTRAIT'

const ASPECT_RATIO_MAP: Record<ImageAspectRatio, string> = {
  LANDSCAPE: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  LANDSCAPE_4_3: 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
  SQUARE: 'IMAGE_ASPECT_RATIO_SQUARE',
  PORTRAIT_3_4: 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
  PORTRAIT: 'IMAGE_ASPECT_RATIO_PORTRAIT',
}

/** Only models with a confirmed real key. "Nano Banana 2 Lite" is not offered — see header comment. */
export type ImageModel = 'NANO_BANANA_PRO' | 'NANO_BANANA_2'

const IMAGE_MODEL_MAP: Record<ImageModel, string> = {
  NANO_BANANA_PRO: 'GEM_PIX_2',
  NANO_BANANA_2: 'NARWHAL',
}

const PRELUDE = `
  var AISANDBOX_API = ${JSON.stringify(AISANDBOX_API)}
  var RECAPTCHA_SITE_KEY = ${JSON.stringify(RECAPTCHA_SITE_KEY)}
  var AISANDBOX_API_KEY = ${JSON.stringify(AISANDBOX_API_KEY)}

  async function getAccessToken() {
    var res = await fetch('/fx/api/auth/session', { credentials: 'include' })
    if (!res.ok) return null
    var json = await res.json().catch(function () { return null })
    return json && json.access_token ? json.access_token : null
  }

  function getRecaptchaToken(action) {
    return new Promise(function (resolve, reject) {
      if (!window.grecaptcha || !window.grecaptcha.enterprise) {
        reject(new Error('grecaptcha.enterprise is not loaded on this page'))
        return
      }
      window.grecaptcha.enterprise.ready(function () {
        window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: action })
          .then(resolve, reject)
      })
    })
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  async function callSandboxApi(path, body, token) {
    var res = await fetch(AISANDBOX_API + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: JSON.stringify(body),
    })
    var text = await res.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}
    return { status: res.status, json: json, raw: text }
  }

  function safe(value) {
    try { return JSON.parse(JSON.stringify(value)) } catch (e) { return null }
  }
`

function buildScript(body: string): string {
  return `(async function () {
${PRELUDE}
    try {
${body}
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

/**
 * Creates a new Flow project.
 *
 * Captured from a real click on "New project":
 *
 *   POST /fx/api/trpc/project.createProject
 *   { "json": { "projectTitle": "<title>", "toolName": "PINHOLE" } }
 *   -> 200 { "result": { "data": { "json": { "result": {
 *        "projectId": "<uuid>", "projectInfo": { "projectTitle": "<title>" }
 *      }, "status": 200, "statusText": "OK" } } } }
 *
 * Plain same-origin tRPC over labs.google — no recaptcha, no
 * aisandbox-pa.googleapis.com involved, unlike image generation.
 */
export function createProjectScript(projectTitle: string): string {
  return buildScript(`
    var projectTitle = ${JSON.stringify(projectTitle)}
    var res = await fetch('/fx/api/trpc/project.createProject', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'accept': '*/*' },
      body: JSON.stringify({ json: { projectTitle: projectTitle, toolName: 'PINHOLE' } }),
    })
    var text = await res.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}

    var inner = json && json.result && json.result.data && json.result.data.json && json.result.data.json.result
    if (res.status !== 200 || !inner || !inner.projectId) {
      return {
        ok: false,
        error: 'Google Flow did not confirm the new project (HTTP ' + res.status + ')',
        detail: text ? text.slice(0, 400) : null,
      }
    }

    return { ok: true, created: true, projectId: inner.projectId, projectTitle: inner.projectInfo ? inner.projectInfo.projectTitle : projectTitle }
  `)
}

/**
 * Generates one image in an existing Flow project.
 *
 * `projectId` must come from an already-open project's URL
 * (`labs.google/fx/tools/flow/project/<projectId>`) — creating a new
 * project has not been captured/verified yet, so is not offered here.
 *
 * Matches the real captured request exactly: the recaptcha token appears at
 * both the outer `clientContext` and the per-request `clientContext` — both
 * were present on the request that returned 200 with real image data, and
 * dropping either is exactly the "hand-picked subset" mistake this project's
 * own findings already document from the Facebook comment mutation.
 */
export function generateImageScript(
  prompt: string,
  projectId: string,
  aspectRatio: ImageAspectRatio = 'LANDSCAPE',
  imageModel: ImageModel = 'NANO_BANANA_PRO',
  referenceMediaIds: string[] = [],
): string {
  return buildScript(`
    var token = await getAccessToken()
    if (!token) return { ok: false, error: 'no Google access token found — not signed in to Google Flow, or the session has expired' }

    var recaptchaToken
    try {
      recaptchaToken = await getRecaptchaToken('IMAGE_GENERATION')
    } catch (e) {
      return { ok: false, error: 'reCAPTCHA failed: ' + String((e && e.message) || e) }
    }

    var projectId = ${JSON.stringify(projectId)}
    var clientContext = {
      recaptchaContext: { token: recaptchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
      projectId: projectId,
      tool: 'PINHOLE',
      sessionId: ';' + Date.now(),
    }

    var body = {
      clientContext: clientContext,
      mediaGenerationContext: { batchId: uuid() },
      useNewMedia: true,
      requests: [{
        clientContext: clientContext,
        imageModelName: ${JSON.stringify(IMAGE_MODEL_MAP[imageModel])},
        imageAspectRatio: ${JSON.stringify(ASPECT_RATIO_MAP[aspectRatio])},
        structuredPrompt: { parts: [{ text: ${JSON.stringify(prompt)} }] },
        seed: Math.floor(Math.random() * 1000000),
        imageInputs: ${JSON.stringify(referenceMediaIds)}.map(function (mediaId) {
          return { name: mediaId, imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE' }
        }),
      }],
    }

    var res = await callSandboxApi('/v1/projects/' + projectId + '/flowMedia:batchGenerateImages', body, token)

    var media = res.json && res.json.media
    if (res.status !== 200 || !media || !media.length) {
      return {
        ok: false,
        error: 'Google Flow did not confirm the image (HTTP ' + res.status + ')',
        detail: res.raw ? res.raw.slice(0, 400) : null,
      }
    }

    var mediaId = media[0].name
    return {
      ok: true,
      generated: true,
      mediaId: mediaId,
      // The generate response does not carry a viewable URL — the real
      // client fetches one separately via this same tRPC redirect endpoint.
      viewUrl: 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=' + mediaId + '&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL',
      raw: safe(media[0]),
    }
  `)
}

/**
 * Uploads an image (base64) so it can be used as a reference or as a
 * video's start/end frame. Returns a mediaId usable with
 * `generateImageScript`'s `referenceMediaIds` or `generateVideoScript`.
 *
 * From the reference kit's `upload_image` (`/v1/flow/uploadImage`), not yet
 * independently captured against this project's own session — see the
 * header comment.
 */
export function uploadImageScript(
  imageBase64: string,
  projectId: string,
  mimeType: string = 'image/jpeg',
  fileName: string = 'image.jpg',
): string {
  return buildScript(`
    var token = await getAccessToken()
    if (!token) return { ok: false, error: 'no Google access token found — not signed in to Google Flow, or the session has expired' }

    var body = {
      clientContext: { projectId: ${JSON.stringify(projectId)}, tool: 'PINHOLE' },
      fileName: ${JSON.stringify(fileName)},
      imageBytes: ${JSON.stringify(imageBase64)},
      isHidden: false,
      isUserUploaded: true,
      mimeType: ${JSON.stringify(mimeType)},
    }

    var res = await callSandboxApi('/v1/flow/uploadImage', body, token)
    var media = res.json && res.json.media
    if (res.status !== 200 || !media || !media.name) {
      return {
        ok: false,
        error: 'Google Flow did not confirm the upload (HTTP ' + res.status + ')',
        detail: res.raw ? res.raw.slice(0, 400) : null,
      }
    }

    return { ok: true, uploaded: true, mediaId: media.name }
  `)
}

/**
 * Generates a short video, in one of two modes Flow's own UI offers:
 *
 * - `INGREDIENTS`: one or more reference images, composed into a video
 *   (`POST /v1/video:batchAsyncGenerateVideoReferenceImages`,
 *   `referenceImages: [{ mediaId, imageUsageType: "IMAGE_USAGE_TYPE_ASSET" }]`).
 * - `FRAMES`: a single start image animated
 *   (`POST /v1/video:batchAsyncGenerateVideoStartImage`,
 *   `startImage: { mediaId }`).
 *
 * Both endpoints share the same envelope — only ONE `clientContext` (unlike
 * image generation's two), `userPaygateTier` sitting directly on it, and the
 * same response shape (`workflows[0].metadata.primaryMediaId` is what
 * `getVideoStatusScript` polls, NOT `workflows[0].name`).
 *
 * ── Two models, three confirmed combinations, one confirmed unsupported ──
 *
 * | model | mode | key | how confirmed |
 * |---|---|---|---|
 * | Veo 3.1 Lite | INGREDIENTS | `veo_3_1_r2v_lite` | 2 live generations |
 * | Omni Flash | INGREDIENTS | `abra_r2v_6s` | 1 live generation |
 * | Omni Flash | FRAMES | `abra_i2v_6s` | 1 live generation |
 *
 * Veo 3.1 Lite + FRAMES has NOT been captured — the reference kit's
 * `models.json` suggests a name for it, but two other values from that same
 * table (this project's own earlier `abra_r2v_6s` guess, and a start-image
 * model key) turned out wrong when checked, so it is not extrapolated to
 * here; requesting it returns a clear error instead of a guess.
 *
 * An end frame (`endImage`) was tried with Omni Flash FRAMES and Google's
 * own API rejected it outright: `"Unknown name \\"endImage\\" at
 * 'requests[0]': Cannot find field."` — Omni Flash's FRAMES mode does not
 * support an end frame at all, confirmed by the server's own error, not
 * inferred. Whether Veo 3.1 Lite's FRAMES mode (unconfirmed either way)
 * would accept one is unknown, so `endImageMediaId` is not offered on any
 * model until that is captured. `startImage`'s real captured shape also
 * carried a `cropCoordinates` object (the UI's own crop rectangle) — omitted
 * here as untested-necessary rather than guessed, following this project's
 * own rule against including a field never confirmed required.
 *
 * Omni Flash's model key names bake the duration into the key itself
 * (`_6s`) — the user selected 6s here; 4s/8s/10s almost certainly exist as
 * sibling keys (`abra_r2v_4s`, etc.) but none of those has been captured,
 * so only 6s is offered.
 */
export type VideoModel = 'VEO_3_1_LITE' | 'OMNI_FLASH'
export type VideoMode = 'INGREDIENTS' | 'FRAMES'

const VIDEO_MODEL_KEYS: Record<VideoModel, Partial<Record<VideoMode, string>>> = {
  VEO_3_1_LITE: { INGREDIENTS: 'veo_3_1_r2v_lite' },
  OMNI_FLASH: { INGREDIENTS: 'abra_r2v_6s', FRAMES: 'abra_i2v_6s' },
}

export function generateVideoScript(
  mode: VideoMode,
  model: VideoModel,
  mediaIds: string[],
  prompt: string,
  projectId: string,
  userPaygateTier: string = 'PAYGATE_TIER_ONE',
): string {
  const modelKey = VIDEO_MODEL_KEYS[model][mode]
  if (!modelKey) {
    return buildScript(`
      return { ok: false, error: ${JSON.stringify(`${model} does not have a confirmed model key for ${mode} mode yet`)} }
    `)
  }

  const endpoint = mode === 'INGREDIENTS'
    ? '/v1/video:batchAsyncGenerateVideoReferenceImages'
    : '/v1/video:batchAsyncGenerateVideoStartImage'

  const mediaField = mode === 'INGREDIENTS'
    ? `referenceImages: ${JSON.stringify(mediaIds)}.map(function (mediaId) {
          return { mediaId: mediaId, imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' }
        }),`
    : `startImage: { mediaId: ${JSON.stringify(mediaIds[0] ?? '')} },`

  return buildScript(`
    var token = await getAccessToken()
    if (!token) return { ok: false, error: 'no Google access token found — not signed in to Google Flow, or the session has expired' }

    var recaptchaToken
    try {
      recaptchaToken = await getRecaptchaToken('VIDEO_GENERATION')
    } catch (e) {
      return { ok: false, error: 'reCAPTCHA failed: ' + String((e && e.message) || e) }
    }

    var body = {
      mediaGenerationContext: { batchId: uuid(), audioFailurePreference: 'BLOCK_SILENCED_VIDEOS' },
      clientContext: {
        projectId: ${JSON.stringify(projectId)},
        tool: 'PINHOLE',
        userPaygateTier: ${JSON.stringify(userPaygateTier)},
        sessionId: ';' + Date.now(),
        recaptchaContext: { token: recaptchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
      },
      requests: [{
        outputSpec: { resolution: 'VIDEO_RESOLUTION_720P' },
        aspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT',
        textInput: { structuredPrompt: { parts: [{ text: ${JSON.stringify(prompt)} }] } },
        videoModelKey: ${JSON.stringify(modelKey)},
        seed: Math.floor(Math.random() * 100000),
        metadata: {},
        ${mediaField}
      }],
      useV2ModelConfig: true,
    }

    var res = await callSandboxApi(${JSON.stringify(endpoint)}, body, token)
    var workflow = res.json && res.json.workflows && res.json.workflows[0]
    var mediaId = workflow && workflow.metadata ? workflow.metadata.primaryMediaId : null
    if (res.status !== 200 || !mediaId) {
      return {
        ok: false,
        error: 'Google Flow did not confirm the video request (HTTP ' + res.status + ')',
        detail: res.raw ? res.raw.slice(0, 400) : null,
      }
    }

    // Async — this confirms the request was accepted and returns the id to
    // poll with getVideoStatusScript, not a finished video.
    return { ok: true, submitted: true, mediaId: mediaId, workflowId: workflow.name, remainingCredits: res.json.remainingCredits }
  `)
}

/**
 * Polls a submitted video's status. `mediaId` is the `mediaId` returned by
 * `generateVideoScript`, NOT its `workflowId`.
 *
 * Captured from a real completed video:
 *
 *   POST /v1/video:batchCheckAsyncVideoGenerationStatus
 *   { media: [{ name: mediaId, projectId }] }
 *   -> 200 { media: [{ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL" } },
 *                       video: { generatedVideo: {...}, dimensions: { length: "8s" } } }] }
 */
export function getVideoStatusScript(mediaId: string, projectId: string): string {
  return buildScript(`
    var token = await getAccessToken()
    if (!token) return { ok: false, error: 'no Google access token found — not signed in to Google Flow, or the session has expired' }

    var res = await callSandboxApi('/v1/video:batchCheckAsyncVideoGenerationStatus', {
      media: [{ name: ${JSON.stringify(mediaId)}, projectId: ${JSON.stringify(projectId)} }],
    }, token)

    var media = res.json && res.json.media && res.json.media[0]
    if (res.status !== 200 || !media) {
      return { ok: false, error: 'Google Flow did not return video status (HTTP ' + res.status + ')', detail: res.raw ? res.raw.slice(0, 400) : null }
    }

    var status = media.mediaMetadata && media.mediaMetadata.mediaStatus ? media.mediaMetadata.mediaStatus.mediaGenerationStatus : null
    return {
      ok: true,
      status: status,
      done: status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL',
      raw: safe(media),
    }
  `)
}

/**
 * Reads the account's real Flow tier and remaining VIDEO credits.
 *
 *   GET /v1/credits?key=...
 *   -> 200 { credits, userPaygateTier, sku, serviceTier, subscriptionCredits }
 *
 * This is video credits ONLY. Image generation is not credited here at
 * all — confirmed by checking every captured response across this whole
 * project for any quota/daily-limit field: none exists anywhere. Google
 * Flow's image daily limit is enforced silently server-side with no
 * queryable remaining-count; the only way to learn its shape is to hit it
 * and capture the resulting error, which has not happened yet.
 */
export function getCreditsScript(): string {
  return buildScript(`
    var token = await getAccessToken()
    if (!token) return { ok: false, error: 'no Google access token found — not signed in to Google Flow, or the session has expired' }

    var res = await fetch(AISANDBOX_API + '/v1/credits?key=' + AISANDBOX_API_KEY, { headers: { 'Authorization': 'Bearer ' + token } })
    var text = await res.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}

    if (res.status !== 200 || !json) {
      return { ok: false, error: 'Google Flow did not return credits (HTTP ' + res.status + ')', detail: text ? text.slice(0, 400) : null }
    }

    return { ok: true, tier: json.userPaygateTier || null, raw: safe(json) }
  `)
}

export const __testing = { AISANDBOX_API, RECAPTCHA_SITE_KEY, AISANDBOX_API_KEY, ASPECT_RATIO_MAP, IMAGE_MODEL_MAP, VIDEO_MODEL_KEYS, buildScript }

