/**
 * TikTok profile read, over the in-session API (probes tkp-03..tkp-10).
 *
 * Two plain GETs, no signing needed:
 *  - /tiktokstudio/api/web/user — the live bio (profileBio) and privacy flag
 *  - /@<uniqueId> page HTML — its __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON
 *    carries user-detail (nickname, avatar, secUid) and stats
 *
 * Writing the bio goes through TikTok's own page client (TIKTOK_CLIENT_FN):
 * POST /api/update/profile/ with form body signature=<bio>&tt_csrf_token=…,
 * which needs the tt-ticket-guard signed headers only that client adds.
 * Verified live (probe tkp-22): status_code 0, and the new bio showed on both
 * Studio and the public profile ~4s later — reads right after the write still
 * return the old value, which is why this polls before reporting.
 */
import { getTikTokView, ensureTikTokWebApp, TIKTOK_CLIENT_FN, type TikTokResult } from './tiktok'

/** TikTok's own counter: emoji count double. Its limit is 80. */
export function tiktokBioLength(bio: string): number {
  return [...bio].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0)
}
export const TIKTOK_BIO_LIMIT = 80

export function tiktokUpdateBioScript(bio: string): string {
  return `(async function () {
    ${TIKTOK_CLIENT_FN}
    try {
      var h = tiktokClient()
      if (!h) return { ok: false, error: 'TikTok page client not found — is a www.tiktok.com page loaded?' }
      var want = ${JSON.stringify(bio)}
      var res = await h.post('/api/update/profile/', {
        headers: { 'tt-csrf-token': h.csrfToken },
        body: 'signature=' + encodeURIComponent(want) + '&tt_csrf_token=' + encodeURIComponent(h.csrfToken),
      })
      if (!res || res.status_code !== 0) return { ok: false, error: 'profile update not confirmed', status_code: res && res.status_code, status_msg: res && res.status_msg }
      // Eventually consistent: poll until the bio reads back.
      for (var i = 0; i < 8; i++) {
        await new Promise(function (r) { setTimeout(r, 1500) })
        var j = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true&_=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.json() }).catch(function () { return null })
        if (j && j.userExtra && j.userExtra.profileBio === want) return { ok: true, updated: true, via: 'api', bio: want }
      }
      return { ok: false, error: 'TikTok accepted the update (status_code 0) but the new bio did not read back within 12s' }
    } catch (e) {
      return { ok: false, error: e instanceof Response ? 'profile update failed: HTTP ' + e.status : String(e && e.message || e) }
    }
  })()`
}

export async function tkUpdateProfile(opts: { bio: string; account?: string | number }): Promise<TikTokResult> {
  const bio = String(opts.bio ?? '')
  const length = tiktokBioLength(bio)
  // Over the limit TikTok still answers status_code 0 and silently keeps the
  // old bio, so refuse here instead of reporting a success that did nothing.
  if (length > TIKTOK_BIO_LIMIT) return { ok: false, error: `bio is ${length} by TikTok's count (emoji count 2); the limit is ${TIKTOK_BIO_LIMIT}` }
  try {
    const view = await getTikTokView(opts.account)
    await ensureTikTokWebApp(view.webContents)
    const out = await view.webContents.executeJavaScript(tiktokUpdateBioScript(bio))
    return out && typeof out === 'object' ? out as TikTokResult : { ok: false, error: 'bridge returned a non-object' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function tiktokProfileScript(): string {
  return `(async function () {
    try {
      var studio = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true', { credentials: 'include' })
      var sj = null
      try { sj = await studio.json() } catch (e) {}
      var info = (sj && (sj.userBaseInfo || sj.data || sj)) || {}
      var base = info.UserProfile || info.userProfile || info
      var uniqueId = (base && (base.UniqueId || base.uniqueId || base.unique_id)) || null
      if (!uniqueId) {
        var acc = await fetch('/passport/web/account/info/?aid=1988', { credentials: 'include' })
        var aj = null
        try { aj = await acc.json() } catch (e) {}
        uniqueId = aj && aj.data && aj.data.username
      }
      if (!uniqueId) return { ok: false, error: 'not signed in to TikTok (no username from studio or passport)' }

      var page = await fetch('/@' + encodeURIComponent(uniqueId), { credentials: 'include' })
      var html = await page.text()
      var m = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
      var scope = null
      try { scope = m ? JSON.parse(m[1]).__DEFAULT_SCOPE__ : null } catch (e) {}
      var detail = scope && scope['webapp.user-detail'] && scope['webapp.user-detail'].userInfo
      var u = (detail && detail.user) || {}
      var st = (detail && (detail.statsV2 || detail.stats)) || {}
      var extra = (sj && (sj.userExtra || (sj.data && sj.data.userExtra))) || {}
      return {
        ok: true,
        via: 'api',
        profile: {
          uid: u.id || null,
          uniqueId: u.uniqueId || uniqueId,
          nickname: u.nickname || null,
          bio: extra.profileBio != null ? extra.profileBio : (u.signature || null),
          avatar: u.avatarLarger || u.avatarMedium || null,
          secUid: u.secUid || null,
          followers: Number(st.followerCount) || 0,
          following: Number(st.followingCount) || 0,
          likes: Number(st.heartCount || st.heart) || 0,
          videoCount: Number(st.videoCount) || 0,
          privateAccount: Boolean(u.privateAccount),
          studioIsPrivate: extra.isPrivate != null ? Boolean(extra.isPrivate) : null,
        },
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export async function tkGetProfile(account?: string | number): Promise<TikTokResult> {
  try {
    const view = await getTikTokView(account)
    const out = await view.webContents.executeJavaScript(tiktokProfileScript())
    return out && typeof out === 'object' ? out as TikTokResult : { ok: false, error: 'bridge returned a non-object' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
