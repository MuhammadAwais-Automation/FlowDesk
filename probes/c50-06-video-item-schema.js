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

// 1. Fetch a real search result item to extract pristine video schema
const searchRes = await fetch('/api/search/general/full/?keyword=cat&offset=0&count=3', {
  credentials: 'include',
  headers: { 'Accept': 'application/json' }
})
const searchJson = await searchRes.json()
const sampleItem = searchJson.data?.find(d => d.type === 1 && d.item)?.item

if (!sampleItem) {
  return { error: 'No sample item found in search' }
}

out.videoRootKeys = Object.keys(sampleItem)
out.musicSchema = sampleItem.music ? {
  keys: Object.keys(sampleItem.music),
  id: sampleItem.music.id,
  title: sampleItem.music.title,
  authorName: sampleItem.music.authorName,
  original: sampleItem.music.original,
  duration: sampleItem.music.duration,
  album: sampleItem.music.album,
  rawMusic: sampleItem.music
} : null

out.challengesSchema = sampleItem.challenges ? sampleItem.challenges.map(ch => ({
  keys: Object.keys(ch),
  id: ch.id,
  title: ch.title,
  desc: ch.desc,
  isCommerce: ch.isCommerce,
  stats: ch.stats
})) : []

out.textExtraSchema = sampleItem.textExtra ? sampleItem.textExtra.map(te => ({
  keys: Object.keys(te),
  awemeId: te.awemeId,
  start: te.start,
  end: te.end,
  hashtagName: te.hashtagName,
  hashtagId: te.hashtagId,
  type: te.type,
  subType: te.subType,
  isCommerce: te.isCommerce
})) : []

// Wait 3.5s
await new Promise(r => setTimeout(r, 3500))

// 2. Query Music Detail and Music Item List using the real music.id
const realMusicId = sampleItem.music?.id
if (realMusicId) {
  // Test music detail with musicId and musicID
  const mdRes1 = await fetch(buildUrl('/api/music/detail/', { musicId: realMusicId }), { credentials: 'include' })
  const mdJson1 = await mdRes1.json().catch(() => null)
  
  const mdRes2 = await fetch(buildUrl('/api/music/detail/', { musicID: realMusicId }), { credentials: 'include' })
  const mdJson2 = await mdRes2.json().catch(() => null)
  
  out.realMusicDetail = {
    by_musicId: { status: mdRes1.status, statusCode: mdJson1?.statusCode ?? mdJson1?.status_code, msg: mdJson1?.statusMsg ?? mdJson1?.status_msg, musicInfo: mdJson1?.musicInfo },
    by_musicID: { status: mdRes2.status, statusCode: mdJson2?.statusCode ?? mdJson2?.status_code, msg: mdJson2?.statusMsg ?? mdJson2?.status_msg, musicInfo: mdJson2?.musicInfo }
  }

  // Wait 3.5s
  await new Promise(r => setTimeout(r, 3500))

  // Test music item list with musicID
  const mlRes = await fetch(buildUrl('/api/music/item_list/', { musicID: realMusicId, count: '6', cursor: '0' }), { credentials: 'include' })
  const mlJson = await mlRes.json().catch(() => null)
  out.realMusicItemList = {
    status: mlRes.status,
    statusCode: mlJson?.status_code ?? mlJson?.statusCode,
    hasMore: mlJson?.hasMore ?? mlJson?.has_more,
    cursor: mlJson?.cursor,
    itemCount: Array.isArray(mlJson?.itemList) ? mlJson.itemList.length : (Array.isArray(mlJson?.data) ? mlJson.data.length : 0),
    sampleKeys: mlJson ? Object.keys(mlJson) : null,
    firstVideo: mlJson?.itemList?.[0] ? {
      id: mlJson.itemList[0].id,
      desc: mlJson.itemList[0].desc?.slice(0, 50),
      createTime: mlJson.itemList[0].createTime,
      views: mlJson.itemList[0].stats?.playCount
    } : null
  }
}

// 3. Test challenge item list with challengeID
const realChId = sampleItem.challenges?.[0]?.id || sampleItem.textExtra?.find(t => t.hashtagId)?.hashtagId
if (realChId) {
  // Wait 3.5s
  await new Promise(r => setTimeout(r, 3500))

  const chListRes = await fetch(buildUrl('/api/challenge/item_list/', { challengeID: realChId, count: '6', cursor: '0' }), { credentials: 'include' })
  const chListJson = await chListRes.json().catch(() => null)
  out.realChallengeItemList = {
    status: chListRes.status,
    statusCode: chListJson?.status_code ?? chListJson?.statusCode,
    hasMore: chListJson?.hasMore ?? chListJson?.has_more,
    cursor: chListJson?.cursor,
    sampleKeys: chListJson ? Object.keys(chListJson) : null,
    itemCount: Array.isArray(chListJson?.itemList) ? chListJson.itemList.length : 0,
    firstVideo: chListJson?.itemList?.[0] ? {
      id: chListJson.itemList[0].id,
      desc: chListJson.itemList[0].desc?.slice(0, 50),
      createTime: chListJson.itemList[0].createTime,
      views: chListJson.itemList[0].stats?.playCount
    } : null
  }
}

return out
