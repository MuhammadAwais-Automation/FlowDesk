// @target tiktok.com
// @goto https://www.tiktok.com/@sr_kittyyyy
// @timeout 45000
await new Promise(r => setTimeout(r, 6000))
const d = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}')
const ud = d.__DEFAULT_SCOPE__?.['webapp.user-detail']
const secUid = ud?.userInfo?.user?.secUid
const r = await fetch('/api/post/item_list/?aid=1988&app_language=en&secUid=' + encodeURIComponent(secUid) + '&count=35&cursor=0&coverFormat=2&post_item_list_request_type=0')
const t = await r.text()
let j = null; try { j = JSON.parse(t) } catch {}
const perf = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/api/post/item_list')).map(n => n.split('?')[1].split('&').filter(p => !/^(X-|msToken|WebId|browser|screen|os=|tz|device|history|cookie|focus|is_|verify|region|odin|priority|root|referer|channel|app_key|appkey|app_name|webcast|data_coll|user_is)/.test(p)).join('&'))
return { url: location.href, stats: ud?.userInfo?.stats, len: t.length, n: j?.itemList?.length, ages: (j?.itemList || []).map(i => +((Date.now() / 1000 - i.createTime) / 3600).toFixed(1)), pageCalls: perf.slice(0, 3) }
