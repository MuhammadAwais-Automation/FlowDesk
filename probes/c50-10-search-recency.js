// @target tiktok.com
// @timeout 60000

const out = {}

async function singleSearch(name, params) {
  const qs = new URLSearchParams(params).toString()
  const url = '/api/search/general/full/?' + qs
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}

    const items = (json?.data || []).filter(d => d.type === 1 && d.item).map(d => {
      const it = d.item
      const now = Math.floor(Date.now() / 1000)
      const diffSec = now - it.createTime
      return {
        id: it.id,
        desc: it.desc?.slice(0, 40),
        createTime: it.createTime,
        diffHours: Math.round(diffSec / 360) / 10,
        views: it.stats?.playCount,
        likes: it.stats?.diggCount
      }
    })

    return {
      status: res.status,
      statusCode: json?.status_code,
      statusMsg: json?.status_msg,
      hasMore: json?.has_more,
      cursor: json?.cursor,
      itemCount: items.length,
      items
    }
  } catch (e) {
    return { error: String(e) }
  }
}

// 1. Unfiltered search
out.unfiltered = await singleSearch('unfiltered', { keyword: 'ai', offset: 0, count: 6 })

// Sleep 4s
await new Promise(r => setTimeout(r, 4000))

// 2. publish_time=1 (last 24 hours)
out.pub_24h = await singleSearch('pub_24h', { keyword: 'ai', offset: 0, count: 6, publish_time: 1 })

// Sleep 4s
await new Promise(r => setTimeout(r, 4000))

// 3. publish_time=7 (this week)
out.pub_7d = await singleSearch('pub_7d', { keyword: 'ai', offset: 0, count: 6, publish_time: 7 })

// Sleep 4s
await new Promise(r => setTimeout(r, 4000))

// 4. sort_type=2 (date / newest)
out.sort_date = await singleSearch('sort_date', { keyword: 'ai', offset: 0, count: 6, sort_type: 2 })

// Sleep 4s
await new Promise(r => setTimeout(r, 4000))

// 5. sort_type=1 (most liked)
out.sort_liked = await singleSearch('sort_liked', { keyword: 'ai', offset: 0, count: 6, sort_type: 1 })

// Sleep 4s
await new Promise(r => setTimeout(r, 4000))

// 6. publish_time=1 + sort_type=2
out.pub24h_sortDate = await singleSearch('pub24h_sortDate', { keyword: 'ai', offset: 0, count: 6, publish_time: 1, sort_type: 2 })

return out
