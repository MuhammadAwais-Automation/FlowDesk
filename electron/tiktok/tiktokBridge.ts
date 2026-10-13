/**
 * TikTok bridge — JavaScript evaluated inside the live TikTok session partition.
 *
 * Provides research, competitive intelligence, trending explore feeds,
 * keyword/hashtag search, and video performance metrics.
 * Operates without requiring authentication, but also tracks logged-in
 * state when active.
 */

export interface TikTokFeedOptions {
  limit?: number
}

export function tiktokStatusScript(): string {
  return `(() => {
    try {
      const isStudio = window.location.href.includes('tiktokstudio') && !window.location.href.includes('/login')
      const isAuth = Boolean(
        isStudio ||
        document.querySelector('[data-e2e="profile-icon"], [class*="Avatar"], [data-e2e="user-avatar"]') ||
        document.cookie.includes('sessionid=')
      )
      const usernameEl = document.querySelector('[data-e2e="profile-icon"] a, [data-e2e="user-title"], [data-e2e="nav-profile"]')
      let userHandle = usernameEl ? (usernameEl.getAttribute('href') || usernameEl.innerText || '').replace(/^\\/@?/, '') : null

      if (!userHandle) {
        const link = Array.from(document.querySelectorAll('a[href*="/@"]')).find(a => !a.href.includes('/tag/') && !a.href.includes('/music/'))
        if (link) {
          const m = link.href.match(/@([^/?#]+)/)
          if (m) userHandle = m[1]
        }
      }

      return {
        ok: true,
        authenticated: isAuth,
        username: userHandle || (isAuth ? 'logged_in_user' : null),
        mode: isAuth ? 'creator' : 'guest_research',
        currentUrl: window.location.href,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokFeedScript(limit = 20): string {
  return `(() => {
    try {
      const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
      const seen = new Set()
      const extracted = []

      for (const a of videoLinks) {
        const href = a.href
        const match = href.match(/@([^/]+)\\/video\\/(\\d+)/)
        if (!match) continue
        const author = match[1]
        const videoId = match[2]
        if (seen.has(videoId)) continue
        seen.add(videoId)

        const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="feed"]') || a.parentElement
        const lines = card ? card.innerText.split('\\n').map(t => t.trim()).filter(Boolean) : []
        const img = card ? card.querySelector('img') : null

        // Detect views from lines
        const viewLine = lines.find(l => /^[\\d.]+[KMB]?$/i.test(l)) || lines[0] || null

        extracted.push({
          author,
          videoId,
          url: href,
          views: viewLine,
          coverImg: img ? (img.currentSrc || img.src || null) : null,
          title: lines.filter(l => l !== viewLine).join(' ') || null,
        })
      }

      // The /explore grid renders its cards without /video/ links (and as empty
      // placeholders in a background window), so read the item list the grid's
      // own React props hold (probes tkf-01..05: listInfo.items, the
      // /api/explore/item_list/ items).
      let via = 'dom'
      if (extracted.length === 0) {
        const grid = document.querySelector('[data-e2e="explore-item-list"]')
        const cell = grid && grid.children[0]
        const fiberKey = cell ? Object.keys(cell).find(k => k.startsWith('__reactFiber')) : null
        let f = fiberKey ? cell[fiberKey] : null
        let items = null
        for (let i = 0; f && i < 20 && !items; i++, f = f.return) {
          const p = f.memoizedProps
          if (p && p.listInfo && Array.isArray(p.listInfo.items)) items = p.listInfo.items
        }
        for (const it of items || []) {
          if (!it || !it.id || seen.has(String(it.id))) continue
          seen.add(String(it.id))
          const author = (it.author && it.author.uniqueId) || null
          const s = it.stats || {}
          extracted.push({
            author,
            videoId: String(it.id),
            url: 'https://www.tiktok.com/@' + (author || 'user') + '/video/' + it.id,
            views: Number(s.playCount) || null,
            likes: Number(s.diggCount) || null,
            comments: Number(s.commentCount) || null,
            shares: Number(s.shareCount) || null,
            coverImg: (it.video && (it.video.cover || it.video.originCover)) || null,
            title: it.desc || null,
            music: (it.music && it.music.title) || null,
            createTime: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : null,
          })
        }
        if (extracted.length) via = 'react_props'
      }

      return {
        ok: true,
        via,
        url: window.location.href,
        count: extracted.length,
        videos: extracted.slice(0, ${Math.max(1, Math.min(50, limit))}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokSearchScript(query: string, limit = 20): string {
  const safeLimit = Math.max(1, Math.min(50, limit))
  return `(() => {
    try {
      const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
      const seen = new Set()
      const cards = []

      for (const a of videoLinks) {
        const href = a.href
        const match = href.match(/@([^/]+)\\/video\\/(\\d+)/)
        if (!match) continue
        const author = match[1]
        const videoId = match[2]
        if (seen.has(videoId)) continue
        seen.add(videoId)

        const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="search"]') || a.parentElement
        const lines = card ? card.innerText.split('\\n').map(t => t.trim()).filter(Boolean) : []
        const img = card ? card.querySelector('img') : null
        const isTopLiked = lines.some(l => l.toLowerCase().includes('top liked'))

        const viewLine = lines.find(l => /^[\\d.]+[KMB]?$/i.test(l)) || null
        const captionLines = lines.filter(l => l !== viewLine && !l.toLowerCase().includes('top liked'))

        cards.push({
          author,
          videoId,
          url: href,
          views: viewLine,
          topLiked: isTopLiked,
          caption: captionLines.join(' ') || null,
          coverImg: img ? (img.currentSrc || img.src || null) : null,
        })
      }

      return {
        ok: true,
        query: ${JSON.stringify(query)},
        url: window.location.href,
        count: cards.length,
        videos: cards.slice(0, ${safeLimit}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokVideoDetailScript(): string {
  return `(() => {
    try {
      const descEl = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')
      const musicEl = document.querySelector('[data-e2e="browse-music"], [data-e2e="video-music"]')
      const likeEl = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]')
      const commentEl = document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]')
      const shareEl = document.querySelector('[data-e2e="share-count"], [data-e2e="browse-share-count"]')
      const authorEl = document.querySelector('[data-e2e="browse-username"], [data-e2e="user-title"]')

      const rawCaption = descEl ? descEl.innerText.trim() : ''
      const hashtags = (rawCaption.match(/#[^\\s#]+/g) || [])

      let uploadedAt = null
      let uploadTimestamp = null
      const urlMatch = window.location.href.match(/\/video\/(\d+)/)
      if (urlMatch) {
        try {
          const ts = Number(BigInt(urlMatch[1]) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) {
            uploadTimestamp = ts
            uploadedAt = new Date(ts * 1000).toISOString()
          }
        } catch (e) {}
      }

      // Also check DOM date badge if visible
      const dateEl = document.querySelector('[data-e2e="browser-nickname"] ~ span, [class*="SpanOtherInfos"], [data-e2e="video-publish-time"]')
      const domDate = dateEl ? dateEl.innerText.trim() : null

      return {
        ok: true,
        url: window.location.href,
        author: authorEl ? authorEl.innerText.trim() : null,
        caption: rawCaption,
        hashtags,
        music: musicEl ? musicEl.innerText.trim() : null,
        likes: likeEl ? likeEl.innerText.trim() : null,
        comments: commentEl ? commentEl.innerText.trim() : null,
        shares: shareEl ? shareEl.innerText.trim() : null,
        uploadedAt,
        uploadTimestamp,
        publishedDateText: domDate,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokSuggestScript(seedKeyword: string): string {
  return `(() => {
    try {
      const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
      const allText = []
      const hashtagCounts = {}
      const phrases = []

      for (const a of videoLinks) {
        const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="search"]') || a.parentElement
        if (!card) continue
        const lines = card.innerText.split('\\n').map(t => t.trim()).filter(Boolean)
        const caption = lines.filter(l => !/^[\\d.]+[KMB]?$/i.test(l) && !l.toLowerCase().includes('top liked')).join(' ')
        if (!caption) continue

        allText.push(caption)
        const tags = caption.match(/#[^\\s#]+/g) || []
        for (const tag of tags) {
          const clean = tag.toLowerCase()
          hashtagCounts[clean] = (hashtagCounts[clean] || 0) + 1
        }
      }

      // Sort hashtags by frequency
      const topHashtags = Object.entries(hashtagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, occurrences: count }))

      // Generate keyword recommendations
      const seedClean = ${JSON.stringify(seedKeyword)}.toLowerCase()
      const recommendedKeywords = [
        seedClean + ' story',
        seedClean + ' video generator',
        seedClean + ' viral trends',
        seedClean + ' tutorial',
        seedClean + ' 3d animation',
        seedClean + ' comedy cartoon',
      ]

      return {
        ok: true,
        seed: ${JSON.stringify(seedKeyword)},
        topHashtags,
        recommendedKeywords,
        sampleCaptions: allText.slice(0, 5),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokOutlierScript(creatorHandle: string): string {
  return `(() => {
    try {
      function parseViews(str) {
        if (!str) return 0
        str = String(str).trim().toUpperCase()
        if (str.endsWith('K')) return Math.round(parseFloat(str) * 1000)
        if (str.endsWith('M')) return Math.round(parseFloat(str) * 1000000)
        if (str.endsWith('B')) return Math.round(parseFloat(str) * 1000000000)
        const n = parseFloat(str)
        return isNaN(n) ? 0 : Math.round(n)
      }

      const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
      const seen = new Set()
      const list = []

      for (const a of videoLinks) {
        const href = a.href
        const match = href.match(/@([^/]+)\\/video\\/(\\d+)/)
        if (!match) continue
        const author = match[1]
        const videoId = match[2]
        if (seen.has(videoId)) continue
        seen.add(videoId)

        const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="search"]') || a.parentElement
        const img = card ? card.querySelector('img') : null
        const coverImg = img ? (img.src || img.getAttribute('data-src')) : null
        const lines = card ? card.innerText.split('\\n').map(t => t.trim()).filter(Boolean) : []
        const isTopLiked = lines.some(l => l.toLowerCase().includes('top liked'))
        const viewLine = lines.find(l => /^[\\d.]+[KMB]?$/i.test(l)) || null
        const captionLines = lines.filter(l => l !== viewLine && !l.toLowerCase().includes('top liked'))

        let uploadedAt = null
        let uploadTimestamp = null
        try {
          const ts = Number(BigInt(videoId) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) {
            uploadTimestamp = ts
            uploadedAt = new Date(ts * 1000).toISOString()
          }
        } catch (e) {}

        list.push({
          author,
          videoId,
          uploadedAt,
          uploadTimestamp,
          url: href,
          coverImg,
          views: viewLine,
          rawViews: parseViews(viewLine),
          isTopLiked,
          caption: captionLines.join(' ') || null,
        })
      }

      // Filter to matching creator if handle provided
      const target = ${JSON.stringify(creatorHandle.replace(/^@/, '').toLowerCase())}
      const creatorVideos = target ? list.filter(v => v.author.toLowerCase().includes(target)) : list

      const validViews = creatorVideos.map(v => v.rawViews).filter(v => v > 0).sort((a, b) => a - b)
      let median = 0
      if (validViews.length > 0) {
        const mid = Math.floor(validViews.length / 2)
        median = validViews.length % 2 !== 0 ? validViews[mid] : Math.round((validViews[mid - 1] + validViews[mid]) / 2)
      }

      const scored = creatorVideos.map(v => {
        const multiplier = median > 0 ? (v.rawViews / median) : 1
        let virality = 'NORMAL'
        if (multiplier >= 10.0) virality = 'MEGA_OUTLIER'
        else if (multiplier >= 5.0) virality = 'HIGH_OUTLIER'
        else if (multiplier >= 3.0) virality = 'OUTLIER'

        return {
          ...v,
          outlierMultiplier: Number(multiplier.toFixed(1)),
          viralityRating: virality,
        }
      }).sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

      const outliers = scored.filter(v => v.outlierMultiplier >= 3.0)

      return {
        ok: true,
        creator: target || 'niche_top',
        totalVideosAnalyzed: creatorVideos.length,
        medianViews: median,
        outlierCount: outliers.length,
        outliers,
        allRanked: scored,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokListUserPostsScript(): string {
  return `(() => {
    try {
      const items = []
      const url = window.location.href

      // Case 1: TikTok Studio Content page
      if (url.includes('/tiktokstudio/content')) {
        const links = Array.from(document.querySelectorAll('a[href*="/video/"]'))
        const seen = new Set()
        for (const a of links) {
          const href = a.href
          const match = href.match(/@([^/]+)\\/video\\/(\\d+)/)
          if (!match) continue
          const author = match[1]
          const videoId = match[2]
          if (seen.has(videoId)) continue
          seen.add(videoId)

          const row = a.closest('tr, [data-tt*="Row"], [class*="table-row"], [class*="Row"], div')
          const title = (a.innerText || a.getAttribute('title') || '').trim()
          const rowText = row ? row.innerText.split('\\n').map(t => t.trim()).filter(Boolean) : []
          const viewLine = rowText.find(l => /^[\\d.]+[KMB]?$/i.test(l)) || null

          items.push({
            author,
            videoId,
            url: href,
            caption: title || rowText[1] || 'TikTok Video',
            views: viewLine,
          })
        }
      } else {
        // Case 2: User profile page (https://www.tiktok.com/@username)
        // Prefer grid cards with data-e2e="user-post-item" to avoid grabbing notifications drawer
        const postItems = Array.from(document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivPostItem"]'))
        const seen = new Set()

        if (postItems.length > 0) {
          for (const item of postItems) {
            const a = item.querySelector('a[href*="/video/"]') || item.closest('a')
            if (!a || !a.href) continue
            const match = a.href.match(/@([^/]+)\\/video\\/(\\d+)/)
            if (!match) continue
            const author = match[1]
            const videoId = match[2]
            if (seen.has(videoId)) continue
            seen.add(videoId)

            const viewsEl = item.querySelector('[data-e2e="video-views"], strong, span')
            const views = (viewsEl?.innerText || item.innerText || '').trim().split('\\n')[0] || null
            const caption = (a.innerText || item.innerText || '').trim().replace(/\\n+/g, ' ')

            items.push({
              author,
              videoId,
              url: a.href,
              views,
              caption: caption.length > 80 ? caption.slice(0, 80) + '...' : caption
            })
          }
        } else {
          // Fallback if custom classnames used
          const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
          for (const a of videoLinks) {
            const href = a.href
            const match = href.match(/@([^/]+)\\/video\\/(\\d+)/)
            if (!match) continue
            const author = match[1]
            const videoId = match[2]
            if (seen.has(videoId)) continue
            seen.add(videoId)

            items.push({
              author,
              videoId,
              url: href,
              views: null,
              caption: a.innerText || ''
            })
          }
        }
      }

      return {
        ok: true,
        count: items.length,
        posts: items
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokDeleteVideoScript(targetVideoId?: string): string {
  const targetIdParam = targetVideoId ? JSON.stringify(String(targetVideoId).trim()) : 'null'
  return `(async () => {
    try {
      const targetId = ${targetIdParam}

      // 1. If videoId provided and on profile page, click video card to open cinema player
      if (targetId) {
        const card = document.querySelector('a[href*="' + targetId + '"]')
        if (card) {
          card.click()
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      // 2. Locate the cinema-more-menu-trigger or creator 3-dots actions menu
      let moreBtn = null
      const startTrigger = Date.now()
      while (Date.now() - startTrigger < 6000) {
        moreBtn = document.querySelector('[data-e2e="cinema-more-menu-trigger"], button[data-e2e="cinema-more-menu-trigger"]')
        if (moreBtn) break

        // Fallback: look for button with aria-label="more" in the cinema player
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
        moreBtn = allButtons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase()
          const dataE2e = (b.getAttribute('data-e2e') || '').toLowerCase()
          return (dataE2e === 'cinema-more-menu-trigger') || (aria === 'more' && !dataE2e.includes('nav'))
        })
        if (moreBtn) break
        await new Promise(r => setTimeout(r, 250))
      }

      if (!moreBtn) {
        return { ok: false, error: 'Cinema action menu (3 dots) not found on video player' }
      }

      moreBtn.click()
      await new Promise(r => setTimeout(r, 600))

      // 3. Wait up to 4s for dropdown menu to mount and find "Delete"
      let deleteItem = null
      const startMenu = Date.now()
      while (Date.now() - startMenu < 4000) {
        const items = Array.from(document.querySelectorAll('.TUXMenuItem, [class*="MenuItem"], [role="menuitem"], div, span, button'))
        deleteItem = items.find(el => {
          const t = (el.innerText || '').trim().toLowerCase()
          return t === 'delete' || t === 'delete video'
        })
        if (deleteItem) break
        await new Promise(r => setTimeout(r, 200))
      }

      if (!deleteItem) {
        return { ok: false, error: 'Delete option not found in actions menu (ensure this account owns this video)' }
      }

      // 4. Click Delete menu option
      deleteItem.click()
      await new Promise(r => setTimeout(r, 800))

      // 5. Locate confirmation dialog/modal and click confirm
      let confirmDeleteBtn = null
      const startModal = Date.now()
      while (Date.now() - startModal < 4000) {
        confirmDeleteBtn = document.querySelector('button[data-e2e="video-modal-delete"]') ||
          Array.from(document.querySelectorAll('[role="dialog"] button, .tux-modal button, [class*="modal"] button')).find(b => {
            const t = (b.innerText || '').trim().toLowerCase()
            return t === 'delete' || t === 'delete video' || t === 'confirm'
          })
        if (confirmDeleteBtn) break
        await new Promise(r => setTimeout(r, 200))
      }

      if (!confirmDeleteBtn) {
        return { ok: false, error: 'Confirmation delete modal button not found' }
      }

      confirmDeleteBtn.click()
      await new Promise(r => setTimeout(r, 1500))

      return {
        ok: true,
        deleted: true,
        videoId: targetId,
        message: 'Video deleted successfully from TikTok'
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

// -------------------------------------------------------------
// Fast Background In-Session API Scripts (Zero UI Page Loads)
// -------------------------------------------------------------

export function tiktokApiSearchScript(query: string, limit = 20, offset = 0): string {
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const q = encodeURIComponent(${JSON.stringify(query)})
      const res = await fetch('/api/search/general/full/?keyword=' + q + '&offset=' + ${offset} + '&count=' + ${limit}, {
        headers: { 'Accept': 'application/json' }
      })
      if (!res.ok) {
        return { ok: false, error: 'TikTok API returned HTTP ' + res.status }
      }

      const json = await res.json()
      const data = json.data || []
      const videos = []
      const creators = []

      for (const entry of data) {
        if (entry.type === 4 && entry.user_list) {
          for (const u of entry.user_list) {
            const ui = u.user_info
            if (ui) {
              creators.push({
                uniqueId: ui.unique_id,
                nickname: ui.nickname,
                followerCount: ui.follower_count,
                totalFavorited: ui.total_favorited,
                verified: ui.custom_verify || Boolean(ui.verification_type),
                signature: ui.signature,
              })
            }
          }
        } else if (entry.type === 1 && entry.item) {
          const item = entry.item
          const ts = extractTs(item, item.id)
          videos.push({
            id: item.id,
            url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || 'user') + '/video/' + item.id,
            author: item.author?.uniqueId || 'unknown',
            authorNickname: item.author?.nickname || '',
            authorSecUid: item.author?.secUid || '',
            desc: item.desc || '',
            views: item.stats?.playCount || 0,
            likes: item.stats?.diggCount || 0,
            comments: item.stats?.commentCount || 0,
            shares: item.stats?.shareCount || 0,
            collects: item.stats?.collectCount || 0,
            duration: item.video?.duration || 0,
            coverUrl: item.video?.cover || item.video?.originCover || null,
            uploadTimestamp: ts,
            uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
            timeAgo: formatTimeAgo(ts),
            isAigc: Boolean(item.aigcLabelType || item.AIGCDescription),
          })
        }
      }

      return {
        ok: true,
        mode: 'api_fast',
        query: ${JSON.stringify(query)},
        count: videos.length,
        hasMore: Boolean(json.has_more),
        cursor: json.cursor || 0,
        videos,
        creators
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokApiCreatorFeedScript(creatorHandle: string, limit = 30): string {
  const cleanTarget = creatorHandle.replace(/^@/, '').trim().toLowerCase()
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const clean = ${JSON.stringify(cleanTarget)}

      // Parallel fetch: 1) Videos via general search, 2) User profile via SSR hydration
      const [searchRes, profileRes] = await Promise.allSettled([
        fetch('/api/search/general/full/?keyword=' + encodeURIComponent(clean) + '&offset=0&count=' + ${limit}, {
          headers: { 'Accept': 'application/json' }
        }).then(r => r.json()),
        fetch('https://www.tiktok.com/@' + clean).then(r => r.text())
      ])

      let profile = null
      if (profileRes.status === 'fulfilled' && profileRes.value) {
        const match = profileRes.value.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
        if (match) {
          try {
            const raw = JSON.parse(match[1])
            const userDetail = raw['__DEFAULT_SCOPE__']?.['webapp.user-detail'] || {}
            const uInfo = userDetail.userInfo || {}
            const user = uInfo.user || {}
            const stats = uInfo.stats || {}
            profile = {
              uniqueId: user.uniqueId || clean,
              nickname: user.nickname || '',
              signature: user.signature || '',
              followerCount: stats.followerCount || 0,
              followingCount: stats.followingCount || 0,
              heartCount: stats.heartCount || 0,
              videoCount: stats.videoCount || 0,
              secUid: user.secUid || ''
            }
          } catch (e) {}
        }
      }

      const videos = []
      if (searchRes.status === 'fulfilled' && searchRes.value?.data) {
        for (const entry of searchRes.value.data) {
          if (entry.type === 1 && entry.item) {
            const item = entry.item
            const author = (item.author?.uniqueId || '').toLowerCase()
            if (author.includes(clean) || clean.includes(author)) {
              const ts = extractTs(item, item.id)
              videos.push({
                id: item.id,
                url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || clean) + '/video/' + item.id,
                author: item.author?.uniqueId || clean,
                authorNickname: item.author?.nickname || '',
                desc: item.desc || '',
                views: item.stats?.playCount || 0,
                likes: item.stats?.diggCount || 0,
                comments: item.stats?.commentCount || 0,
                shares: item.stats?.shareCount || 0,
                collects: item.stats?.collectCount || 0,
                duration: item.video?.duration || 0,
                coverUrl: item.video?.cover || item.video?.originCover || null,
                uploadTimestamp: ts,
                uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                timeAgo: formatTimeAgo(ts),
              })
            }
          }
        }
      }

      return {
        ok: true,
        mode: 'api_fast',
        creator: clean,
        profile,
        count: videos.length,
        videos
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokApiOutlierScript(creatorHandle: string, minMultiplier = 3.0): string {
  const cleanTarget = creatorHandle.replace(/^@/, '').trim().toLowerCase()
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const clean = ${JSON.stringify(cleanTarget)}
      const minMult = ${minMultiplier}

      // Parallel fetch: videos + profile
      const [searchRes, profileRes] = await Promise.allSettled([
        fetch('/api/search/general/full/?keyword=' + encodeURIComponent(clean) + '&offset=0&count=35', {
          headers: { 'Accept': 'application/json' }
        }).then(r => r.json()),
        fetch('https://www.tiktok.com/@' + clean).then(r => r.text())
      ])

      let profile = null
      if (profileRes.status === 'fulfilled' && profileRes.value) {
        const match = profileRes.value.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
        if (match) {
          try {
            const raw = JSON.parse(match[1])
            const uInfo = raw['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo || {}
            const user = uInfo.user || {}
            const stats = uInfo.stats || {}
            profile = {
              uniqueId: user.uniqueId || clean,
              nickname: user.nickname || '',
              followerCount: stats.followerCount || 0,
              heartCount: stats.heartCount || 0,
              videoCount: stats.videoCount || 0
            }
          } catch (e) {}
        }
      }

      const allVideos = []
      if (searchRes.status === 'fulfilled' && searchRes.value?.data) {
        for (const entry of searchRes.value.data) {
          if (entry.type === 1 && entry.item) {
            const item = entry.item
            const author = (item.author?.uniqueId || '').toLowerCase()
            if (author.includes(clean) || clean.includes(author)) {
              const ts = extractTs(item, item.id)
              allVideos.push({
                id: item.id,
                url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || clean) + '/video/' + item.id,
                author: item.author?.uniqueId || clean,
                authorNickname: item.author?.nickname || '',
                desc: item.desc || '',
                views: item.stats?.playCount || 0,
                likes: item.stats?.diggCount || 0,
                comments: item.stats?.commentCount || 0,
                shares: item.stats?.shareCount || 0,
                collects: item.stats?.collectCount || 0,
                duration: item.video?.duration || 0,
                coverUrl: item.video?.cover || item.video?.originCover || null,
                uploadTimestamp: ts,
                uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                timeAgo: formatTimeAgo(ts),
              })
            }
          }
        }
      }

      // Calculate median baseline
      const viewList = allVideos.map(v => v.views).filter(v => v > 0).sort((a, b) => a - b)
      let median = 0
      if (viewList.length > 0) {
        const mid = Math.floor(viewList.length / 2)
        median = viewList.length % 2 !== 0 ? viewList[mid] : Math.round((viewList[mid - 1] + viewList[mid]) / 2)
      }

      const now = Math.floor(Date.now() / 1000)
      const outliers = allVideos
        .map(v => {
          const ratio = median > 0 ? Math.round((v.views / median) * 10) / 10 : (v.views > 10000 ? 5.0 : 1.0)
          const isFresh = v.uploadTimestamp ? (now - v.uploadTimestamp) < (86400 * 4) : false
          return {
            ...v,
            baselineMedian: median,
            outlierMultiplier: ratio,
            isFreshViral: isFresh && ratio >= 2.0,
            viralityBadge: ratio >= 10 ? '🔥 SUPER_VIRAL (' + ratio + 'x)' : (ratio >= 3 ? '⭐ OUTLIER (' + ratio + 'x)' : 'NORMAL')
          }
        })
        .filter(v => (v.outlierMultiplier >= minMult && v.views >= 500) || v.isFreshViral)
        .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

      return {
        ok: true,
        mode: 'api_fast',
        creator: clean,
        profile,
        totalVideosScanned: allVideos.length,
        baselineMedianViews: median,
        outlierCount: outliers.length,
        outliers,
        allVideosSample: allVideos.slice(0, 10)
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokApiVideoDetailScript(urlOrId: string): string {
  const target = String(urlOrId).trim()
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      let vid = ''
      let targetUrl = ''
      const input = ${JSON.stringify(target)}
      const match = input.match(/\\/video\\/(\\d+)/)
      if (match) {
        vid = match[1]
        targetUrl = input
      } else if (/^\\d+$/.test(input)) {
        vid = input
        targetUrl = 'https://www.tiktok.com/@video/video/' + vid
      } else {
        targetUrl = input
      }

      const res = await fetch(targetUrl)
      if (!res.ok) {
        return { ok: false, error: 'Failed to fetch video page: HTTP ' + res.status }
      }

      const html = await res.text()
      const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\\s\\S]*?)<\\/script>/)
      if (!jsonMatch) {
        return { ok: false, error: 'Rehydration metadata not found on video page' }
      }

      const raw = JSON.parse(jsonMatch[1])
      const videoDetail = raw['__DEFAULT_SCOPE__']?.['webapp.video-detail'] || {}
      const item = videoDetail.itemInfo?.itemStruct
      if (!item) {
        return { ok: false, error: 'Video itemStruct not found' }
      }

      const ts = extractTs(item, item.id || vid)

      return {
        ok: true,
        mode: 'api_fast',
        id: item.id || vid,
        url: targetUrl,
        author: item.author?.uniqueId || '',
        authorNickname: item.author?.nickname || '',
        desc: item.desc || '',
        views: item.stats?.playCount || 0,
        likes: item.stats?.diggCount || 0,
        comments: item.stats?.commentCount || 0,
        shares: item.stats?.shareCount || 0,
        collects: item.stats?.collectCount || 0,
        music: item.music?.title || '',
        musicAuthor: item.music?.authorName || '',
        duration: item.video?.duration || 0,
        coverUrl: item.video?.cover || item.video?.originCover || null,
        uploadTimestamp: ts,
        uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
        timeAgo: formatTimeAgo(ts),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokApiBatchOutliersScript(creators: string[], minMultiplier = 2.5): string {
  return `(async () => {
    try {
      function formatTimeAgo(ts) {
        if (!ts) return 'Unknown'
        const now = Math.floor(Date.now() / 1000)
        const diff = Math.max(0, now - ts)
        if (diff < 60) return diff + 's ago'
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
        const days = Math.floor(diff / 86400)
        if (days < 30) return days + 'd ago'
        if (days < 365) return Math.floor(days / 30) + 'mo ago'
        return Math.floor(days / 365) + 'y ago'
      }

      function extractTs(item, vid) {
        if (item && item.createTime && Number(item.createTime) > 1000000000) {
          return Number(item.createTime)
        }
        try {
          const ts = Number(BigInt(vid) >> 32n)
          if (ts > 1000000000 && ts < 2500000000) return ts
        } catch (e) {}
        return 0
      }

      const creatorList = ${JSON.stringify(creators)}.map(c => c.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)
      const minMult = ${minMultiplier}
      const now = Math.floor(Date.now() / 1000)

      // Parallel fetch across all creators
      const results = await Promise.allSettled(
        creatorList.map(async (creator) => {
          const res = await fetch('/api/search/general/full/?keyword=' + encodeURIComponent(creator) + '&offset=0&count=25', {
            headers: { 'Accept': 'application/json' }
          })
          if (!res.ok) return { creator, ok: false, error: 'HTTP ' + res.status }
          const json = await res.json()
          const videos = []
          for (const entry of (json.data || [])) {
            if (entry.type === 1 && entry.item) {
              const item = entry.item
              const author = (item.author?.uniqueId || '').toLowerCase()
              if (author.includes(creator) || creator.includes(author)) {
                const ts = extractTs(item, item.id)
                videos.push({
                  id: item.id,
                  url: 'https://www.tiktok.com/@' + (item.author?.uniqueId || creator) + '/video/' + item.id,
                  author: item.author?.uniqueId || creator,
                  desc: item.desc || '',
                  views: item.stats?.playCount || 0,
                  likes: item.stats?.diggCount || 0,
                  comments: item.stats?.commentCount || 0,
                  shares: item.stats?.shareCount || 0,
                  coverUrl: item.video?.cover || null,
                  uploadTimestamp: ts,
                  uploadedAt: ts ? new Date(ts * 1000).toISOString() : null,
                  timeAgo: formatTimeAgo(ts),
                })
              }
            }
          }

          const viewList = videos.map(v => v.views).filter(v => v > 0).sort((a, b) => a - b)
          let median = 0
          if (viewList.length > 0) {
            const mid = Math.floor(viewList.length / 2)
            median = viewList.length % 2 !== 0 ? viewList[mid] : Math.round((viewList[mid - 1] + viewList[mid]) / 2)
          }

          const outliers = videos
            .map(v => {
              const ratio = median > 0 ? Math.round((v.views / median) * 10) / 10 : 1.0
              const isFresh = v.uploadTimestamp ? (now - v.uploadTimestamp) < (86400 * 4) : false
              return {
                ...v,
                baselineMedian: median,
                outlierMultiplier: ratio,
                isFreshViral: isFresh && ratio >= 2.0,
                viralityBadge: ratio >= 10 ? '🔥 SUPER_VIRAL (' + ratio + 'x)' : (ratio >= 3 ? '⭐ OUTLIER (' + ratio + 'x)' : 'ELEVATED (' + ratio + 'x)')
              }
            })
            .filter(v => (v.outlierMultiplier >= minMult && v.views >= 500) || v.isFreshViral)
            .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

          return {
            creator,
            ok: true,
            totalScanned: videos.length,
            baselineMedian: median,
            outliers
          }
        })
      )

      const successful = []
      const allOutliers = []

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          successful.push(r.value)
          for (const o of r.value.outliers) {
            allOutliers.push(o)
          }
        }
      }

      // Sort aggregate outliers by multiplier
      allOutliers.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier)

      return {
        ok: true,
        mode: 'api_fast_batch',
        creatorsRequested: creatorList.length,
        creatorsSuccessful: successful.length,
        totalOutliersFound: allOutliers.length,
        allOutliers,
        byCreator: successful
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

export function tiktokWarmupScrollScript(options: { durationSeconds?: number; autoLike?: boolean } = {}): string {
  const durationSec = Math.max(10, Math.min(600, options.durationSeconds ?? 60))
  const autoLike = Boolean(options.autoLike)
  return `(async () => {
    try {
      const startTime = Date.now()
      const maxMs = ${durationSec} * 1000
      let videosWatched = 0
      let likesGiven = 0

      const sleep = ms => new Promise(r => setTimeout(r, ms))

      while (Date.now() - startTime < maxMs) {
        // 1. Watch video for random realistic duration (4-10s)
        const watchDuration = Math.floor(4000 + Math.random() * 6000)
        await sleep(Math.min(watchDuration, Math.max(500, maxMs - (Date.now() - startTime))))
        videosWatched++

        // 2. Periodically like video if autoLike is enabled
        if (${autoLike} && Math.random() < 0.22) {
          const likeBtn = document.querySelector('[data-e2e="like-icon"], div[data-e2e="like-icon"], button[data-e2e="like-icon"]')
          if (likeBtn && likeBtn.getAttribute('aria-pressed') !== 'true') {
            likeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            likesGiven++
            await sleep(600)
          }
        }

        // 3. Smooth navigate to next video
        const nextBtn = document.querySelector('[data-e2e="feed-navigation-next"], button[data-e2e="feed-navigation-next"]')
        if (nextBtn) {
          nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        } else {
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' })
        }

        // Small inter-scroll pause (1-2s)
        await sleep(1000 + Math.random() * 1200)
      }

      return {
        ok: true,
        durationSeconds: Math.round((Date.now() - startTime) / 1000),
        videosWatched,
        likesGiven,
        message: 'TikTok warmup and persona scroll session completed successfully.'
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}



