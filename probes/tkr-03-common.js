// @target tiktok.com
// @goto https://www.tiktok.com/search?q=openai
// @timeout 60000
const out = {}
await new Promise(r => setTimeout(r, 2500))
const cp = new URLSearchParams({ aid: '1988', app_language: 'en', app_name: 'tiktok_web', browser_language: navigator.language, browser_name: 'Mozilla', browser_online: 'true', browser_platform: navigator.platform, browser_version: navigator.appVersion, channel: 'tiktok_web', cookie_enabled: 'true', device_platform: 'web_pc', focus_state: 'true', from_page: 'user', history_len: '2', is_fullscreen: 'false', is_page_visible: 'true', os: 'windows', priority_region: '', referer: '', region: 'PK', screen_height: String(screen.height), screen_width: String(screen.width), tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone, webcast_language: 'en', user_is_login: 'true' })
async function tryF(p) { try { const r = await fetch(p + '&' + cp.toString(), { credentials: 'include', headers: { Accept: 'application/json' } }); const t = await r.text(); return { len: t.length, signed: /X-Gnarly/.test(r.url), head: t.slice(0, 160) } } catch (e) { return { err: String(e) } } }
out.detail = await tryF('/api/user/detail/?uniqueId=alphapaws6')
let sec = ''; try { sec = JSON.parse((await (await fetch('/api/user/detail/?uniqueId=mrbeast&' + cp)).text())).userInfo.user.secUid } catch (e) { out.secErr = String(e) }
out.sec = sec.slice(0, 12)
out.itemList = await tryF('/api/post/item_list/?secUid=' + encodeURIComponent(sec) + '&count=10&cursor=0')
out.itemDetail = await tryF('/api/item/detail/?itemId=7655178209813597472')
// iframe path check: search page inside iframe from here
return out
