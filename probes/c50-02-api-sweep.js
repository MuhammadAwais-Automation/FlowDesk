// @target tiktok.com
// @timeout 45000

const out = {}

async function testApi(url) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch (e) {}

    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type'),
      isJson: !!json,
      statusCode: json ? (json.status_code ?? json.statusCode) : null,
      statusMsg: json ? (json.status_msg ?? json.statusMsg) : null,
      dataKeys: json && json.data ? (Array.isArray(json.data) ? `array[${json.data.length}]` : Object.keys(json.data)) : (json ? Object.keys(json) : null),
      sample: json ? (Array.isArray(json.data) && json.data[0] ? Object.keys(json.data[0]) : (json.itemInfo ? Object.keys(json.itemInfo) : null)) : null,
      rawSnippet: text.slice(0, 300)
    }
  } catch (err) {
    return { error: String(err) }
  }
}

// 1. Search general
out.searchGeneral = await testApi('/api/search/general/full/?keyword=cats&offset=0&count=5')

// 1b. Search general with sort_type and publish_time
out.searchGeneralSortNewest = await testApi('/api/search/general/full/?keyword=cats&offset=0&count=5&sort_type=1')
out.searchGeneralSortDate = await testApi('/api/search/general/full/?keyword=cats&offset=0&count=5&sort_type=2')
out.searchGeneralPublishTime24h = await testApi('/api/search/general/full/?keyword=cats&offset=0&count=5&publish_time=1')

// 2. Search item / video
out.searchItem = await testApi('/api/search/item/full/?keyword=cats&offset=0&count=5')
out.searchVideo = await testApi('/api/search/video/full/?keyword=cats&offset=0&count=5')

// 3. Challenge / hashtag detail & item list
out.challengeDetailName = await testApi('/api/challenge/detail/?challengeName=cat')
out.challengeDetailAid = await testApi('/api/challenge/detail/?challengeName=cat&aid=1988')
out.challengeItemList = await testApi('/api/challenge/item_list/?challengeId=15923&count=5&cursor=0')

// 4. Music detail & item list
out.musicDetail = await testApi('/api/music/detail/?musicId=7198472533036435458')
out.musicItemList = await testApi('/api/music/item_list/?musicId=7198472533036435458&count=5&cursor=0')

return out
