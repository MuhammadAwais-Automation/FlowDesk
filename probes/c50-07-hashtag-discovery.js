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

// 1. Search for a specific hashtag query to guarantee hashtag items
const searchRes = await fetch('/api/search/general/full/?keyword=%23ai&offset=0&count=5', {
  credentials: 'include',
  headers: { 'Accept': 'application/json' }
})
const searchJson = await searchRes.json()
const items = (searchJson.data || []).filter(d => d.type === 1 && d.item).map(d => d.item)

out.itemsFound = items.length
out.hashtagPlacements = items.map(it => ({
  id: it.id,
  desc: it.desc?.slice(0, 60),
  hasChallenges: !!it.challenges,
  challengesCount: it.challenges?.length || 0,
  challengesSample: it.challenges?.slice(0, 2),
  hasTextExtra: !!it.textExtra,
  textExtraCount: it.textExtra?.length || 0,
  textExtraSample: it.textExtra?.slice(0, 3),
  hasContents: !!it.contents,
  contentsCount: it.contents?.length || 0,
  contentsSample: it.contents?.slice(0, 2)
}))

// Wait 3.5s
await new Promise(r => setTimeout(r, 3500))

// 2. Test Challenge Detail by challengeName and by challengeId
const chName = 'ai'
const chDetailRes = await fetch(buildUrl('/api/challenge/detail/', { challengeName: chName }), { credentials: 'include' })
const chDetailJson = await chDetailRes.json().catch(() => null)

out.challengeDetail = {
  status: chDetailRes.status,
  statusCode: chDetailJson?.status_code ?? chDetailJson?.statusCode,
  challenge: chDetailJson?.challengeInfo?.challenge ? {
    id: chDetailJson.challengeInfo.challenge.id,
    title: chDetailJson.challengeInfo.challenge.title,
    desc: chDetailJson.challengeInfo.challenge.desc,
    profileLarger: chDetailJson.challengeInfo.challenge.profileLarger,
    isCommerce: chDetailJson.challengeInfo.challenge.isCommerce
  } : null,
  stats: chDetailJson?.challengeInfo?.stats || null
}

const realChallengeId = chDetailJson?.challengeInfo?.challenge?.id || '15923'

// Wait 3.5s
await new Promise(r => setTimeout(r, 3500))

// 3. Test Challenge Item List with challengeID vs challengeId
const chListRes1 = await fetch(buildUrl('/api/challenge/item_list/', { challengeID: realChallengeId, count: '5', cursor: '0' }), { credentials: 'include' })
const chListJson1 = await chListRes1.json().catch(() => null)

const chListRes2 = await fetch(buildUrl('/api/challenge/item_list/', { challengeId: realChallengeId, count: '5', cursor: '0' }), { credentials: 'include' })
const chListJson2 = await chListRes2.json().catch(() => null)

out.challengeItemListTests = {
  with_challengeID: {
    status: chListRes1.status,
    statusCode: chListJson1?.status_code ?? chListJson1?.statusCode,
    hasMore: chListJson1?.hasMore ?? chListJson1?.has_more,
    cursor: chListJson1?.cursor,
    itemCount: Array.isArray(chListJson1?.itemList) ? chListJson1.itemList.length : 0,
    keys: chListJson1 ? Object.keys(chListJson1) : null,
    firstItem: chListJson1?.itemList?.[0] ? {
      id: chListJson1.itemList[0].id,
      desc: chListJson1.itemList[0].desc?.slice(0, 50),
      createTime: chListJson1.itemList[0].createTime,
      views: chListJson1.itemList[0].stats?.playCount
    } : null
  },
  with_challengeId: {
    status: chListRes2.status,
    statusCode: chListJson2?.status_code ?? chListJson2?.statusCode,
    msg: chListJson2?.status_msg ?? chListJson2?.statusMsg,
    keys: chListJson2 ? Object.keys(chListJson2) : null
  }
}

return out
