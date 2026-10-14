/**
 * TikTok video upload + publish over the web API — no Studio UI driving.
 *
 * Captured from one real private upload (probes tkw-02, tkw-07, tkw-09):
 *
 *  1. GET  /api/v1/video/upload/auth/?aid=1988          (cookies)  → video_token_v5 {AK, SK, STS token}
 *  2. GET  /top/v1?Action=ApplyUploadInner&SpaceName=tiktok&FileType=video&IsInner=1&FileSize=…
 *          AWS SigV4, region "gcp", service "vod", AND cookies → upload host, StoreUri, Auth, Vid
 *  3. POST https://<host>/upload/v1/<StoreUri>
 *          multipart: file + post_upload_req {sts2_token, sts2_secret, session_key}
 *          Authorization: <StoreInfo.Auth>, Content-CRC32, X-Storage-U: <uid>,
 *          X-Upload-With-PostUpload: 1                    (no cookies) → the "Inner" upload commits
 *          itself: the response already carries the vid, so no CommitUploadInner for video
 *  4. POST /tiktok/web/project/post/v1/                   (cookies)  → item_id, status_code 0
 *
 * Step 3 authenticates with StoreInfo.Auth alone, so it runs from the main
 * process: a large video never has to cross into the page as base64. Step 2
 * is signed in the main process but sent from the page, for its cookies. Success is the server's item_id, nothing on screen.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
import { getTikTokView, unknownTikTokAccount, type TikTokResult } from './tiktok'

export interface VodToken {
  access_key_id: string
  secret_acess_key: string // sic — TikTok's spelling
  session_token: string
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding, as SigV4 canonical query strings require. */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/**
 * AWS Signature V4 headers for TikTok's VOD gateway (region "gcp", service
 * "vod"), signing x-amz-date and x-amz-security-token as the web client does.
 */
export function signVod(
  method: 'GET' | 'POST',
  url: URL,
  token: VodToken,
  now = new Date(),
  payload = '',
): Record<string, string> {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const region = 'gcp'
  const service = 'vod'
  const query = [...url.searchParams.entries()]
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')
  const headers: Record<string, string> = { 'x-amz-date': amzDate, 'x-amz-security-token': token.session_token }
  if (method === 'POST') headers['x-amz-content-sha256'] = sha256(payload)
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('')
  const canonicalRequest = [method, url.pathname, query, canonicalHeaders, signedHeaders, sha256(payload)].join('\n')
  const scope = `${day}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${token.secret_acess_key}`, day), region), service), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  return {
    'X-Amz-Date': amzDate,
    'x-amz-security-token': token.session_token,
    ...(method === 'POST' ? { 'X-Amz-Content-Sha256': headers['x-amz-content-sha256'] } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${token.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/**
 * TikTok's visibility_type, each read off a real post: 1 only you (tkw-07),
 * 2 friends (tks-03), 0 everyone.
 */
export type TikTokPrivacy = 'public' | 'friends' | 'private'
const VISIBILITY: Record<TikTokPrivacy, number> = { public: 0, private: 1, friends: 2 }

/**
 * Studio only offers scheduling between 15 minutes and 10 days ahead, and
 * not for "Only you" — its privacy picker drops Schedule when that is chosen.
 */
export const SCHEDULE_MIN_MS = 15 * 60_000
export const SCHEDULE_MAX_MS = 10 * 24 * 60 * 60_000

export function checkSchedule(scheduleAt: string | number | undefined, privacy: TikTokPrivacy, now = Date.now()): { atSeconds?: number; error?: string } {
  if (scheduleAt === undefined || scheduleAt === null || scheduleAt === '') return {}
  const ms = typeof scheduleAt === 'number' ? scheduleAt : Date.parse(scheduleAt)
  if (!Number.isFinite(ms)) return { error: `scheduleAt is not a date: ${scheduleAt}` }
  if (privacy === 'private') return { error: 'TikTok cannot schedule an "Only you" post — use friends or public' }
  if (ms < now + SCHEDULE_MIN_MS) return { error: 'scheduleAt must be at least 15 minutes from now' }
  if (ms > now + SCHEDULE_MAX_MS) return { error: 'scheduleAt must be within 10 days' }
  // Studio's picker sends whole minutes in 5-minute steps, seconds zeroed
  // (its lZ(time, true) in the upload bundle, probe tks-02); round up to match.
  const step = 5 * 60_000
  return { atSeconds: Math.ceil(ms / step) * step / 1000 }
}

export function publishBody(videoId: string, caption: string, privacy: TikTokPrivacy, scheduleAtSeconds?: number): string {
  return JSON.stringify({
    // Studio's own form posts as WEB_POST_TYPE_OLD_WEB (0) with or without a
    // schedule (probe tks-02); 3 (a project without cloud edit) posts now but
    // was answered "Invalid parameters" with a schedule. Kept for posting now,
    // where it is proven.
    post_common_info: { creation_id: randomBytes(15).toString('base64url').slice(0, 21), enter_post_page_from: 8, post_type: scheduleAtSeconds ? 0 : 3 },
    feature_common_info_list: [{
      // Unix seconds, as Studio sends it (probe tks-01/02); absent = publish now.
      ...(scheduleAtSeconds ? { schedule_time: scheduleAtSeconds } : {}),
      geofencing_regions: [],
      playlist_name: '',
      playlist_id: '',
      tcm_params: '{"commerce_toggle_info":{}}',
      sound_exemption: 0,
      anchors: [],
      vedit_common_info: { draft: '', video_id: videoId },
      privacy_setting_info: {
        visibility_type: VISIBILITY[privacy],
        allow_duet: null,
        allow_stitch: null,
        allow_comment: 1,
        allow_content_reuse: 1,
        allow_ai_remix: 2,
      },
    }],
    single_post_req_list: [{
      batch_index: 0,
      video_id: videoId,
      is_long_video: 0,
      single_post_feature_info: {
        text: caption,
        text_extra: [],
        markup_text: caption,
        music_info: { origin_volume: '100' },
      },
    }],
  })
}

async function inPage<T>(webContents: Electron.WebContents, fn: string): Promise<T> {
  return webContents.executeJavaScript(`(async function () { ${fn} })()`) as Promise<T>
}

export async function tkApiUploadVideo(opts: {
  filePath: string
  caption?: string
  privacy?: TikTokPrivacy
  /** ISO date or epoch ms; 15 minutes to 10 days ahead. Absent = post now. */
  scheduleAt?: string | number
  account?: string | number
}): Promise<TikTokResult> {
  const privacy: TikTokPrivacy = opts.privacy === 'public' || opts.privacy === 'friends' ? opts.privacy : 'private'
  const caption = String(opts.caption ?? '').trim()
  const steps: string[] = []
  if (!String(opts.filePath ?? '').trim()) return { ok: false, error: 'refusing to upload without a video file path', steps }
  // An unknown account never falls back to another one.
  const bad = unknownTikTokAccount(opts.account)
  if (bad) return { ...bad, steps }
  // Checked before anything is uploaded, so a bad time costs nothing.
  const schedule = checkSchedule(opts.scheduleAt, privacy)
  if (schedule.error) return { ok: false, error: schedule.error, steps }
  // TikTok answered the API's scheduled post "Invalid parameters" (report
  // 2026-10-14), so a schedule goes through the Studio form like a person's.
  if (schedule.atSeconds) {
    if (privacy !== 'public') return { ok: false, error: 'scheduling works for public posts only: pass privacy "public"', steps }
    const { tkScheduleVideo } = await import('./tiktokSchedule')
    return tkScheduleVideo({ filePath: opts.filePath, caption, scheduleAt: opts.scheduleAt as string | number, account: opts.account })
  }
  try {
    const file = await readFile(opts.filePath)
    const view = await getTikTokView(opts.account)
    const wc = view.webContents

    // 1. Upload keys + the numeric uid the storage node wants in X-Storage-U.
    const auth = await inPage<{ token?: VodToken; uid?: string; error?: string }>(wc, `
      var a = await fetch('/api/v1/video/upload/auth/?aid=1988', { credentials: 'include' }).then(function (r) { return r.json() })
      var u = await fetch('/tiktokstudio/api/web/user?needIsVerified=true', { credentials: 'include' }).then(function (r) { return r.json() }).catch(function () { return null })
      var uid = u && (u.userId || (u.userBaseInfo && u.userBaseInfo.UserProfile && u.userBaseInfo.UserProfile.Id))
      if (!a || !a.video_token_v5) return { error: 'upload/auth returned no video token (status ' + (a && a.status_code) + ') — signed in?' }
      return { token: a.video_token_v5, uid: uid ? String(uid) : null }`)
    if (!auth.token) return { ok: false, error: auth.error ?? 'no upload token', steps }
    steps.push('auth')

    // 2. ApplyUploadInner — where to put the bytes.
    const apply = new URL('https://www.tiktok.com/top/v1')
    for (const [k, v] of Object.entries({
      Action: 'ApplyUploadInner', Version: '2020-11-19', SpaceName: 'tiktok', FileType: 'video', IsInner: '1',
      FileSize: String(file.length), s: randomBytes(6).toString('hex'), device_platform: 'web', business_tag: 'tiktok_video_submission_web',
    })) apply.searchParams.set(k, v)
    // Signed here, sent from the page: the gateway also checks the session
    // cookies — the identical signed request from Node was refused with
    // "accessKey can not be found", from the page it answered (probe tkw-13).
    const applied = await inPage<{ status: number; json?: any; text?: string }>(wc, `
      var r = await fetch(${JSON.stringify(apply.toString())}, { credentials: 'include', headers: ${JSON.stringify(signVod('GET', apply, auth.token))} })
      var t = await r.text()
      try { return { status: r.status, json: JSON.parse(t) } } catch (e) { return { status: r.status, text: t.slice(0, 300) } }`)
    const applyRes = { status: applied.status }
    const applyJson = applied.json ?? { raw: applied.text }
    const node = applyJson?.Result?.InnerUploadAddress?.UploadNodes?.[0]
    const store = node?.StoreInfos?.[0]
    if (!node || !store) {
      return { ok: false, error: 'ApplyUploadInner gave no upload node', status: applyRes.status, detail: JSON.stringify(applyJson?.ResponseMetadata?.Error ?? applyJson).slice(0, 300), steps }
    }
    steps.push('apply')

    // 3. The bytes. The response carries the vid: this upload commits itself.
    // Multipart, not raw bytes: a raw body answers code 4000 "Bad Request".
    // post_upload_req hands the storage node what it needs to commit the
    // upload itself (probe tkw-19); session_key comes from ApplyUploadInner.
    const form = new FormData()
    form.append('file', new Blob([file], { type: 'application/octet-stream' }), 'blob')
    form.append('post_upload_req', JSON.stringify({
      sts2_token: auth.token.session_token,
      sts2_secret: auth.token.secret_acess_key,
      session_key: node.SessionKey,
      functions: [],
    }))
    const up = await fetch(`https://${node.UploadHost}/upload/v1/${store.StoreUri}`, {
      method: 'POST',
      headers: {
        Authorization: store.Auth,
        'Content-CRC32': crc32(file).toString(16).padStart(8, '0'),
        'X-Upload-With-PostUpload': '1',
        ...(auth.uid ? { 'X-Storage-U': auth.uid } : {}),
      },
      body: form,
    })
    const upJson = await up.json() as any
    const vid = upJson?.data?.post_upload_resp?.results?.[0]?.vid ?? node.Vid
    if (upJson?.code !== 2000 || !vid) {
      return { ok: false, error: 'file upload rejected', status: up.status, detail: JSON.stringify(upJson).slice(0, 300), steps }
    }
    steps.push('upload')

    // 4. Publish, from the page (it needs the session).
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const published = await inPage<{ status?: number; json?: any; text?: string }>(wc, `
      var r = await fetch('/tiktok/web/project/post/v1/?app_name=tiktok_web&channel=tiktok_web&device_platform=web&tz_name=${encodeURIComponent(tz)}&aid=1988', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(publishBody(vid, caption, privacy))},
      })
      var t = await r.text()
      try { return { status: r.status, json: JSON.parse(t) } } catch (e) { return { status: r.status, text: t.slice(0, 300) } }`)
    const item = published.json?.single_post_resp_list?.[0]
    if (published.json?.status_code !== 0 || !item?.item_id || item.status_code !== 0) {
      return { ok: false, error: 'publish not confirmed', status: published.status, detail: JSON.stringify(published.json ?? published.text).slice(0, 400), videoId: vid, steps }
    }
    steps.push('publish')
    return {
      ok: true, via: 'api', itemId: String(item.item_id), url: `https://www.tiktok.com/video/${item.item_id}`, privacy, videoId: vid, steps,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), steps }
  }
}
