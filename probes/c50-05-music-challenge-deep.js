// @target tiktok.com
// @timeout 45000

const out = {}

// Standard TikTok web query parameters
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

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json, text/plain, */*' }
    })
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      return { status: res.status, ok: res.ok, statusCode: json.status_code ?? json.statusCode, json }
    } catch {
      return { status: res.status, ok: res.ok, raw: text.slice(0, 200) }
    }
  } catch (err) {
    return { error: String(err) }
  }
}

// 1. Challenge Detail for #cat (id 7551)
const chRes = await fetchJson(buildUrl('/api/challenge/detail/', { challengeName: 'cat' }))
out.challengeDetail = {
  status: chRes.status,
  statusCode: chRes.statusCode,
  challengeKeys: chRes.json?.challengeInfo?.challenge ? Object.keys(chRes.json.challengeInfo.challenge) : null,
  statsKeys: chRes.json?.challengeInfo?.stats ? Object.keys(chRes.json.challengeInfo.stats) : null,
  stats: chRes.json?.challengeInfo?.stats || null,
  challengeSample: chRes.json?.challengeInfo?.challenge ? {
    id: chRes.json.challengeInfo.challenge.id,
    title: chRes.json.challengeInfo.challenge.title,
    desc: chRes.json.challengeInfo.challenge.desc,
    isCommerce: chRes.json.challengeInfo.challenge.isCommerce
  } : null
}

// Wait 3.5s to respect rate limits
await new Promise(r => setTimeout(r, 3500))

// 2. Music Detail test with language & aid
// Test sound id: 7198472533036435458 or other
const mRes = await fetchJson(buildUrl('/api/music/detail/', { musicId: '7198472533036435458' }))
out.musicDetail = {
  status: mRes.status,
  statusCode: mRes.statusCode,
  statusMsg: mRes.json?.status_msg ?? mRes.json?.statusMsg,
  keys: mRes.json ? Object.keys(mRes.json) : null,
  musicInfo: mRes.json?.musicInfo || null,
  rawSnippet: !mRes.json?.musicInfo ? JSON.stringify(mRes.json)?.slice(0, 300) : null
}

// Wait 3.5s
await new Promise(r => setTimeout(r, 3500))

// 3. Music item list tests
const mList1 = await fetchJson(buildUrl('/api/music/item_list/', { musicID: '7198472533036435458', count: '10', cursor: '0' }))
const mList2 = await fetchJson(buildUrl('/api/music/item_list/', { musicId: '7198472533036435458', count: '10', cursor: '0' }))
out.musicItemList = {
  mList1: { status: mList1.status, statusCode: mList1.statusCode, msg: mList1.json?.status_msg ?? mList1.json?.statusMsg, keys: mList1.json ? Object.keys(mList1.json) : null },
  mList2: { status: mList2.status, statusCode: mList2.statusCode, msg: mList2.json?.status_msg ?? mList2.json?.statusMsg, keys: mList2.json ? Object.keys(mList2.json) : null }
}

return out
