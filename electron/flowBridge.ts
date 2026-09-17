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


  /**
   * One batchexecute call. Every Flow RPC on flow.google.com goes through this
   * envelope, so the framing lives in exactly one place -- the argument is a
   * JSON *string* inside the array, and the reply is )]}' followed by
   * alternating length/JSON lines whose count varies, so the result row is
   * searched for by rpcid rather than indexed.
   *
   * at / bl / f.sid are per-session and come from the page; see
   * probes/flow-01-boq-params.js for how each key was confirmed.
   */
  async function callBatch(rpcId, arg) {
    var wiz = window.WIZ_global_data
    if (!wiz || !wiz.SNlM0e) {
      return { ok: false, error: 'Flow page has no session token yet (WIZ_global_data.SNlM0e missing) -- let the page finish loading and retry' }
    }

    var form = new URLSearchParams()
    form.set('f.req', JSON.stringify([[[rpcId, JSON.stringify(arg), null, 'generic']]]))
    form.set('at', wiz.SNlM0e)

    var query = new URLSearchParams()
    query.set('rpcids', rpcId)
    query.set('source-path', '/')
    if (wiz.cfb2h) query.set('bl', wiz.cfb2h)
    if (wiz.FdrFJe) query.set('f.sid', wiz.FdrFJe)
    query.set('hl', 'en-US')
    query.set('_reqid', String(Math.floor(Math.random() * 900000) + 100000))
    query.set('rt', 'c')

    var res = await fetch('/_/AiSandboxAngularFrontend/data/batchexecute?' + query.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
    })
    var text = await res.text()
    if (res.status !== 200) {
      return { ok: false, error: 'Google Flow refused the request (HTTP ' + res.status + ')', detail: text.slice(0, 300) }
    }

    var payload = null
    var lines = text.split(String.fromCharCode(10))
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim()
      if (line.charAt(0) !== '[') continue
      var rows = null
      try { rows = JSON.parse(line) } catch (e) { continue }
      if (!Array.isArray(rows)) continue
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j]
        if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && typeof row[2] === 'string') {
          try { payload = JSON.parse(row[2]) } catch (e) {}
        }
      }
    }
    if (payload === null) {
      return { ok: false, error: 'Google Flow answered but carried no ' + rpcId + ' result', detail: text.slice(0, 300) }
    }
    return { ok: true, payload: payload }
  }

  /** Uppercase UUID, matching the casing every captured Flow request used. */
  function uuidUpper() {
    return uuid().toUpperCase()
  }

  /**
   * The client-context block every Flow RPC carries. Captured identically at
   * two levels inside image and video generation, so it is built once here
   * rather than written out twice and drifting.
   */
  function clientContext(projectId, recaptchaToken) {
    return [null, 22, null, null, null, projectId, null, null, null, null, [recaptchaToken, 1]]
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

export type VideoModel = 'VEO_3_1_LITE' | 'OMNI_FLASH'
export type VideoMode = 'INGREDIENTS' | 'FRAMES'

const VIDEO_MODEL_KEYS: Record<VideoModel, Partial<Record<VideoMode, string>>> = {
  VEO_3_1_LITE: { INGREDIENTS: 'veo_3_1_r2v_lite' },
  OMNI_FLASH: { INGREDIENTS: 'abra_r2v_6s', FRAMES: 'abra_i2v_6s' },
}

export const __testing = { AISANDBOX_API, RECAPTCHA_SITE_KEY, AISANDBOX_API_KEY, ASPECT_RATIO_MAP, IMAGE_MODEL_MAP, VIDEO_MODEL_KEYS, buildScript }

/* ─────────────────────────────────────────────────────────────────────────
 * Flow's current API (flow.google.com, batchexecute).
 *
 * Every script below was written from a request the owner actually made on
 * 2026-09-17 while the recorder was attached — create, rename, generate image,
 * generate video — not from the reference kit and not from the retired
 * labs.google tRPC API, which the same capture proved is gone (see
 * probes/FINDINGS-flow.md).
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Creates a project.
 *
 *   jHPbke ["projects/*",[null,["<title>"]],[null,22]]
 *     -> ["<newProjectId>",["<title>"]]
 *
 * Flow's own UI creates with a timestamp title and renames afterwards, so a
 * title given here is simply the title it is created with — no second call.
 */
export function createProjectScript(projectTitle: string): string {
  return buildScript(`
    var title = ${JSON.stringify(projectTitle)}
    var out = await callBatch('jHPbke', ['projects/*', [null, [title]], [null, 22]])
    if (!out.ok) return out

    var projectId = Array.isArray(out.payload) ? out.payload[0] : null
    if (typeof projectId !== 'string' || !projectId) {
      return { ok: false, error: 'Google Flow did not return a project id', detail: JSON.stringify(out.payload).slice(0, 300) }
    }
    var returnedTitle = Array.isArray(out.payload[1]) ? out.payload[1][0] : title
    return { ok: true, created: true, projectId: projectId, projectTitle: returnedTitle }
  `)
}

/**
 * Renames a project.
 *
 *   o8DA4 ["projects/<id>",["<title>"],[["project_title"]],[null,22]]
 *     -> ["<title>"]
 *
 * The third element is a field mask naming what is being written. New
 * capability: the retired API had no rename at all, so a project's name was
 * fixed at creation.
 */
export function renameProjectScript(projectId: string, projectTitle: string): string {
  return buildScript(`
    var id = ${JSON.stringify(projectId)}
    var title = ${JSON.stringify(projectTitle)}
    var out = await callBatch('o8DA4', ['projects/' + id, [title], [['project_title']], [null, 22]])
    if (!out.ok) return out

    var confirmed = Array.isArray(out.payload) ? out.payload[0] : null
    if (confirmed !== title) {
      return { ok: false, error: 'Google Flow did not confirm the new title', detail: JSON.stringify(out.payload).slice(0, 300) }
    }
    return { ok: true, renamed: true, projectId: id, projectTitle: confirmed }
  `)
}

/**
 * Lists a project's media.
 *
 *   Zzl0ze ["projects/<id>",null,null,null,[1]]
 *     -> [null,null,null,[["<mediaId>",1,"<prompt>", ...
 *
 * Walked rather than indexed: the entries sit several levels down and the
 * wrapper shape is not something one capture can promise stays fixed.
 */
export function listProjectMediaScript(projectId: string): string {
  return buildScript(`
    var id = ${JSON.stringify(projectId)}
    var out = await callBatch('Zzl0ze', ['projects/' + id, null, null, null, [1]])
    if (!out.ok) return out

    var media = []
    function walk(node, depth) {
      if (!Array.isArray(node) || depth > 6) return
      if (typeof node[0] === 'string' && node[0].length > 20 && typeof node[2] === 'string') {
        media.push({ mediaId: node[0], prompt: node[2] })
        return
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1)
    }
    walk(out.payload, 0)
    return { ok: true, count: media.length, media: media }
  `)
}

/**
 * Generates one image.
 *
 *   ogiZ0b [null,[[null,null,null,<seed>,3,"NARWHAL",null,<ctx>,[[["<prompt>"]]],
 *                 null,null,null,"<uuid>","<uuid>"]],1,<ctx>,["<uuid>"]]
 *
 * `<ctx>` is the client context, and the recaptcha token inside it appears at
 * TWO levels — exactly as the retired aisandbox call required. Dropping either
 * is the "hand-picked subset" mistake this project's findings already record.
 *
 * The aspect-ratio enums the old API took have no visible slot in this payload;
 * only the captured combination is sent, and the tool no longer offers a ratio
 * it cannot demonstrate.
 */
export function generateImageScript(prompt: string, projectId: string, imageModel: ImageModel): string {
  return buildScript(`
    var prompt = ${JSON.stringify(prompt)}
    var projectId = ${JSON.stringify(projectId)}
    var model = ${JSON.stringify('')} || ${JSON.stringify(IMAGE_MODEL_MAP)}[${JSON.stringify(imageModel)}]

    var token
    try {
      token = await getRecaptchaToken('IMAGE_GENERATION')
    } catch (e) {
      return { ok: false, error: 'could not mint a reCAPTCHA token: ' + String((e && e.message) || e) }
    }

    var ctx = clientContext(projectId, token)
    var seed = Math.floor(Math.random() * 2000000000)
    var arg = [
      null,
      [[null, null, null, seed, 3, model, null, ctx, [[[prompt]]], null, null, null, uuidUpper(), uuidUpper()]],
      1,
      ctx,
      [uuidUpper()],
    ]

    var out = await callBatch('ogiZ0b', arg)
    if (!out.ok) return out
    return { ok: true, requested: true, model: model, seed: seed, result: safe(out.payload) }
  `)
}

/**
 * Generates one video.
 *
 *   YhhmEf [[[[null,null,[[["<prompt>"]]]],"<modelKey>",1,null,
 *             [null,null,null,null,"<uuid>","<uuid>"]]],<ctx>,["<uuid>",2]]
 *     -> [null,<creditsLeft>,[["<operationId>",null,null,["<title>",…,"<mediaId>",…
 *
 * The model key is passed through verbatim rather than mapped through a table:
 * `videoModelsScript` reads the valid keys from Flow itself, and this file's
 * own history records the reference kit's model table being wrong.
 */
export function generateVideoScript(prompt: string, projectId: string, modelKey: string): string {
  return buildScript(`
    var prompt = ${JSON.stringify(prompt)}
    var projectId = ${JSON.stringify(projectId)}
    var modelKey = ${JSON.stringify(modelKey)}

    var token
    try {
      token = await getRecaptchaToken('VIDEO_GENERATION')
    } catch (e) {
      return { ok: false, error: 'could not mint a reCAPTCHA token: ' + String((e && e.message) || e) }
    }

    var arg = [
      [[[null, null, [[[prompt]]]], modelKey, 1, null, [null, null, null, null, uuidUpper(), uuidUpper()]]],
      clientContext(projectId, token),
      [uuidUpper(), 2],
    ]

    var out = await callBatch('YhhmEf', arg)
    if (!out.ok) return out

    // Second element was the credit balance after the captured generation.
    // Reported as an unlabelled number rather than named "credits": the
    // meaning is consistent with the balance nzlxg returns but is not proven.
    var creditsAfter = Array.isArray(out.payload) && typeof out.payload[1] === 'number' ? out.payload[1] : null
    return { ok: true, requested: true, model: modelKey, creditsAfterIfThatIsWhatItIs: creditsAfter, result: safe(out.payload) }
  `)
}

/**
 * The video model keys Flow itself accepts.
 *
 *   yBhWQ [] -> [[["veo_3_1_quality",1],["veo_3_1_lite",1],["abra",1], …
 */
export function videoModelsScript(): string {
  return buildScript(`
    var out = await callBatch('yBhWQ', [])
    if (!out.ok) return out

    var models = []
    function walk(node, depth) {
      if (!Array.isArray(node) || depth > 5) return
      if (typeof node[0] === 'string' && node[0].length > 2 && typeof node[1] === 'number') {
        models.push(node[0])
        return
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1)
    }
    walk(out.payload, 0)
    return { ok: true, models: models }
  `)
}

/**
 * Looks up one media item, by the id a generation returned.
 *
 *   jwpduf [null,null,[["<mediaId>"]]]
 *
 * Captured immediately after video generation with the id that generation
 * returned, which is what a poll looks like — but this capture does not show
 * it being called repeatedly, so it is exposed as a lookup rather than
 * described as a progress API.
 */
export function mediaStatusScript(mediaId: string): string {
  return buildScript(`
    var out = await callBatch('jwpduf', [null, null, [[${JSON.stringify(mediaId)}]]])
    if (!out.ok) return out
    return { ok: true, media: safe(out.payload) }
  `)
}

/**
 * Returns the numbers Flow reports for this account.
 *
 *   nzlxg [] -> [1050,1,2,2,null,1050]
 *
 * Deliberately unlabelled. 1050 looked like a credit balance and the number
 * after one video generation was 1038, which is consistent — consistent is not
 * proof, and naming these fields "credits" on that basis is exactly the
 * confident-sounding guess this file exists to avoid. Compare against the
 * balance Flow's own UI shows to settle it.
 */
export function getCreditsScript(): string {
  return buildScript(`
    var out = await callBatch('nzlxg', [])
    if (!out.ok) return out
    return {
      ok: true,
      raw: safe(out.payload),
      note: 'Unlabelled on purpose: the first and last numbers behave like a credit balance but that has not been verified against the figure Flow shows in its own UI.',
    }
  `)
}

/**
 * Lists the Google Flow projects this account owns.
 *
 *   UpteDb ["projects/*",21,null,null,null,null,[1]]
 *     -> [[["<projectId>",["<title>",null,[<seconds>,<nanos>],"<thumbUrl>"]], …]]
 *
 * The first call written against Flow's current frontend, and the one that
 * live-tested at 21 real projects. Walked rather than indexed at a fixed
 * depth, so an extra wrapper level in a future response returns nothing rather
 * than silently returning zero projects.
 */
export function listProjectsScript(): string {
  return buildScript(`
    var out = await callBatch('UpteDb', ['projects/*', 21, null, null, null, null, [1]])
    if (!out.ok) return out

    var projects = []
    function walk(node, depth) {
      if (!Array.isArray(node) || depth > 6) return
      var id = node[0]
      var meta = node[1]
      if (typeof id === 'string' && id.length > 20 && Array.isArray(meta) && typeof meta[0] === 'string') {
        var created = Array.isArray(meta[2]) && typeof meta[2][0] === 'number' ? new Date(meta[2][0] * 1000).toISOString() : null
        projects.push({ projectId: id, title: meta[0], createdAt: created, thumbnailUrl: typeof meta[3] === 'string' ? meta[3] : null })
        return
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1)
    }
    walk(out.payload, 0)
    return { ok: true, count: projects.length, projects: projects }
  `)
}


/**
 * Deletes a project.
 *
 *   QI2zvc ["projects/<id>"] -> []
 *
 * Captured deleting the throwaway probe project. The empty reply carries no
 * confirmation of any kind, so this reports what it asked for rather than
 * claiming the project is gone — there is nothing in the answer to check.
 */
export function deleteProjectScript(projectId: string): string {
  return buildScript(`
    var id = ${JSON.stringify(projectId)}
    var out = await callBatch('QI2zvc', ['projects/' + id])
    if (!out.ok) return out
    return {
      ok: true,
      requested: true,
      projectId: id,
      note: 'Flow answers a delete with an empty result, so this confirms the request was accepted, not that the project is gone. List projects to verify.',
    }
  `)
}

/**
 * Uploads a local image and returns its media id.
 *
 *   maseQ [<ctx>,"<base64>","<mimeType>",1,null,null,null,null,"<fileName>",
 *          null,"<uuid>","<uuid>"]
 *     -> [["<mediaId>","<projectId>", …
 *
 * The first capture of this was cut off at the recorder's 200KB payload limit,
 * which showed the base64 but not what followed it. Re-captured with a small
 * image so the whole shape was visible — the tail (mime type, file name, the
 * two uuids) would otherwise have been guesswork.
 */
export function uploadImageScript(base64: string, projectId: string, mimeType: string, fileName: string): string {
  return buildScript(`
    var projectId = ${JSON.stringify(projectId)}
    var token
    try {
      token = await getRecaptchaToken('IMAGE_UPLOAD')
    } catch (e) {
      return { ok: false, error: 'could not mint a reCAPTCHA token: ' + String((e && e.message) || e) }
    }

    var arg = [
      clientContext(projectId, token),
      ${JSON.stringify(base64)},
      ${JSON.stringify(mimeType)},
      1, null, null, null, null,
      ${JSON.stringify(fileName)},
      null,
      uuidUpper(), uuidUpper(),
    ]

    var out = await callBatch('maseQ', arg)
    if (!out.ok) return out

    var first = Array.isArray(out.payload) ? out.payload[0] : null
    var mediaId = Array.isArray(first) ? first[0] : null
    if (typeof mediaId !== 'string' || !mediaId) {
      return { ok: false, error: 'Google Flow did not return a media id for the upload', detail: JSON.stringify(out.payload).slice(0, 300) }
    }
    return { ok: true, uploaded: true, mediaId: mediaId, fileName: ${JSON.stringify(fileName)} }
  `)
}

/**
 * Fetches the bytes of one media item.
 *
 * There is no download *request* to copy. Flow's own download button builds a
 * Blob in the page and saves it — the capture shows `blob:https://flow.google.com/…`
 * and no network call at all. What it saves was already fetched when the media
 * was displayed, from `https://flow.google.com/asb/<token>` (same origin, plain
 * GET, image/webp).
 *
 * So this fetches that URL directly. The URL comes from a listing
 * (`listProjectsScript` thumbnails, `listProjectMediaScript`) rather than being
 * constructed, because the token in it is opaque and not derivable from a media
 * id.
 */
export function fetchMediaUrlScript(mediaUrl: string): string {
  return buildScript(`
    var url = ${JSON.stringify(mediaUrl)}
    if (url.indexOf('/asb/') === -1 && url.indexOf('googleusercontent.com') === -1) {
      return { ok: false, error: 'refusing to fetch a URL that is not a Flow media URL: ' + url.slice(0, 80) }
    }

    var res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return { ok: false, error: 'media fetch failed (HTTP ' + res.status + ') -- Flow media URLs expire, so re-list the project and try the fresh URL' }

    var blob = await res.blob()
    var base64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onerror = function () { reject(new Error('could not read the media bytes')) }
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || '') }
      reader.readAsDataURL(blob)
    })
    return { ok: true, contentType: blob.type || 'image/webp', byteSize: blob.size, base64: base64 }
  `)
}

/**
 * Generates a video from an existing image as its first frame.
 *
 *   MZZa6b [[[[null,null,[[["<prompt>"]]]],[[null,"<mediaId>"]],"<modelKey>",1,
 *             null,[null,null,null,null,"<uuid>","<uuid>"]]],<ctx>,["<uuid>",2]]
 *
 * Same envelope as text-to-video with one extra element: the source media id.
 * The captured model key was `abra_r2v_10s` — r2v where text-to-video used
 * t2v — so the key is passed through rather than mapped, as elsewhere here.
 */
export function generateVideoFromImageScript(prompt: string, projectId: string, mediaId: string, modelKey: string): string {
  return buildScript(`
    var token
    try {
      token = await getRecaptchaToken('VIDEO_GENERATION')
    } catch (e) {
      return { ok: false, error: 'could not mint a reCAPTCHA token: ' + String((e && e.message) || e) }
    }

    var arg = [
      [[
        [null, null, [[[${JSON.stringify(prompt)}]]]],
        [[null, ${JSON.stringify(mediaId)}]],
        ${JSON.stringify(modelKey)},
        1,
        null,
        [null, null, null, null, uuidUpper(), uuidUpper()],
      ]],
      clientContext(${JSON.stringify(projectId)}, token),
      [uuidUpper(), 2],
    ]

    var out = await callBatch('MZZa6b', arg)
    if (!out.ok) return out
    return { ok: true, requested: true, model: ${JSON.stringify(modelKey)}, result: safe(out.payload) }
  `)
}

/**
 * Extends an existing video.
 *
 *   jIps6 [[[[null,"<sourceVideoId>",<startFrame>,<endFrame>],
 *            [null,null,[[["<prompt>"]]]],"abra_edit",1,
 *            [null,"<sceneId>",null,null,"<uuid>"]]],<ctx>,["<uuid>",2]]
 *
 * The captured call used frames 0..240 of the source and the model key
 * `abra_edit`. Both are sent as captured: the frame range is the only one
 * demonstrated, and inventing a different one would be inventing behaviour.
 */
export function extendVideoScript(prompt: string, projectId: string, sourceVideoId: string, sceneId: string): string {
  return buildScript(`
    var token
    try {
      token = await getRecaptchaToken('VIDEO_GENERATION')
    } catch (e) {
      return { ok: false, error: 'could not mint a reCAPTCHA token: ' + String((e && e.message) || e) }
    }

    var arg = [
      [[
        [null, ${JSON.stringify(sourceVideoId)}, 0, 240],
        [null, null, [[[${JSON.stringify(prompt)}]]]],
        'abra_edit',
        1,
        [null, ${JSON.stringify(sceneId)}, null, null, uuidUpper()],
      ]],
      clientContext(${JSON.stringify(projectId)}, token),
      [uuidUpper(), 2],
    ]

    var out = await callBatch('jIps6', arg)
    if (!out.ok) return out
    return { ok: true, requested: true, result: safe(out.payload) }
  `)
}
