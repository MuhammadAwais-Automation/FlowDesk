/**
 * Google Flow driven through its own page, the way a person uses it.
 *
 * Flow rebuilt its front end around a creation agent (2026-10): the prompt box
 * now talks to an agent, and image settings (model, aspect ratio, count) live
 * in an "Agent settings" panel. The direct ogiZ0b call in flowBridge stopped
 * working at the same time ([5] for Nano Banana 2, "unusual activity" for
 * Nano Banana Pro). Here nothing is forged: FlowDesk opens the settings panel,
 * picks the options, types the prompt and presses the page's own Start button
 * with real (CDP) input, and Flow's own code builds and sends every request.
 * New images are found by listing the project's media before and after.
 *
 * Controls were read off the live page (probes fl-ui-01..09, 2026-10-06):
 *   - "Settings" button opens Agent settings
 *   - image ratio radios 16:9, 4:3, 1:1, 3:4, 9:16 and count radios x1..x4
 *     (the image section comes before the video one in the DOM)
 *   - "Image generation default model" menu: Nano Banana Pro, Nano Banana 2 Lite, Nano Banana 2
 *   - "Save" closes the panel; the prompt box is a ProseMirror editor;
 *     "Start generation" sends it.
 */
import type { WebContents } from 'electron'
import { withFlowPage, flowIdError, type FlowResult } from './flow'
import { listProjectMediaScript, mediaStatusScript } from './flowBridge'
import { withCdp, waitFor } from './chatgptImages'

export const FLOW_UI_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const
export type FlowUiRatio = typeof FLOW_UI_RATIOS[number]
const MAX_PROMPT = 8000
const GENERATE_TIMEOUT_MS = 4 * 60_000

export function checkRatio(r: unknown): FlowUiRatio | null | { error: string } {
  if (r == null || r === '') return null
  return (FLOW_UI_RATIOS as readonly string[]).includes(String(r))
    ? String(r) as FlowUiRatio
    : { error: `aspectRatio must be one of ${FLOW_UI_RATIOS.join(', ')}` }
}

export function checkCount(n: unknown): number | null | { error: string } {
  if (n == null || n === '') return null
  const v = Number(n)
  return Number.isInteger(v) && v >= 1 && v <= 4 ? v : { error: 'count must be 1, 2, 3 or 4' }
}

/** Menu labels carry an emoji ("🍌 Nano Banana 2"); compare on the words only. */
export function modelName(label: string): string {
  return label.replace(/[^\p{L}\p{N} .-]/gu, '').replace(/\s+/g, ' ').trim()
}

export function newMediaIds(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before)
  return after.filter(id => !seen.has(id))
}

interface Point { x: number; y: number }
type FindKind = 'aria' | 'text' | 'radio' | 'menu' | 'prompt'

/**
 * Finds one visible control and returns its centre. aria = exact aria-label,
 * text = exact button text, radio = first role=radio whose last word is the
 * label, menu = menu item whose words equal the label, prompt = the editor.
 */
function findScript(kind: FindKind, label = ''): string {
  return `(function () {
    var want = ${JSON.stringify(label)}
    var kind = ${JSON.stringify(kind)}
    function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    function words(s) { return String(s || '').replace(/[^\\p{L}\\p{N} .-]/gu, '').replace(/\\s+/g, ' ').trim() }
    var el = null
    if (kind === 'aria') el = Array.from(document.querySelectorAll('button,[role=button]')).filter(vis).find(function (b) { return (b.getAttribute('aria-label') || '') === want })
    if (kind === 'text') el = Array.from(document.querySelectorAll('button')).filter(vis).find(function (b) { return b.innerText.trim() === want })
    if (kind === 'radio') el = Array.from(document.querySelectorAll('[role=radio]')).filter(vis).find(function (b) { return b.innerText.replace(/\\s+/g, ' ').trim().split(' ').pop() === want })
    if (kind === 'menu') el = Array.from(document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')).filter(vis).find(function (b) { return words(b.innerText) === want })
    if (kind === 'prompt') el = Array.from(document.querySelectorAll('.ProseMirror,[contenteditable=true]')).filter(vis).pop()
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    var r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`
}

const stateScript = `(function () {
  function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  var t = document.body.innerText
  var picker = Array.from(document.querySelectorAll('button')).filter(vis).find(function (b) { return b.getAttribute('aria-label') === 'Image generation default model' })
  var radios = Array.from(document.querySelectorAll('[role=radio]')).filter(vis).map(function (b) { return { label: b.innerText.replace(/\\s+/g, ' ').trim().split(' ').pop(), checked: b.getAttribute('aria-checked') === 'true' } })
  var menu = Array.from(document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')).filter(vis).map(function (b) { return b.innerText.replace(/\\s+/g, ' ').trim() })
  return { settingsOpen: t.indexOf('Image generation default') !== -1 && !!picker, model: picker ? picker.innerText.replace(/arrow_drop_down/g, '').trim() : null, radios: radios, menu: menu }
})()`

interface UiState { settingsOpen: boolean; model: string | null; radios: { label: string; checked: boolean }[]; menu: string[] }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function find(wc: WebContents, kind: FindKind, label?: string, timeoutMs = 8000): Promise<Point | null> {
  return waitFor(() => wc.executeJavaScript(findScript(kind, label)) as Promise<Point | null>, timeoutMs, 250)
}

async function click(wc: WebContents, p: Point): Promise<void> {
  await withCdp(wc, async send => {
    const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  })
}

async function clickControl(wc: WebContents, kind: FindKind, label: string, what: string): Promise<void> {
  const p = await find(wc, kind, label)
  if (!p) throw new Error(`Flow page: ${what} not found — the page may have changed`)
  await click(wc, p)
  await sleep(400)
}

const state = (wc: WebContents) => wc.executeJavaScript(stateScript) as Promise<UiState>

async function openSettings(wc: WebContents): Promise<UiState> {
  let s = await state(wc)
  if (!s.settingsOpen) {
    await clickControl(wc, 'aria', 'Settings', 'the Settings button')
    s = await waitFor(async () => { const x = await state(wc); return x.settingsOpen ? x : null }, 8000, 300) ?? s
  }
  if (!s.settingsOpen) throw new Error('Flow page: the Agent settings panel did not open')
  return s
}

async function readModels(wc: WebContents): Promise<string[]> {
  await clickControl(wc, 'aria', 'Image generation default model', 'the image model menu')
  const s = await waitFor(async () => { const x = await state(wc); return x.menu.length ? x : null }, 5000, 250)
  return (s?.menu ?? []).map(modelName).filter(Boolean)
}

async function pressEscape(wc: WebContents): Promise<void> {
  await withCdp(wc, async send => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  })
  await sleep(300)
}

async function mediaIds(wc: WebContents, projectId: string): Promise<string[]> {
  const r = await wc.executeJavaScript(listProjectMediaScript(projectId)) as { ok?: boolean; media?: { mediaId: string }[]; error?: string }
  if (!r?.ok) throw new Error(`could not list the project's media: ${r?.error ?? 'no answer'}`)
  return (r.media ?? []).map(m => m.mediaId)
}

/** The agent panel's last words — returned when no image arrives, so the reason is visible. */
const panelTailScript = `(function () {
  var t = document.body.innerText; var i = t.lastIndexOf('What do you want to create?')
  return (i > 0 ? t.slice(Math.max(0, i - 700), i) : t.slice(-700)).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '***')
})()`

/** The image models Flow offers right now, plus the current settings. */
export function flowUiImageModels(projectId: string, account?: string | null): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  const bad = flowIdError(id, 'projectId')
  if (bad) return Promise.resolve({ ok: false, error: bad })
  return withFlowPage(id, account, async wc => {
    const s = await openSettings(wc)
    const models = await readModels(wc)
    await pressEscape(wc)
    return {
      ok: true,
      models,
      current: {
        model: s.model ? modelName(s.model) : null,
        aspectRatio: s.radios.find(r => r.checked && r.label.includes(':'))?.label ?? null,
        count: Number(s.radios.find(r => r.checked && /^x\d$/.test(r.label))?.label.slice(1)) || null,
      },
      aspectRatios: [...FLOW_UI_RATIOS],
      counts: [1, 2, 3, 4],
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
}

/**
 * Sets model / ratio / count in Agent settings (only those given), types the
 * prompt, presses Start, and waits for new media in the project.
 */
export async function flowUiGenerateImage(req: FlowUiImageRequest): Promise<FlowResult> {
  const prompt = String(req.prompt ?? '').trim()
  if (!prompt) return { ok: false, error: 'refusing to generate an image without a prompt' }
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `the prompt is ${prompt.length} characters; keep it under ${MAX_PROMPT}` }
  const id = String(req.projectId ?? '').trim()
  const bad = flowIdError(id, 'projectId')
  if (bad) return { ok: false, error: bad }
  const ratio = checkRatio(req.aspectRatio)
  if (ratio && typeof ratio === 'object') return { ok: false, error: ratio.error }
  const count = checkCount(req.count)
  if (count && typeof count === 'object') return { ok: false, error: count.error }
  const model = req.model ? modelName(String(req.model)) : null

  return withFlowPage(id, req.account, async wc => {
    if (model || ratio || count) {
      const s = await openSettings(wc)
      if (model && modelName(s.model ?? '') !== model) {
        const models = await readModels(wc)
        if (!models.includes(model)) { await pressEscape(wc); return { ok: false, error: `unknown model "${model}"; Flow offers: ${models.join(', ')}` } }
        await clickControl(wc, 'menu', model, `the "${model}" menu item`)
      }
      // The first click on a freshly opened panel sometimes only focuses it
      // (seen live): click again until the radio reads as checked.
      for (const label of [ratio, count ? `x${count}` : null]) {
        if (!label) continue
        for (let i = 0; i < 3 && !(await state(wc)).radios.find(r => r.label === label)?.checked; i++) {
          await clickControl(wc, 'radio', label, `the ${label} option`)
        }
      }
      const after = await state(wc)
      const checked = (label: string) => after.radios.find(r => r.label === label)?.checked
      if (ratio && !checked(ratio)) return { ok: false, error: `the ${ratio} ratio did not stay selected` }
      if (count && !checked(`x${count}`)) return { ok: false, error: `the x${count} count did not stay selected` }
      if (model && modelName(after.model ?? '') !== model) return { ok: false, error: `the model is still "${after.model}"` }
      await clickControl(wc, 'text', 'Save', 'the settings Save button')
    }

    const before = await mediaIds(wc, id)

    const box = await find(wc, 'prompt')
    if (!box) return { ok: false, error: 'Flow page: the prompt box was not found' }
    await click(wc, box)
    await withCdp(wc, async send => {
      const key = (k: object) => Promise.all([send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }), send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })])
      await key({ windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 })
      await key({ windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' })
      await send('Input.insertText', { text: prompt })
    })
    await sleep(500)
    await clickControl(wc, 'aria', 'Start generation', 'the Start generation button')

    const started = Date.now()
    const fresh = await waitFor(async () => {
      const ids = newMediaIds(before, await mediaIds(wc, id))
      return ids.length >= (count ?? 1) || (ids.length && Date.now() - started > 90_000) ? ids : null
    }, GENERATE_TIMEOUT_MS, 5000)
    if (!fresh?.length) {
      const panel = await wc.executeJavaScript(panelTailScript).catch(() => '') as string
      return { ok: false, error: `no new image in the project after ${GENERATE_TIMEOUT_MS / 60_000} minutes`, agent: panel }
    }
    const images: { mediaId: string; imageUrl: string | null }[] = []
    for (const m of fresh) {
      const st = await wc.executeJavaScript(mediaStatusScript(m)).catch(() => null) as { imageUrl?: string } | null
      images.push({ mediaId: m, imageUrl: st?.imageUrl ?? null })
    }
    return { ok: true, projectId: id, mediaIds: fresh, images, model: model ?? undefined, aspectRatio: ratio ?? undefined, note: 'Flow\'s agent can still pick another ratio from the prompt; say the ratio in the prompt too. Download with flow.downloadMedia { mediaUrl: imageUrl }.' }
  })
}
