// @target tiktok.com
// @timeout 45000

const out = {}

async function testSearch(params) {
  const qs = new URLSearchParams(params).toString()
  const url = '/api/search/general/full/?' + qs
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json, text/plain, */*' }
    })
    const json = await res.json()
    const items = (json.data || []).filter(d => d.type === 1 && d.item).map(d => {
      const it = d.item
      return {
        id: it.id,
        desc: it.desc?.slice(0, 50),
        createTime: it.createTime,
        date: it.createTime ? new Date(it.createTime * 1000).toISOString() : null,
        views: it.stats?.playCount,
        likes: it.stats?.diggCount,
        shares: it.stats?.shareCount
      }
    })
    return {
      status: res.status,
      statusCode: json.status_code,
      hasMore: json.has_more,
      cursor: json.cursor,
      count: items.length,
      firstItem: items[0] || null,
      allItemsSummary: items.map(i => ({ id: i.id, date: i.date, views: i.views }))
    }
  } catch (err) {
    return { error: String(err) }
  }
}

// Baseline search
out.baseline = await testSearch({ keyword: 'ai', offset: 0, count: 5 })

// Test publish_time values
out.pub_0 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 0 })
out.pub_1 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 1 })
out.pub_7 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 7 })
out.pub_30 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 30 })
out.pub_90 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 90 })
out.pub_180 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 180 })

// Test sort_type values
out.sort_0 = await testSearch({ keyword: 'ai', offset: 0, count: 5, sort_type: 0 })
out.sort_1 = await testSearch({ keyword: 'ai', offset: 0, count: 5, sort_type: 1 })
out.sort_2 = await testSearch({ keyword: 'ai', offset: 0, count: 5, sort_type: 2 })

// Test combination: sort_type=2 (date) + publish_time=1 (24h)
out.sortDate_pub24h = await testSearch({ keyword: 'ai', offset: 0, count: 5, sort_type: 2, publish_time: 1 })

// Test pagination with cursor / offset
out.page1 = await testSearch({ keyword: 'ai', offset: 0, count: 5, publish_time: 1 })
out.page2 = await testSearch({ keyword: 'ai', offset: 5, count: 5, publish_time: 1 })

return out
