// @target tiktok.com
// @timeout 30000

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

// Sound ID from a widely used sound (e.g. 7198472533036435458 or 7096756891392658182)
// Let's first search a top viral sound ID
const searchRes = await fetch('/api/search/general/full/?keyword=viral%20sound&offset=0&count=3', { credentials: 'include' })
const searchJson = await searchRes.json()
const soundItem = searchJson.data?.find(d => d.type === 1 && d.item?.music)?.item?.music

const testMusicId = soundItem?.id || '7690100946944133902'
out.testMusicId = testMusicId
out.musicTitle = soundItem?.title

// Page 1
const p1Res = await fetch(buildUrl('/api/music/item_list/', { musicID: testMusicId, count: '4', cursor: '0' }), { credentials: 'include' })
const p1 = await p1Res.json().catch(() => null)

out.page1 = {
  status: p1Res.status,
  statusCode: p1?.status_code,
  cursor: p1?.cursor,
  hasMore: p1?.hasMore ?? p1?.has_more,
  count: p1?.itemList?.length || 0,
  firstId: p1?.itemList?.[0]?.id
}

if (p1?.hasMore && p1?.cursor !== undefined) {
  await new Promise(r => setTimeout(r, 3500))
  const p2Res = await fetch(buildUrl('/api/music/item_list/', { musicID: testMusicId, count: '4', cursor: String(p1.cursor) }), { credentials: 'include' })
  const p2 = await p2Res.json().catch(() => null)
  out.page2 = {
    status: p2Res.status,
    statusCode: p2?.status_code,
    cursor: p2?.cursor,
    hasMore: p2?.hasMore ?? p2?.has_more,
    count: p2?.itemList?.length || 0,
    firstId: p2?.itemList?.[0]?.id
  }
}

return out
