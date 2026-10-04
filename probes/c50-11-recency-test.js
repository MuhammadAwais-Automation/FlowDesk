// @target tiktok.com
// @timeout 30000

const out = {}

async function doSearch(params) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch('/api/search/general/full/?' + qs, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  })
  const json = await res.json()
  const items = (json.data || []).filter(d => d.type === 1 && d.item).map(d => {
    const it = d.item
    return {
      id: it.id,
      desc: it.desc?.slice(0, 50),
      createTime: it.createTime,
      isoDate: it.createTime ? new Date(it.createTime * 1000).toISOString() : null,
      views: it.stats?.playCount
    }
  })
  return {
    status: res.status,
    statusCode: json.status_code,
    hasMore: json.has_more,
    cursor: json.cursor,
    count: items.length,
    items
  }
}

out.unfiltered = await doSearch({ keyword: 'cat', offset: 0, count: 5 })
await new Promise(r => setTimeout(r, 3500))
out.publishTime1 = await doSearch({ keyword: 'cat', offset: 0, count: 5, publish_time: 1 })
await new Promise(r => setTimeout(r, 3500))
out.sortType2 = await doSearch({ keyword: 'cat', offset: 0, count: 5, sort_type: 2 })

return out
