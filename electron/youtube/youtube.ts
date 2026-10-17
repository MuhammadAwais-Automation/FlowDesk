/**
 * YouTube, read through its own web page.
 *
 * One hidden view on its own partition (`social-youtube`), not a Google
 * account from the Accounts page: public research needs no sign-in, and
 * keeping it apart means nothing here can touch the user's channel.
 *
 * What the watch page holds (captured 2026-10-16): ytInitialPlayerResponse
 * carries videoDetails (title, keywords, viewCount, lengthSeconds, channel) and
 * microformat (publishDate, category, likeCount); ytInitialData carries the
 * chapters. Transcripts: a caption URL fetched as-is answers an empty body
 * (its tracks need a proof-of-origin token), but the player's own timedtext
 * request carries that token (`pot=`) and returns every line, so the player is
 * asked to load captions and its request is reused.
 */
import type { WebContents } from 'electron'
import { ensureBackgroundView } from '../sessions'
import { whileAwake } from '../keepAwake'

export const YT_TAB = 'youtube-worker'
export const YT_PARTITION = 'social-youtube'
const HOME = 'https://www.youtube.com/'

export type YouTubeResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; [k: string]: unknown }

export async function getYouTubeView(): Promise<WebContents> {
  return (await ensureBackgroundView(YT_TAB, YT_PARTITION, HOME)).webContents
}

/** The 11-character id from a watch, youtu.be, shorts or embed link, or the id itself. */
export function parseVideoId(input: string): string | null {
  const s = String(input ?? '').trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) return null
    const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/)?.[2] ?? ''
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

// One page, so one request at a time: a second call waits for the first.
let queue: Promise<unknown> = Promise.resolve()
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function openWatch(wc: WebContents, id: string): Promise<boolean> {
  await wc.loadURL(`https://www.youtube.com/watch?v=${id}`).catch(() => {})
  for (let i = 0; i < 40; i++) {
    const seen = await wc.executeJavaScript(`(window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails || {}).videoId || null`).catch(() => null)
    if (seen === id) return true
    await sleep(250)
  }
  return false
}

const detailScript = `(() => {
  const pr = window.ytInitialPlayerResponse || {}
  const vd = pr.videoDetails || {}
  const mf = (pr.microformat || {}).playerMicroformatRenderer || {}
  const num = v => v == null || v === '' ? null : Number(v)
  const chapters = []
  const s = JSON.stringify(window.ytInitialData || {})
  const re = /"chapterRenderer":\\{"title":\\{"simpleText":"((?:[^"\\\\]|\\\\.)*)"\\},"timeRangeStartMillis":(\\d+)/g
  let m
  while ((m = re.exec(s))) chapters.push({ title: JSON.parse('"' + m[1] + '"'), startSeconds: Math.round(Number(m[2]) / 1000) })
  const tracks = ((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []
  const thumbs = (vd.thumbnail || {}).thumbnails || []
  return {
    videoId: vd.videoId,
    title: vd.title || null,
    channel: vd.author || null,
    channelId: vd.channelId || null,
    channelUrl: mf.ownerProfileUrl || null,
    publishedAt: mf.publishDate || null,
    views: num(vd.viewCount),
    likes: num(mf.likeCount),
    lengthSeconds: num(vd.lengthSeconds),
    isShort: mf.isShortsEligible === true && Number(vd.lengthSeconds) <= 180,
    isLive: vd.isLiveContent === true,
    category: mf.category || null,
    tags: vd.keywords || [],
    description: vd.shortDescription || '',
    chapters,
    thumbnail: (thumbs[thumbs.length - 1] || {}).url || null,
    captionLanguages: tracks.map(t => ({ language: t.languageCode, auto: t.kind === 'asr' })),
  }
})()`

function transcriptScript(id: string, language: string | null): string {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const list = ((window.ytInitialPlayerResponse || {}).captions || {}).playerCaptionsTracklistRenderer || {}
    const tracks = list.captionTracks || []
    if (!tracks.length) return { error: 'this video has no captions' }
    const want = ${JSON.stringify(language)}
    // YouTube's own default for the video's audio: its spoken language, not
    // the first of a list that is sorted alphabetically (Arabic first).
    const audio = (list.audioTracks || [])[list.defaultAudioTrackIndex || 0] || {}
    const own = tracks[audio.defaultCaptionTrackIndex != null ? audio.defaultCaptionTrackIndex : -1]
    const track = (want && tracks.find(t => t.languageCode === want && t.kind !== 'asr')) || (want && tracks.find(t => t.languageCode === want))
      || own || tracks.find(t => t.kind === 'asr') || tracks[0]
    if (want && track.languageCode !== want) return { error: 'no ' + want + ' captions; this video has: ' + tracks.map(t => t.languageCode + (t.kind === 'asr' ? ' (auto)' : '')).join(', ') }
    const mp = document.getElementById('movie_player')
    // The browser keeps only 250 resource entries by default and YouTube fills
    // them while loading, so the captions request was never listed.
    performance.setResourceTimingBufferSize(5000)
    performance.clearResourceTimings()
    let url = null
    // An ad plays first on many videos, and captions load only once the video
    // itself plays: wait it out (pressing Skip when offered), up to a minute.
    const until = Date.now() + 60000
    for (let i = 0; i < 24 && !url && Date.now() < until; i++) {
      if (mp.classList.contains('ad-showing')) {
        const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')
        if (skip) skip.click()
        i--
        await sleep(1000)
        continue
      }
      try {
        if (i === 0) { mp.mute(); mp.playVideo() }
        mp.loadModule('captions')
        mp.setOption('captions', 'track', track.kind === 'asr' ? { languageCode: track.languageCode, kind: 'asr' } : { languageCode: track.languageCode })
      } catch (e) {}
      // Choosing the track was enough for some videos; on others (an auto-generated
      // Hindi track, 2026-10-17) only the player's own CC button sends the request.
      const cc = document.querySelector('.ytp-subtitles-button')
      if (cc && (i === 3 || i === 10)) {
        if (cc.getAttribute('aria-pressed') === 'true') { cc.click(); await sleep(400) }
        cc.click()
      }
      await sleep(700)
      url = performance.getEntriesByType('resource').map(e => e.name).reverse()
        .find(u => u.includes('/api/timedtext') && u.includes('v=${id}') && u.includes('pot=') && u.includes('lang=' + track.languageCode))
    }
    try { mp.pauseVideo() } catch (e) {}
    if (!url) return { error: 'the player did not load captions' }
    const u = new URL(url)
    u.searchParams.set('fmt', 'json3')
    const j = await fetch(u).then(r => r.json())
    const lines = (j.events || []).filter(e => e.segs).map(e => ({ startSeconds: Math.round(e.tStartMs / 100) / 10, text: e.segs.map(x => x.utf8).join('').replace(/\\s+/g, ' ').trim() })).filter(l => l.text)
    return { language: track.languageCode, auto: track.kind === 'asr', lines }
  })()`
}

export interface VideoDetailOptions { transcript?: boolean; language?: string | null }

/** One video's details (and transcript) on the YouTube view; the caller holds the queue and keeps it awake. */
export async function videoDetailOn(wc: WebContents, id: string, opts: VideoDetailOptions = {}): Promise<YouTubeResult> {
  const language = typeof opts.language === 'string' && opts.language.trim() ? opts.language.trim() : null
  if (!(await openWatch(wc, id))) return { ok: false, error: `YouTube did not show video ${id} (removed, private, or the page did not load)` }
  const detail = await wc.executeJavaScript(detailScript) as Record<string, unknown>
  if (detail.videoId !== id) return { ok: false, error: `the page shows ${String(detail.videoId)} instead of ${id}` }
  if (!opts.transcript) return { ok: true, ...detail }
  const t = await wc.executeJavaScript(transcriptScript(id, language)) as { error?: string; language?: string; auto?: boolean; lines?: { startSeconds: number; text: string }[] }
  if (t.error) return { ok: true, ...detail, transcript: null, transcriptError: t.error }
  return { ok: true, ...detail, transcript: { language: t.language, auto: t.auto, lineCount: t.lines?.length ?? 0, lines: t.lines } }
}

/** One video's public details, and its transcript when asked. */
export function ytVideoDetail(input: string, opts: VideoDetailOptions = {}): Promise<YouTubeResult> {
  const id = parseVideoId(input)
  if (!id) return Promise.resolve({ ok: false, error: `"${input}" is not a YouTube video link or id` })
  return serialized(async () => {
    const wc = await getYouTubeView()
    return whileAwake(wc, () => videoDetailOn(wc, id, opts))
  })
}
