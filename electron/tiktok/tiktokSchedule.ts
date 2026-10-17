/**
 * Schedules a video through TikTok Studio's own upload form, the way a person
 * does: upload, "When to post" → Schedule, pick the date and time, press
 * Schedule, and answer the "Allow your video to be saved for scheduled
 * posting?" popup that Studio shows on every scheduled upload.
 *
 * The direct API call for a scheduled post was answered "Invalid parameters"
 * (report 2026-10-14), and the form is what TikTok itself accepts, so every
 * schedule goes through it. Success is what TikTok's post request answers
 * (an item id), not what the screen shows.
 */
import type { WebContents } from 'electron'
import { finishUpload, getTikTokView, resolveTikTokPartition, tkUploadVideo, unknownTikTokAccount, type TikTokResult } from './tiktok'
import { checkSchedule } from './tiktokUpload'
import { keepAwake } from '../keepAwake'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const POST_URL = '/tiktok/web/project/post/v1'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const two = (n: number) => String(n).padStart(2, '0')

interface Point { x: number; y: number }

/** The last clicks of the running schedule, reported when it fails. */
const clickLog: string[] = []

/** `finder` is a JS expression that returns the element to act on, or null. */
async function centerOf(wc: WebContents, finder: string): Promise<Point | null> {
  return wc.executeJavaScript(`(() => {
    const el = (${finder})
    if (!el) return null
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
  })()`) as Promise<Point | null>
}

async function cdpClick(wc: WebContents, p: Point): Promise<void> {
  const wasAttached = wc.debugger.isAttached()
  if (!wasAttached) wc.debugger.attach('1.3')
  try {
    const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 }
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  } finally {
    if (!wasAttached) { try { wc.debugger.detach() } catch { /* already gone */ } }
  }
}

async function press(wc: WebContents, finder: string, what: string): Promise<void> {
  let p: Point | null = null
  for (let i = 0; i < 12 && !p; i++) {
    p = await centerOf(wc, finder)
    if (!p) await sleep(400)
  }
  if (!p) throw new Error(`TikTok Studio: ${what} not found — the page may have changed`)
  // Studio's pickers keep scrolling after the jump (the hour list snapped two
  // rows away and hour 15 became 17): measure again once they have settled.
  await sleep(350)
  p = (await centerOf(wc, finder)) ?? p
  await sleep(150)
  p = (await centerOf(wc, finder)) ?? p
  // What is really under the pointer (an overlay would explain a click that does nothing).
  const hit = await read<string>(wc, `(() => {
    const e = document.elementFromPoint(${p.x}, ${p.y})
    return e ? e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0].slice(0, 40) + ' "' + (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30) + '"' : 'nothing'
  })()`).catch(() => 'unknown')
  clickLog.push(`${what} @${p.x},${p.y} -> ${hit}`)
  if (clickLog.length > 14) clickLog.shift()
  await cdpClick(wc, p)
  await sleep(350)
}

async function pressEscape(wc: WebContents): Promise<void> {
  const wasAttached = wc.debugger.isAttached()
  if (!wasAttached) wc.debugger.attach('1.3')
  try {
    for (const type of ['keyDown', 'keyUp']) await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  } catch { /* best effort */ } finally {
    if (!wasAttached) { try { wc.debugger.detach() } catch { /* already gone */ } }
  }
}

const read = <T>(wc: WebContents, expr: string) => wc.executeJavaScript(`(() => (${expr}))()`) as Promise<T>

/** Studio answers a click late while it is still busy with the video (cover "Loading…"): wait for the effect. */
async function until(wc: WebContents, expr: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await read<boolean>(wc, expr).catch(() => false)) return true
    await sleep(250)
  }
  return false
}

const DATE_INPUT = `Array.from(document.querySelectorAll('input.TUXTextInputCore-input')).find(i => /^\\d{4}-\\d{2}-\\d{2}$/.test(i.value))`
const TIME_INPUT = `Array.from(document.querySelectorAll('input.TUXTextInputCore-input')).find(i => /^\\d{1,2}:\\d{2}$/.test(i.value))`

/** Studio shows a one-off tour ("New editing features — Got it") that covers the form. */
async function dismissTour(wc: WebContents): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const p = await centerOf(wc, `Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Got it')`)
    if (!p) return
    await cdpClick(wc, p)
    await sleep(500)
  }
}

async function chooseSchedule(wc: WebContents): Promise<void> {
  const radio = `document.querySelector('input[type=radio][value=schedule]')`
  // Right after the upload Studio may still re-render the form, which dropped
  // the choice in some runs: let it settle, then click until it holds.
  await until(wc, `!/Loading/.test(document.body.innerText)`, 30_000)
  for (let i = 0; i < 4; i++) {
    await press(wc, radio, 'the "Schedule" choice under "When to post"')
    if (await until(wc, `Boolean(${radio} && ${radio}.checked)`, 5000)) return
    await dismissTour(wc)
  }
  throw new Error('TikTok Studio: "Schedule" would not stay selected')
}

async function setDate(wc: WebContents, target: Date): Promise<void> {
  await press(wc, DATE_INPUT, 'the date field')
  const want = target.getFullYear() * 12 + target.getMonth()
  for (let i = 0; i < 14; i++) {
    const shown = await read<{ month: string; year: string } | null>(wc, `(() => {
      const m = document.querySelector('.calendar-wrapper .month-title'), y = document.querySelector('.calendar-wrapper .year-title')
      return m && y ? { month: m.innerText.trim(), year: y.innerText.trim() } : null
    })()`)
    if (!shown) throw new Error('TikTok Studio: the date calendar did not open')
    const mi = MONTHS.indexOf(shown.month.toLowerCase())
    if (mi < 0) throw new Error(`TikTok Studio shows the month as "${shown.month}"; set the Studio language to English`)
    const diff = want - (Number(shown.year) * 12 + mi)
    if (diff === 0) break
    await press(wc, `document.querySelectorAll('.calendar-wrapper .month-header-wrapper .arrow')[${diff > 0 ? 1 : 0}]`, 'the calendar month arrow')
  }
  // The grid also shows trailing days of the neighbouring months: take the day
  // between this month's first "1" and the next one.
  await press(wc, `(() => {
    const cells = Array.from(document.querySelectorAll('.calendar-wrapper .day'))
    const first = cells.findIndex(c => c.innerText.trim() === '1')
    const next = cells.findIndex((c, i) => i > first && c.innerText.trim() === '1')
    return cells.slice(first < 0 ? 0 : first, next < 0 ? undefined : next).find(c => c.innerText.trim() === '${target.getDate()}' && /\\bvalid\\b/.test(c.className))
  })()`, `day ${target.getDate()} in the calendar (not selectable?)`)
  const date = `${target.getFullYear()}-${two(target.getMonth() + 1)}-${two(target.getDate())}`
  if (!(await until(wc, `(${DATE_INPUT} || {}).value === '${date}'`, 5000))) throw new Error(`TikTok Studio did not take the date ${date}`)
}

async function setTime(wc: WebContents, target: Date, trace: string[]): Promise<void> {
  await press(wc, TIME_INPUT, 'the time field')
  trace.push('opened ' + await read<string>(wc, `(${TIME_INPUT} || {}).value`))
  const item = (list: number, text: string) => `Array.from((document.querySelectorAll('.tiktok-timepicker-option-list')[${list}] || document).querySelectorAll('.tiktok-timepicker-option-item')).find(i => i.innerText.trim() === '${text}')`
  const hour = two(target.getHours())
  const minute = two(target.getMinutes())
  const value = `(${TIME_INPUT} || {}).value`
  for (let i = 0; i < 3 && !(await until(wc, `${value} && ${value}.padStart(5, '0').startsWith('${hour}:')`, 500)); i++) {
    await press(wc, item(0, hour), `hour ${hour}`)
    await until(wc, `${value} && ${value}.padStart(5, '0').startsWith('${hour}:')`, 4000)
  }
  trace.push(`hour ${hour} -> ` + await read<string>(wc, value))
  for (let i = 0; i < 3 && !(await until(wc, `${value} && ${value}.endsWith(':${minute}')`, 500)); i++) {
    await press(wc, item(1, minute), `minute ${minute}`)
    await until(wc, `${value} && ${value}.endsWith(':${minute}')`, 4000)
  }
  trace.push(`minute ${minute} -> ` + await read<string>(wc, value))
  await closePicker(wc)
}

const PICKER_OPEN = `Array.from(document.querySelectorAll('.tiktok-timepicker-time-picker-container')).some(e => e.getBoundingClientRect().height > 2)`

/**
 * Closes the time picker. Clicking a label did not work: the popup covered it
 * and the click landed on an hour row (15:30 became 17:30). Escape first; else
 * a click on the empty space right of the date field, on the same row.
 */
async function closePicker(wc: WebContents): Promise<void> {
  const wasAttached = wc.debugger.isAttached()
  if (!wasAttached) wc.debugger.attach('1.3')
  try {
    const key = (type: string) => wc.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await key('rawKeyDown')
    await key('keyUp')
  } finally {
    if (!wasAttached) { try { wc.debugger.detach() } catch { /* already gone */ } }
  }
  if (await until(wc, `!(${PICKER_OPEN})`, 2500)) return
  const p = await read<Point | null>(wc, `(() => {
    const d = ${DATE_INPUT}
    if (!d) return null
    const r = d.getBoundingClientRect()
    return { x: Math.round(r.right + 160), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!p) throw new Error('TikTok Studio: the time picker would not close')
  await cdpClick(wc, p)
  if (!(await until(wc, `!(${PICKER_OPEN})`, 4000))) throw new Error('TikTok Studio: the time picker would not close')
}

interface PostAnswer { requestId: string; done: boolean; body?: any; scheduled?: boolean }

/** Studio puts schedule_time in the post body only for a scheduled post (captured source, tks-01). */
export const carriesScheduleTime = (postData: string): boolean => /"schedule_time"\s*:\s*"?[1-9]\d{5,}/.test(postData)

/** Watches the page's own scheduled-post request so the answer can be read. */
function watchPost(wc: WebContents): { answers: PostAnswer[]; stop: () => void } {
  const answers: PostAnswer[] = []
  const wasAttached = wc.debugger.isAttached()
  if (!wasAttached) wc.debugger.attach('1.3')
  void wc.debugger.sendCommand('Network.enable').catch(() => {})
  const onMessage = (_e: unknown, method: string, params: any) => {
    if (method === 'Network.requestWillBeSent' && String(params?.request?.url ?? '').includes(POST_URL)) {
      const a: PostAnswer = { requestId: params.requestId, done: false }
      answers.push(a)
      const body = params?.request?.postData
      if (typeof body === 'string') a.scheduled = carriesScheduleTime(body)
      else if (params?.request?.hasPostData) {
        void wc.debugger.sendCommand('Network.getRequestPostData', { requestId: a.requestId })
          .then((r: any) => { a.scheduled = carriesScheduleTime(String(r?.postData ?? '')) }).catch(() => {})
      }
    } else if (method === 'Network.loadingFinished') {
      const a = answers.find(x => x.requestId === params.requestId)
      if (a) {
        void wc.debugger.sendCommand('Network.getResponseBody', { requestId: a.requestId })
          .then((r: any) => { try { a.body = JSON.parse(r.body) } catch { a.body = { raw: String(r.body).slice(0, 300) } } })
          .catch(() => {})
          .finally(() => { a.done = true })
      }
    }
  }
  wc.debugger.on('message', onMessage)
  return {
    answers,
    stop: () => {
      wc.debugger.off('message', onMessage)
      if (!wasAttached) { try { wc.debugger.detach() } catch { /* already gone */ } }
    },
  }
}

export async function tkScheduleVideo(opts: {
  filePath: string
  caption?: string
  scheduleAt: string | number
  account?: string | number
  /** Dev checks only: fill and verify the form, then discard it without pressing Schedule. */
  dryRun?: boolean
}): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(opts.account)
  if (bad) return bad as TikTokResult
  const schedule = checkSchedule(opts.scheduleAt, 'public')
  if (schedule.error || !schedule.atSeconds) return { ok: false, error: schedule.error ?? 'scheduleAt is not a time' }
  const resolved = resolveTikTokPartition(opts.account)
  if (!resolved) return unknownTikTokAccount(opts.account) as TikTokResult
  // Studio's pickers use the machine's local time; the 5-minute rounding is already in atSeconds.
  const target = new Date(schedule.atSeconds * 1000)
  const label = `${target.getFullYear()}-${two(target.getMonth() + 1)}-${two(target.getDate())} ${two(target.getHours())}:${two(target.getMinutes())}`

  clickLog.length = 0
  const up = await tkUploadVideo({ videoFilePath: opts.filePath, caption: String(opts.caption ?? ''), account: opts.account })
  if (!up.ok) return up
  const wc = (await getTikTokView(opts.account)).webContents
  // A page in a hidden window stops painting, so Studio answered clicks only
  // when something (a screenshot) woke it: keep it rendering while we work.
  const release = await keepAwake(wc)
  const steps = ['upload']
  let watcher: ReturnType<typeof watchPost> | null = null
  let traceRef: string[] = []
  const fail = (error: string, extra: Record<string, unknown> = {}): TikTokResult => {
    // A dry run keeps a failed form on screen so a developer can look at it.
    finishUpload(wc, resolved.tabId, !opts.dryRun)
    return { ok: false, account: resolved.tabId, error: `${error}. Nothing was scheduled; the Studio form was discarded.`, steps, ...(traceRef.length ? { trace: traceRef } : {}), clicks: [...clickLog], ...extra }
  }
  try {
    // The form sometimes ignores a click (a day "not selectable", a picker that
    // will not close) and takes it on the next try: fill it again, up to three
    // times, before giving up; the uploaded video stays in the form.
    let shownLabel = ''
    let formError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await dismissTour(wc)
        await chooseSchedule(wc)
        if (!steps.includes('schedule-chosen')) steps.push('schedule-chosen')
        await setDate(wc, target)
        const trace: string[] = []
        traceRef = trace
        await setTime(wc, target, trace)
        const shown = await read<{ date: string; time: string }>(wc, `({ date: (${DATE_INPUT} || {}).value, time: (${TIME_INPUT} || {}).value })`)
        shownLabel = `${shown.date} ${String(shown.time).padStart(5, '0')}`
        if (shownLabel !== label) throw new Error(`Studio shows ${shownLabel} instead of ${label}`)
        formError = null
        break
      } catch (e) {
        formError = e
        steps.push(`form-retry-${attempt}`)
        await pressEscape(wc)
        await sleep(1200 * attempt)
      }
    }
    if (formError) return fail(formError instanceof Error ? formError.message : String(formError))
    steps.push('time-set')
    if (opts.dryRun) {
      finishUpload(wc, resolved.tabId, true)
      return { ok: true, dryRun: true, account: resolved.tabId, studioShows: shownLabel, steps }
    }

    watcher = watchPost(wc)
    await press(wc, `document.querySelector('button[data-e2e="post_video_button"]')`, 'the Schedule button')
    steps.push('schedule-pressed')

    // The "Allow your video to be saved for scheduled posting?" popup comes up on
    // every scheduled upload; scheduling the video is what the user asked for.
    let allowed = false
    let popup = ''
    let continued = false
    for (let i = 0; i < 60; i++) {
      if (watcher.answers.some(a => a.done)) break
      // "Continue to post? We're still checking your video…" [Cancel] [Post now]
      // continues the submission already chosen; the post request is checked
      // for its schedule time below.
      const cont = await centerOf(wc, `(() => {
        const box = Array.from(document.querySelectorAll('[role="dialog"], .TUXModal, [class*="modal"], [class*="Modal"]')).find(d => /Continue to post\\?/.test(d.innerText || ''))
        return box ? Array.from(box.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Post now') : null
      })()`)
      if (cont) {
        const stillScheduled = await read<boolean>(wc, `!!(document.querySelector('input[type=radio][value=schedule]') || {}).checked`).catch(() => false)
        if (!stillScheduled) return fail('Studio asked "Continue to post?" but the form is no longer on Schedule, so it was not confirmed')
        await cdpClick(wc, cont)
        continued = true
        steps.push('continue-post-confirmed')
        await sleep(800)
        continue
      }
      const p = await centerOf(wc, `Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Allow')`)
      if (p) {
        popup = String(await read<string>(wc, `(document.querySelector('[role="dialog"]') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 160)`))
        await cdpClick(wc, p)
        allowed = true
        steps.push('allow-clicked')
        await sleep(800)
        continue
      }
      await sleep(500)
    }
    const answer = watcher.answers.find(a => a.done)?.body
    const item = answer?.single_post_resp_list?.[0]
    const sent = watcher.answers.find(a => a.done)
    if (sent?.scheduled === false && item?.item_id) {
      finishUpload(wc, resolved.tabId)
      return { ok: false, account: resolved.tabId, itemId: String(item.item_id), steps, error: 'TikTok took the post WITHOUT a schedule time, so it may be published now instead of later. Check it with tiktok_list_posts and tell the user; do not upload it again.' }
    }
    if (answer?.status_code === 0 && item?.item_id && item.status_code === 0) {
      steps.push('scheduled')
      finishUpload(wc, resolved.tabId)
      return {
        ok: true, via: 'studio-ui', account: resolved.tabId, itemId: String(item.item_id), scheduled: true,
        scheduledFor: target.toISOString(), scheduledLocal: label, allowClicked: allowed, continuedPastContentCheck: continued, scheduleTimeSent: sent?.scheduled ?? null, steps,
        note: 'scheduled through TikTok Studio and confirmed by TikTok with an item id; do not call tiktok_submit_post',
      }
    }
    const seen = answer ? JSON.stringify(answer).slice(0, 300) : 'no answer from TikTok'
    return fail(`TikTok did not confirm the schedule (${seen})`, { allowClicked: allowed, popup })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    watcher?.stop()
    release()
  }
}
