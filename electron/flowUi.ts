/**
 * Google Flow driven through its own page, the way a person uses it.
 *
 * Generation requests are never built here: FlowDesk sets the prompt bar's
 * settings, attaches images, types the prompt and presses the page's own
 * Start button with real (CDP) input, and Flow's own code builds and sends
 * every request. Sending generate RPCs directly got PUBLIC_ERROR_UNUSUAL_ACTIVITY
 * since Flow's build of 2026-09-22 (docs/flow-unusual-activity-research.md).
 *
 * The prompt bar, read off the live page (probes flv-01..10, 2026-10-13):
 *   - "Settings trigger" opens a popover: Image | Video; Frames | Ingredients
 *     (video); ratio radios; "Select model family" menu (video: Omni 1.1 Flash,
 *     Veo 3.1 - Lite/Fast/Quality; image: Nano Banana Pro/2 Lite/2.1);
 *     360p | 720p; 4s 6s 8s 10s; x1..x4; "Generating will use N credits".
 *   - "Agent" chip (aria-pressed) hands the prompt to Flow's agent; kept off.
 *   - Grid tiles: img[data-media-id] (images); the tile's "More options" menu
 *     has "Add to prompt": in Frames mode it fills Start then End, in
 *     Ingredients mode it adds a chip whose img src carries the media id.
 *   - "Add ingredients to the prompt box" -> "Upload media" takes local files.
 *   - "Clear prompt" empties the bar; "Start generation" sends it.
 */
import type { WebContents } from 'electron'
import { withFlowPage, flowIdError, type FlowResult } from './flow'
import { listProjectMediaScript, mediaStatusScript } from './flowBridge'
import { withCdp, waitFor } from './chatgptImages'
import { readLocalImage } from './localImageFile'
import { flowHold, heldError, holdFlowAccount, UNUSUAL_ACTIVITY } from './flowHolds'

export const FLOW_UI_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const
export const FLOW_VIDEO_RATIOS = ['16:9', '9:16'] as const
export const FLOW_VIDEO_RESOLUTIONS = ['360p', '720p'] as const
export const FLOW_VIDEO_SECONDS = [4, 6, 8, 10] as const
export const MAX_INGREDIENTS = 7
export type FlowUiRatio = typeof FLOW_UI_RATIOS[number]
const MAX_PROMPT = 8000
const IMAGE_TIMEOUT_MS = 4 * 60_000
const SUBMIT_WAIT_MS = 60_000

export function checkRatio(r: unknown, allowed: readonly string[] = FLOW_UI_RATIOS): string | null | { error: string } {
  if (r == null || r === '') return null
  return allowed.includes(String(r)) ? String(r) : { error: `aspectRatio must be one of ${allowed.join(', ')}` }
}

export function checkCount(n: unknown): number | null | { error: string } {
  if (n == null || n === '') return null
  const v = Number(n)
  return Number.isInteger(v) && v >= 1 && v <= 4 ? v : { error: 'count must be 1, 2, 3 or 4' }
}

/** Menu labels carry an emoji or an icon name ("🍌 Nano Banana 2", "volume_up Veo 3.1 - Fast"). */
export function modelName(label: string): string {
  return label
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/^\s*[a-z0-9]+(_[a-z0-9]+)+\s+/, '')
    .replace(/[^\p{L}\p{N} .-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function newMediaIds(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before)
  return after.filter(id => !seen.has(id))
}

interface Point { x: number; y: number }
type Spec =
  | { aria: string }
  | { radio: string }
  | { menu: string }
  | { menuEnds: string }
  | { tileMenu: string }
  | { buttonText: string }
  | { prompt: true }

/** One visible control's centre, or null. */
function locateScript(spec: Spec): string {
  return `(function () {
    var spec = ${JSON.stringify(spec)}
    function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    function txt(el) { return (el.innerText || '').replace(/\\s+/g, ' ').trim() }
    function clean(s) { return s.replace(/\\p{Extended_Pictographic}/gu, '').replace(/^\\s*[a-z0-9]+(_[a-z0-9]+)+\\s+/, '').replace(/[^\\p{L}\\p{N} .-]/gu, '').replace(/\\s+/g, ' ').trim() }
    var el = null
    if (spec.aria) el = Array.from(document.querySelectorAll('button,[role=button]')).filter(vis).find(function (b) { return b.getAttribute('aria-label') === spec.aria })
    if (spec.radio) el = Array.from(document.querySelectorAll('[role=radio]')).filter(vis).find(function (b) { return txt(b).split(' ').indexOf(spec.radio) !== -1 })
    if (spec.menu) el = Array.from(document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')).filter(vis).find(function (b) { return clean(txt(b)) === spec.menu })
    if (spec.menuEnds) el = Array.from(document.querySelectorAll('[role=menuitem]')).filter(vis).find(function (b) { return txt(b).slice(-spec.menuEnds.length) === spec.menuEnds })
    if (spec.buttonText) el = Array.from(document.querySelectorAll('button,[role=button]')).filter(vis).find(function (b) { return txt(b).indexOf(spec.buttonText) !== -1 })
    if (spec.prompt) el = Array.from(document.querySelectorAll('.ProseMirror,[contenteditable=true]')).filter(vis).pop()
    if (spec.tileMenu) {
      var img = document.querySelector('img[data-media-id="' + spec.tileMenu + '"]')
      var t = img
      for (var i = 0; i < 6 && t; i++) { t = t.parentElement; if (t && t.querySelector('button[aria-label="More options"]')) break }
      el = t && t.querySelector('button[aria-label="More options"]')
      if (img && !el) img.scrollIntoView({ block: 'center' })
    }
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    var r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`
}

/** What the prompt bar and its settings popover show right now. */
const stateScript = `(function () {
  function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  function txt(el) { return (el.innerText || '').replace(/\\s+/g, ' ').trim() }
  var ed = Array.from(document.querySelectorAll('.ProseMirror,[contenteditable=true]')).filter(vis).pop(), bar = ed
  for (var j = 0; j < 8 && bar && bar.parentElement; j++) { bar = bar.parentElement; if (bar.querySelector('button[aria-label="Start generation"]')) break }
  var buttons = bar ? Array.from(bar.querySelectorAll('button')).filter(vis) : []
  var family = Array.from(document.querySelectorAll('button')).filter(vis).find(function (b) { return b.getAttribute('aria-label') === 'Select model family' })
  var agent = buttons.find(function (b) { return txt(b) === 'Agent' })
  // The sentence can wrap its number in its own element: take the smallest match.
  var cost = Array.from(document.querySelectorAll('*')).filter(function (e) { return vis(e) && /^Generating will use \\d+ credits?/.test(txt(e)) }).map(txt).sort(function (a, b) { return a.length - b.length })[0] || null
  return {
    settingsOpen: !!family,
    model: family ? txt(family).replace(/arrow_drop_down/g, '').trim() : null,
    radios: Array.from(document.querySelectorAll('[role=radio]')).filter(vis).map(function (b) { return { words: txt(b).split(' '), checked: b.getAttribute('aria-checked') === 'true' } }),
    menu: Array.from(document.querySelectorAll('[role=menuitem]')).filter(vis).map(txt),
    cost: cost ? Number(cost.match(/\\d+/)[0]) : null,
    agentOn: !!agent && agent.getAttribute('aria-pressed') === 'true',
    chips: bar ? Array.from(bar.querySelectorAll('img')).map(function (im) { var m = (im.getAttribute('src') || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); return m ? m[0] : null }) : [],
    frameSlotsFilled: buttons.filter(function (b) { return b.getAttribute('aria-label') === 'Image ingredient' }).length,
    canClear: buttons.some(function (b) { return b.getAttribute('aria-label') === 'Clear prompt' }),
    settingsLabel: (buttons.find(function (b) { return b.getAttribute('aria-label') === 'Settings trigger' }) || { innerText: '' }).innerText.replace(/\\s+/g, ' ').trim(),
  }
})()`

interface UiState {
  settingsOpen: boolean; model: string | null; radios: { words: string[]; checked: boolean }[]; menu: string[]
  cost: number | null; agentOn: boolean; chips: (string | null)[]; frameSlotsFilled: number; canClear: boolean; settingsLabel: string
}

/** Text from the page that says Flow refused (unusual activity, policy), if any. */
const refusalScript = `(function () {
  var t = document.body.innerText
  var m = t.match(/[^\\n]*(unusual activity|couldn.t generate|could not generate|can.t generate|third-party content|Failed:)[^\\n]*/i)
  return m ? m[0].replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '***').slice(0, 200) : null
})()`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const state = (wc: WebContents) => wc.executeJavaScript(stateScript) as Promise<UiState>

function locate(wc: WebContents, spec: Spec, timeoutMs = 8000): Promise<Point | null> {
  return waitFor(() => wc.executeJavaScript(locateScript(spec)) as Promise<Point | null>, timeoutMs, 250)
}

async function click(wc: WebContents, p: Point): Promise<void> {
  await withCdp(wc, async send => {
    const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  })
}

async function press(wc: WebContents, spec: Spec, what: string): Promise<void> {
  const p = await locate(wc, spec)
  if (!p) throw new Error(`Flow page: ${what} not found — the page may have changed`)
  await click(wc, p)
  await sleep(450)
}

async function escape(wc: WebContents): Promise<void> {
  await withCdp(wc, async send => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  })
  await sleep(350)
}

const checked = (s: UiState, word: string) => s.radios.some(r => r.checked && r.words.includes(word))

async function openSettings(wc: WebContents): Promise<UiState> {
  let s = await state(wc)
  if (!s.settingsOpen) {
    await press(wc, { aria: 'Settings trigger' }, 'the generation settings button')
    s = await waitFor(async () => { const x = await state(wc); return x.settingsOpen ? x : null }, 6000, 250) ?? s
  }
  if (!s.settingsOpen) throw new Error('Flow page: the generation settings did not open')
  return s
}

/** Clicks a settings radio until it reads as checked (a first click can only focus the popover). */
async function choose(wc: WebContents, word: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (checked(await state(wc), word)) return
    await press(wc, { radio: word }, `the "${word}" option`)
  }
  if (!checked(await state(wc), word)) throw new Error(`Flow page: the "${word}" option did not stay selected`)
}

async function readModels(wc: WebContents): Promise<string[]> {
  await press(wc, { aria: 'Select model family' }, 'the model menu')
  const s = await waitFor(async () => { const x = await state(wc); return x.menu.length ? x : null }, 5000, 250)
  await escape(wc)
  return (s?.menu ?? []).map(modelName).filter(Boolean)
}

async function chooseModel(wc: WebContents, model: string): Promise<string | null> {
  const s = await state(wc)
  if (modelName(s.model ?? '') === model) return null
  await press(wc, { aria: 'Select model family' }, 'the model menu')
  const menu = await waitFor(async () => { const x = await state(wc); return x.menu.length ? x.menu : null }, 5000, 250) ?? []
  const names = menu.map(modelName)
  if (!names.includes(model)) { await escape(wc); return `unknown model "${model}"; Flow offers: ${names.join(', ')}` }
  await press(wc, { menu: model }, `the "${model}" model`)
  const after = await state(wc)
  return modelName(after.model ?? '') === model ? null : `the model is still "${after.model}"`
}

async function mediaIds(wc: WebContents, projectId: string): Promise<string[]> {
  const r = await wc.executeJavaScript(listProjectMediaScript(projectId)) as { ok?: boolean; media?: { mediaId: string }[]; error?: string }
  if (!r?.ok) throw new Error(`could not list the project's media: ${r?.error ?? 'no answer'}`)
  return (r.media ?? []).map(m => m.mediaId)
}

/** Whether every id has its tile in the project grid. */
function tilesShown(wc: WebContents, ids: string[]): Promise<boolean> {
  return wc.executeJavaScript(`${JSON.stringify(ids)}.every(function (id) { return !!document.querySelector('img[data-media-id="' + id + '"]') })`).catch(() => false) as Promise<boolean>
}

/** Puts one project image into the prompt bar through its tile menu. */
async function addFromProject(wc: WebContents, mediaId: string): Promise<void> {
  const more = await locate(wc, { tileMenu: mediaId }, 6000)
  if (!more) throw new Error(`image ${mediaId} is not shown in this project's grid (only images can be attached; check the id with flow_list_project_media)`)
  await click(wc, more)
  await sleep(500)
  const before = await state(wc)
  await press(wc, { menuEnds: 'Add to prompt' }, '"Add to prompt" in the image menu')
  // A just-uploaded image takes a few seconds to appear in the bar.
  await waitFor(async () => {
    const s = await state(wc)
    return s.chips.includes(mediaId) || s.frameSlotsFilled > before.frameSlotsFilled || null
  }, 8000, 400)
  await sleep(400)
}

/** Uploads a local image through the page's own "Upload media", which adds it to the prompt. */
async function addLocalFile(wc: WebContents, path: string): Promise<void> {
  await readLocalImage(path) // type, size and path checks before anything is sent
  await press(wc, { aria: 'Add ingredients to the prompt box' }, 'the add-ingredients button')
  const upload = await locate(wc, { buttonText: 'Upload media' }, 5000)
  if (!upload) throw new Error('Flow page: "Upload media" not found — the page may have changed')
  await withCdp(wc, async send => {
    await send('Page.enable')
    await send('DOM.enable')
    await send('Page.setInterceptFileChooserDialog', { enabled: true })
    const opened = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { wc.debugger.off('message', onMessage); reject(new Error('Flow page: the file picker did not open')) }, 8000)
      function onMessage(_e: unknown, method: string, params: { backendNodeId?: number }) {
        if (method !== 'Page.fileChooserOpened' || !params.backendNodeId) return
        clearTimeout(timer)
        wc.debugger.off('message', onMessage)
        resolve(params.backendNodeId)
      }
      wc.debugger.on('message', onMessage)
    })
    const base = { x: upload.x, y: upload.y, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    try {
      await send('DOM.setFileInputFiles', { files: [path], backendNodeId: await opened })
    } finally {
      await send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {})
    }
  })
  await sleep(1500)
}

async function typePrompt(wc: WebContents, prompt: string): Promise<void> {
  const box = await locate(wc, { prompt: true })
  if (!box) throw new Error('Flow page: the prompt box was not found')
  await click(wc, box)
  await withCdp(wc, async send => {
    const key = (k: object) => Promise.all([send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }), send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })])
    await key({ windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 })
    await key({ windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' })
    await send('Input.insertText', { text: prompt })
  })
  await sleep(500)
}

const isLocalPath = (s: string) => /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/')

export interface FlowUiRequest {
  kind: 'image' | 'video'
  prompt: string
  projectId: string
  account?: string | null
  model?: string | null
  aspectRatio?: unknown
  count?: unknown
  /** Video only. */
  resolution?: unknown
  seconds?: unknown
  /** Video Frames mode: a project image id or a local image path for each end. */
  startFrame?: string | null
  endFrame?: string | null
  /** Up to MAX_INGREDIENTS project image ids or local image paths. */
  ingredients?: string[] | null
}

/** Checks everything that needs no page, so bad input costs nothing. */
export function checkRequest(req: FlowUiRequest): { error: string } | null {
  const prompt = String(req.prompt ?? '').trim()
  if (!prompt) return { error: `refusing to generate ${req.kind === 'video' ? 'a video' : 'an image'} without a prompt` }
  if (prompt.length > MAX_PROMPT) return { error: `the prompt is ${prompt.length} characters; keep it under ${MAX_PROMPT}` }
  const bad = flowIdError(String(req.projectId ?? '').trim(), 'projectId')
  if (bad) return { error: bad }
  const ratio = checkRatio(req.aspectRatio, req.kind === 'video' ? FLOW_VIDEO_RATIOS : FLOW_UI_RATIOS)
  if (ratio && typeof ratio === 'object') return ratio
  const count = checkCount(req.count)
  if (count && typeof count === 'object') return count
  const frames = [req.startFrame, req.endFrame].filter(Boolean) as string[]
  const ingredients = (req.ingredients ?? []).filter(Boolean)
  if (req.kind === 'image' && (frames.length || req.resolution || req.seconds)) return { error: 'startFrame, endFrame, resolution and seconds are for videos only' }
  if (frames.length && ingredients.length) return { error: 'use either startFrame/endFrame (Frames) or ingredients, not both — Flow offers one or the other' }
  if (ingredients.length > MAX_INGREDIENTS) return { error: `at most ${MAX_INGREDIENTS} ingredients` }
  if (req.endFrame && !req.startFrame) return { error: 'endFrame needs a startFrame' }
  if (req.resolution != null && req.resolution !== '' && !(FLOW_VIDEO_RESOLUTIONS as readonly string[]).includes(String(req.resolution))) return { error: `resolution must be ${FLOW_VIDEO_RESOLUTIONS.join(' or ')}` }
  if (req.seconds != null && req.seconds !== '' && !(FLOW_VIDEO_SECONDS as readonly number[]).includes(Number(req.seconds))) return { error: `seconds must be ${FLOW_VIDEO_SECONDS.join(', ')}` }
  for (const ref of [...frames, ...ingredients]) {
    if (!isLocalPath(ref) && flowIdError(ref, 'image id')) return { error: `"${ref}" is neither a project image id nor an absolute local image path` }
  }
  return null
}

/**
 * Generates images or a video through Flow's prompt bar. Images are awaited
 * (they take seconds); a video returns as soon as Flow shows the new media
 * — poll flow_media_status for the finished clip.
 */
export async function flowUiGenerate(req: FlowUiRequest): Promise<FlowResult> {
  const bad = checkRequest(req)
  if (bad) return { ok: false, error: bad.error }
  const id = String(req.projectId).trim()
  const prompt = String(req.prompt).trim()
  const video = req.kind === 'video'
  const ratio = checkRatio(req.aspectRatio, video ? FLOW_VIDEO_RATIOS : FLOW_UI_RATIOS) as string | null
  const count = checkCount(req.count) as number | null
  const model = req.model ? modelName(String(req.model)) : null
  const frames = [req.startFrame, req.endFrame].filter(Boolean) as string[]
  const ingredients = (req.ingredients ?? []).filter(Boolean)

  return withFlowPage(id, req.account, async (wc, partition) => {
    const hold = partition ? flowHold(partition) : null
    if (hold) return { ok: false, error: heldError(hold), heldUntil: hold.until }

    // An image added since the page opened (flow_upload_image, another tab) is
    // not in its grid until the page reloads (seen 2026-10-17): reload once.
    const projectRefs = [...frames, ...ingredients].filter(r => !isLocalPath(r))
    if (projectRefs.length && !(await tilesShown(wc, projectRefs))) {
      wc.once('will-prevent-unload', e => e.preventDefault())
      wc.reload()
      await waitFor(async () => (await tilesShown(wc, projectRefs)) || null, 25_000, 500)
      await sleep(1000)
    }

    // A clean bar, and Flow's agent off: the prompt goes straight to generation.
    let s = await state(wc)
    if (s.settingsOpen) { await escape(wc); s = await state(wc) }
    if (s.canClear) await press(wc, { aria: 'Clear prompt' }, 'the Clear prompt button')
    if (s.agentOn) await press(wc, { buttonText: 'Agent' }, 'the Agent switch')

    await openSettings(wc)
    await choose(wc, video ? 'Video' : 'Image')
    if (video) await choose(wc, frames.length ? 'Frames' : 'Ingredients')
    if (ratio) await choose(wc, ratio)
    if (model) {
      const err = await chooseModel(wc, model)
      if (err) { await escape(wc); return { ok: false, error: err } }
    }
    if (video && req.resolution) await choose(wc, String(req.resolution))
    if (video && req.seconds) await choose(wc, `${Number(req.seconds)}s`)
    if (count) await choose(wc, `x${count}`)
    s = await state(wc)
    const credits = s.cost
    await escape(wc)

    for (const ref of [...frames, ...ingredients]) {
      if (isLocalPath(ref)) await addLocalFile(wc, ref)
      else await addFromProject(wc, ref)
    }
    s = await state(wc)
    if (frames.length && s.frameSlotsFilled < frames.length) return { ok: false, error: `only ${s.frameSlotsFilled} of ${frames.length} frames reached the prompt box` }
    if (ingredients.length) {
      const missing = ingredients.filter(r => !isLocalPath(r) && !s.chips.includes(r))
      if (s.chips.length < ingredients.length || missing.length) return { ok: false, error: `the prompt box holds ${s.chips.length} of ${ingredients.length} ingredients${missing.length ? ` (missing ${missing.join(', ')})` : ''}` }
    }

    await typePrompt(wc, prompt)
    const before = await mediaIds(wc, id)
    await press(wc, { aria: 'Start generation' }, 'the Start generation button')

    const started = Date.now()
    const want = count ?? 1
    let refusal: string | null = null
    const fresh = await waitFor(async () => {
      refusal = await wc.executeJavaScript(refusalScript).catch(() => null) as string | null
      if (refusal && UNUSUAL_ACTIVITY.test(refusal)) return ['refused']
      const ids = newMediaIds(before, await mediaIds(wc, id))
      if (!video) return ids.length >= want || (ids.length && Date.now() - started > 90_000) ? ids : null
      return ids.length ? ids : null
    }, video ? SUBMIT_WAIT_MS : IMAGE_TIMEOUT_MS, 3000)

    if (refusal && UNUSUAL_ACTIVITY.test(refusal)) {
      const until = partition ? holdFlowAccount(partition, refusal) : null
      return { ok: false, error: `Flow refused: ${refusal}`, ...(until ? { heldUntil: until, note: 'This account is parked; FlowDesk will not retry on it until then.' } : {}) }
    }
    if (!fresh?.length) {
      return { ok: false, error: refusal ? `Flow refused: ${refusal}` : `no new ${video ? 'video' : 'image'} appeared in the project after ${(video ? SUBMIT_WAIT_MS : IMAGE_TIMEOUT_MS) / 1000} s`, creditsQuoted: credits }
    }

    const items: { mediaId: string; imageUrl?: string | null; videoUrl?: string | null; status?: string | null }[] = []
    for (const m of fresh) {
      const st = await wc.executeJavaScript(mediaStatusScript(m)).catch(() => null) as { imageUrl?: string; videoUrl?: string; status?: string } | null
      items.push({ mediaId: m, imageUrl: st?.imageUrl ?? null, videoUrl: st?.videoUrl ?? null, status: st?.status ?? null })
    }
    return {
      ok: true,
      projectId: id,
      mediaIds: fresh,
      [video ? 'videos' : 'images']: items,
      creditsQuoted: credits,
      settings: s.settingsLabel || undefined,
      note: video
        ? 'Flow took the job; poll flow_media_status with each mediaId until it has a videoUrl, then flow_download_media.'
        : 'Download with flow_download_media { mediaUrl: imageUrl }.',
    }
  })
}

export interface FlowUiImageRequest {
  prompt: string
  projectId: string
  account?: string | null
  model?: string | null
  aspectRatio?: unknown
  count?: unknown
  ingredients?: string[] | null
}

export function flowUiGenerateImage(req: FlowUiImageRequest): Promise<FlowResult> {
  return flowUiGenerate({ ...req, kind: 'image' })
}

/** The models Flow offers right now for `kind`, plus the current settings. */
export function flowUiModels(kind: 'image' | 'video', projectId: string, account?: string | null): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  const bad = flowIdError(id, 'projectId')
  if (bad) return Promise.resolve({ ok: false, error: bad })
  return withFlowPage(id, account, async wc => {
    await openSettings(wc)
    await choose(wc, kind === 'video' ? 'Video' : 'Image')
    const models = await readModels(wc)
    const s = await state(wc)
    await escape(wc)
    return {
      ok: true,
      models,
      current: s.settingsLabel,
      creditsForCurrent: s.cost,
      aspectRatios: kind === 'video' ? [...FLOW_VIDEO_RATIOS] : [...FLOW_UI_RATIOS],
      counts: [1, 2, 3, 4],
      ...(kind === 'video' ? { resolutions: [...FLOW_VIDEO_RESOLUTIONS], seconds: [...FLOW_VIDEO_SECONDS] } : {}),
    }
  })
}

export function flowUiImageModels(projectId: string, account?: string | null): Promise<FlowResult> {
  return flowUiModels('image', projectId, account)
}
