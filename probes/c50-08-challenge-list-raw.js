// @target tiktok.com
// @timeout 45000

const out = {}

const commonParams = {
  aid: '1988',
  app_language: 'en',
  app_name: 'tiktok_web',
  browser_language: 'en-US',
  browser_name: 'Mozilla',
  browser_online: 'true',
  browser_platform: 'Win32',
  channel: 'tiktok_web',
  cookie_enabled: 'true',
  device_platform: 'web_pc',
  focus_state: 'true',
  is_fullscreen: 'false',
  is_page_visible: 'true',
  language: 'en',
  os: 'windows',
  priority_region: '',
  region: 'US',
  webcast_language: 'en'
}

function buildUrl(path, params) {
  const all = { ...commonParams, ...params }
  return path + '?' + new URLSearchParams(all).toString()
}

async function inspect(url) {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return {
    status: res.status,
    len: text.length,
    isJson: !!json,
    jsonKeys: json ? Object.keys(json) : null,
    statusCode: json ? (json.status_code ?? json.statusCode) : null,
    statusMsg: json ? (json.status_msg ?? json.statusMsg) : null,
    rawSnippet: text.slice(0, 200)
  }
}

// Test challenge item_list variations
out.var1 = await inspect(buildUrl('/api/challenge/item_list/', { challengeID: '183145', count: '10', cursor: '0' }))
await new Promise(r => setTimeout(r, 3500))

out.var2 = await inspect(buildUrl('/api/challenge/item_list/', { challenge_id: '183145', count: '10', cursor: '0' }))
await new Promise(r => setTimeout(r, 3500))

out.var3 = await inspect(buildUrl('/api/challenge/item_list/', { ch_id: '183145', count: '10', cursor: '0' }))
await new Promise(r => setTimeout(r, 3500))

// Test tag page SSR hydration: fetch https://www.tiktok.com/tag/ai
const tagPageRes = await fetch('https://www.tiktok.com/tag/ai', { credentials: 'include' })
const tagHtml = await tagPageRes.text()
const tagMatch = tagHtml.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
if (tagMatch) {
  try {
    const raw = JSON.parse(tagMatch[1])
    const scope = raw['__DEFAULT_SCOPE__'] || {}
    out.tagPageScopeKeys = Object.keys(scope)
    const chDetail = scope['webapp.challenge-detail'] || {}
    out.tagPageChallengeDetailKeys = Object.keys(chDetail)
    out.tagPageItemsCount = Array.isArray(chDetail.itemList) ? chDetail.itemList.length : 0
    if (chDetail.itemList?.[0]) {
      out.tagPageFirstItem = {
        id: chDetail.itemList[0].id,
        desc: chDetail.itemList[0].desc?.slice(0, 50),
        createTime: chDetail.itemList[0].createTime,
        stats: chDetail.itemList[0].stats
      }
    }
  } catch (e) {
    out.tagHydrationErr = String(e)
  }
} else {
  out.tagPageMatch = false
}

return out
