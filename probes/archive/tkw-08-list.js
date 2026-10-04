// @target tiktok.com
// @timeout 30000
return await (async function () {
    try {
      var posts = []
      var cursor = 0
      for (var page = 0; page < 10; page++) {
        var r = await fetch('/tiktok/creator/manage/item_list/v1/?aid=1988&app_name=tiktok_creator_center&device_platform=web', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ cursor: cursor, size: 50, query: { sort_orders: [{ field_name: 'post_time', order: 2 }], conditions: [], is_recent_posts: false } }),
        })
        var text = await r.text()
        if (!text) return { ok: false, error: 'empty response — the request went out unsigned (view not on a Studio page)' }
        var j = JSON.parse(text)
        if (j.status_code !== 0) return { ok: false, error: 'item_list status ' + j.status_code + ': ' + (j.status_msg || '') }
        ;(j.item_list || []).forEach(function (it) {
          posts.push({
            id: it.item_id,
            url: 'https://www.tiktok.com/video/' + it.item_id,
            caption: it.desc || '',
            createdAt: it.create_time ? new Date(Number(it.create_time) * 1000).toISOString() : null,
            // Studio's own code: 1 = Everyone. Anything else is restricted.
            visibility: it.visibility,
            inReview: Boolean(it.in_review),
            views: Number(it.play_count) || 0,
            likes: Number(it.like_count) || 0,
            comments: Number(it.comment_count) || 0,
            shares: Number(it.share_count) || 0,
            saves: Number(it.favorite_count) || 0,
            durationMs: it.duration || null,
          })
        })
        if (!j.has_more) break
        cursor = j.cursor
      }
      return { ok: true, via: 'api', count: posts.length, posts: posts }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()