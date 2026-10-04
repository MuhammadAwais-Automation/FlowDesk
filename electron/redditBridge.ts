/**
 * Reddit bridge — pure JavaScript string builders evaluated inside the live,
 * logged-in Reddit page partition.
 *
 * Evidence for every endpoint, payload and token observed on the wire is in
 * probes/FINDINGS-reddit.md (captured from 1,042 calls, 3.86MB real session).
 *
 * No page patching or dom-ready injection needed. Each function returns an
 * isolated self-contained async script string that evaluates safely inside
 * webContents.executeJavaScript and returns a structured JSON-safe object.
 */

const PRELUDE = `
  function safe(v, depth) {
    depth = depth || 0
    if (v === null || v === undefined) return null
    var t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') return v
    if (t === 'function') return '[function]'
    if (t === 'symbol' || t === 'bigint') return String(v)
    if (depth >= 8) return '[depth limit]'
    try {
      if (Array.isArray(v)) return v.map(function (x) { return safe(x, depth + 1) })
      var out = {}
      var keys = Object.keys(v)
      for (var i = 0; i < keys.length; i++) out[keys[i]] = safe(v[keys[i]], depth + 1)
      return out
    } catch (e) { return '[unreadable]' }
  }

  function getCsrf() {
    try {
      var m = document.cookie.match(/(?:^|;\\s*)csrf_token=([^;]+)/)
      if (m && m[1]) return decodeURIComponent(m[1])
      var el = document.querySelector('[csrf-token], [data-csrf-token], faceplate-csrf-provider, reddit-session')
      if (el) {
        var tok = el.getAttribute('csrf-token') || el.getAttribute('data-csrf-token') || el.getAttribute('token')
        if (tok) return tok
      }
      var inp = document.querySelector('input[name="csrf_token"]')
      if (inp && inp.value) return inp.value
      var meta = document.querySelector('meta[name="csrf-token"]')
      if (meta && meta.content) return meta.content
    } catch (e) {}
    return null
  }

  async function postGql(operation, variables) {
    var csrf = getCsrf()
    if (!csrf) return { ok: false, error: 'Unable to extract Reddit CSRF token — verify signed in session' }
    var payload = {
      operation: operation,
      variables: variables,
      csrf_token: csrf
    }
    var res = await fetch('/svc/shreddit/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    var text = await res.text()
    try {
      var json = JSON.parse(text)
      var errs = json && Array.isArray(json.errors) ? json.errors : (json && json.errors ? [json.errors] : [])
      if (errs.length > 0) {
        var msgs = errs.map(function (er) { return (er && (er.message || er.code)) || JSON.stringify(er) }).join('; ')
        return { ok: false, status: res.status, data: json.data, errors: errs, error: 'GraphQL errors: ' + String(msgs).slice(0, 500) }
      }
      return { ok: res.ok, status: res.status, data: json.data, errors: json.errors }
    } catch (e) {
      return { ok: res.ok, status: res.status, raw: text.slice(0, 500) }
    }
  }
`

export function redditStatusScript(): string {
  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch('/user/me/about.json', { headers: { 'accept': 'application/json' } })
      if (!res.ok) {
        return { ok: false, signedIn: false, status: res.status, error: 'Not authenticated to Reddit' }
      }
      var json = await res.json()
      var d = (json && json.data) || {}
      // Signed out, Reddit still answers 200 — with the string "{}".
      if (!d.name) return { ok: false, signedIn: false, error: 'Not signed in to Reddit — log in once on the Social page' }
      return {
        ok: true,
        signedIn: true,
        username: d.name || null,
        id: d.id ? ('t2_' + d.id) : null,
        totalKarma: d.total_karma ?? (d.link_karma + d.comment_karma),
        linkKarma: d.link_karma ?? 0,
        commentKarma: d.comment_karma ?? 0,
        inboxCount: d.inbox_count ?? 0,
        hasMail: Boolean(d.has_mail),
        hasModMail: Boolean(d.has_mod_mail),
        verified: Boolean(d.verified),
        csrfTokenFound: Boolean(getCsrf())
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export interface RedditFeedOptions {
  subreddit?: string
  sort?: 'hot' | 'new' | 'top' | 'rising'
  limit?: number
  after?: string
  timeFilter?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
}

export function redditFeedScript(options: RedditFeedOptions = {}): string {
  const { subreddit, sort = 'hot', limit = 25, after, timeFilter } = options
  const subPath = subreddit ? `/r/${encodeURIComponent(subreddit)}` : ''
  const queryParts = [`limit=${Math.min(Math.max(limit, 1), 100)}`]
  if (after) queryParts.push(`after=${encodeURIComponent(after)}`)
  if (timeFilter) queryParts.push(`t=${encodeURIComponent(timeFilter)}`)
  const url = `${subPath}/${sort}.json?${queryParts.join('&')}`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Feed request failed: ' + res.status }
      var json = await res.json()
      var children = (json.data && json.data.children) || []
      var posts = children.map(function (c) {
        var p = c.data || {}
        return {
          id: p.name || ('t3_' + p.id),
          shortId: p.id,
          title: p.title,
          author: p.author,
          subreddit: p.subreddit_name_prefixed || ('r/' + p.subreddit),
          subredditId: p.subreddit_id,
          score: p.score ?? p.ups ?? 0,
          upvoteRatio: p.upvote_ratio,
          numComments: p.num_comments ?? 0,
          permalink: p.permalink,
          url: p.url,
          isSelf: Boolean(p.is_self),
          selftext: (p.selftext || '').slice(0, 1000),
          createdAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
          isOver18: Boolean(p.over_18),
          spoiler: Boolean(p.spoiler)
        }
      })
      return {
        ok: true,
        after: json.data && json.data.after,
        before: json.data && json.data.before,
        count: posts.length,
        posts: safe(posts)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditPostCommentsScript(subreddit: string, postId: string, limit = 50): string {
  const cleanId = postId.replace(/^t3_/, '')
  const url = `/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(cleanId)}.json?limit=${limit}&depth=3`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Failed to fetch comments: ' + res.status }
      var json = await res.json()
      if (!Array.isArray(json) || json.length < 2) return { ok: false, error: 'Unexpected comments structure' }

      var postData = (json[0].data && json[0].data.children && json[0].data.children[0] && json[0].data.children[0].data) || {}
      var post = {
        id: postData.name || ('t3_' + postData.id),
        title: postData.title,
        author: postData.author,
        selftext: postData.selftext,
        score: postData.score,
        numComments: postData.num_comments,
        permalink: postData.permalink
      }

      function parseComments(children) {
        if (!children || !Array.isArray(children)) return []
        var out = []
        for (var i = 0; i < children.length; i++) {
          var c = children[i].data
          if (!c || !c.body) continue
          var replies = []
          if (c.replies && c.replies.data && c.replies.data.children) {
            replies = parseComments(c.replies.data.children)
          }
          out.push({
            id: c.name || ('t1_' + c.id),
            author: c.author,
            body: c.body,
            score: c.score ?? c.ups ?? 0,
            createdAt: c.created_utc ? new Date(c.created_utc * 1000).toISOString() : null,
            parentId: c.parent_id,
            repliesCount: replies.length,
            replies: replies
          })
        }
        return out
      }

      var comments = parseComments(json[1].data && json[1].data.children)
      return {
        ok: true,
        post: safe(post),
        commentsCount: comments.length,
        comments: safe(comments)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditVotePostScript(postId: string, voteState: 'UP' | 'DOWN' | 'NONE'): string {
  const fullPostId = postId.startsWith('t3_') ? postId : `t3_${postId}`
  return `(async function () {
    ${PRELUDE}
    var vars = { input: { postId: ${JSON.stringify(fullPostId)}, voteState: ${JSON.stringify(voteState)} } }
    var result = await postGql('UpdatePostVoteState', vars)
    return safe(result)
  })()`
}

export function redditVoteCommentScript(commentId: string, voteState: 'UP' | 'DOWN' | 'NONE'): string {
  const fullCommentId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`
  return `(async function () {
    ${PRELUDE}
    var vars = { input: { commentId: ${JSON.stringify(fullCommentId)}, voteState: ${JSON.stringify(voteState)} } }
    var result = await postGql('UpdateCommentVoteState', vars)
    return safe(result)
  })()`
}

export function redditCreateCommentScript(postId: string, parentId: string, text: string): string {
  const cleanPostId = postId.startsWith('t3_') ? postId : `t3_${postId}`
  const cleanParentId = parentId.startsWith('t1_') || parentId.startsWith('t3_') ? parentId : `t3_${parentId}`
  const richTextAst = JSON.stringify({
    document: [
      {
        e: 'par',
        c: [{ e: 'text', t: text }]
      }
    ]
  })

  return `(async function () {
    ${PRELUDE}
    var csrf = getCsrf()
    if (!csrf) return { ok: false, error: 'CSRF token missing' }

    var params = new URLSearchParams()
    params.set('parentId', ${JSON.stringify(cleanParentId)})
    params.set('commentDepth', ${JSON.stringify(cleanParentId.startsWith('t1_') ? 2 : 1)})
    params.set('content', ${JSON.stringify(richTextAst)})
    params.set('mode', 'richText')
    params.set('richTextMedia', '[]')
    params.set('csrf_token', csrf)

    var url = '/svc/shreddit/' + ${JSON.stringify(cleanPostId)} + '/create-comment'
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'text/vnd.reddit.partial+html, application/json'
      },
      body: params.toString()
    })

    var body = await res.text()
    if (!res.ok) return { ok: false, status: res.status, error: body.slice(0, 300) }
    // HTTP 200 alone is not proof: Reddit answers 200 with an error partial or
    // an errors JSON when the comment is rejected. Require a t1_ thing id.
    var parentFullId = ${JSON.stringify(cleanParentId)}
    function findNewCommentId(str) {
      var all = String(str).match(/t1_[a-z0-9]+/gi) || []
      for (var k = 0; k < all.length; k++) {
        if (all[k].toLowerCase() !== parentFullId.toLowerCase()) return all[k]
      }
      return null
    }
    var commentId = null
    var parsed = null
    try { parsed = JSON.parse(body) } catch (e) { parsed = null }
    if (parsed && typeof parsed === 'object') {
      var errs = parsed.errors || (parsed.json && parsed.json.errors)
      if (Array.isArray(errs) && errs.length > 0) {
        return { ok: false, status: res.status, created: false, errors: errs, error: 'Reddit rejected comment', snippet: body.slice(0, 300) }
      }
      commentId = findNewCommentId(JSON.stringify(parsed))
    } else {
      commentId = findNewCommentId(body)
    }
    if (commentId) return { ok: true, status: res.status, created: true, commentId: commentId }
    return { ok: false, status: res.status, created: false, error: 'Comment response did not include a comment id', snippet: body.slice(0, 300) }
  })()`
}

export function redditCreatePostScript(subredditName: string, title: string, textContent?: string): string {
  const cleanSubName = subredditName.replace(/^r\//, '')
  const contentAst = textContent ? {
    document: [
      {
        e: 'par',
        c: [{ e: 'text', t: textContent }]
      }
    ]
  } : null

  return `(async function () {
    ${PRELUDE}
    var vars = {
      input: {
        title: ${JSON.stringify(title)},
        subredditName: ${JSON.stringify(cleanSubName)},
        isNsfw: false,
        isSpoiler: false,
        isCommercialCommunication: false,
        targetLanguage: '',
        content: ${JSON.stringify(contentAst)},
        correlationId: 'flowdesk-' + Math.random().toString(36).substring(2, 15)
      }
    }
    var result = await postGql('CreatePost', vars)
    return safe(result)
  })()`
}

export function redditSubscribeScript(subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED'): string {
  const fullSubId = subredditId.startsWith('t5_') ? subredditId : `t5_${subredditId}`
  return `(async function () {
    ${PRELUDE}
    var vars = {
      input: {
        inputs: [{
          subredditId: ${JSON.stringify(fullSubId)},
          subscribeState: ${JSON.stringify(subscribeState)}
        }]
      }
    }
    var result = await postGql('UpdateSubredditSubscriptions', vars)
    return safe(result)
  })()`
}

export type RedditTimeFilter = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
const REDDIT_TIME_FILTERS: readonly RedditTimeFilter[] = ['hour', 'day', 'week', 'month', 'year', 'all']

function cleanTimeFilter(t: unknown): RedditTimeFilter | undefined {
  return typeof t === 'string' && (REDDIT_TIME_FILTERS as readonly string[]).includes(t) ? (t as RedditTimeFilter) : undefined
}

export function redditSearchScript(
  query: string,
  sort: 'relevance' | 'hot' | 'top' | 'new' | 'comments' = 'relevance',
  limit = 25,
  t?: RedditTimeFilter,
): string {
  const time = cleanTimeFilter(t)
  const url = `/search.json?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&limit=${Math.min(limit, 100)}${time ? `&t=${time}` : ''}`
  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Search failed' }
      var json = await res.json()
      var children = (json.data && json.data.children) || []
      var results = children.map(function (c) {
        var d = c.data || {}
        return {
          id: d.name || ('t3_' + d.id),
          shortId: d.id,
          title: d.title,
          author: d.author,
          subreddit: d.subreddit_name_prefixed || ('r/' + d.subreddit),
          score: d.score ?? d.ups ?? 0,
          numComments: d.num_comments ?? 0,
          permalink: d.permalink,
          url: d.url,
          isSelf: Boolean(d.is_self),
          selftext: (d.selftext || '').slice(0, 1000),
          createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null
        }
      })
      return { ok: true, count: results.length, results: safe(results) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditMarkReadScript(): string {
  return `(async function () {
    ${PRELUDE}
    var vars = { input: { types: ['NOTIFICATIONS'] } }
    var result = await postGql('MarkInboxAsRead', vars)
    return safe(result)
  })()`
}

export interface RedditApiFeedOptions {
  subreddit?: string
  sort?: string
  limit?: number
}

export interface RedditApiSearchOptions {
  subreddit?: string
  limit?: number
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments'
  t?: RedditTimeFilter
}

export interface RedditOutlierOptions {
  sort?: 'hot' | 'top' | 'rising'
  t?: RedditTimeFilter
}

export interface RedditApiPostItem {
  id: string
  title: string
  author: string
  subreddit: string
  score: number
  numComments: number
  url: string
  permalink: string
  createdUtc: number
  selftext: string
  isVideo: boolean
}

export interface RedditApiCommentItem {
  author: string
  body: string
  score: number
  createdUtc: number
  id?: string
  parentId?: string
}

export interface RedditOutlierResult {
  ok: boolean
  subreddit: string
  sampleSize: number
  medianScore: number
  medianComments: number
  minMultiplier: number
  outlierCount: number
  sort?: 'hot' | 'top' | 'rising'
  t?: RedditTimeFilter | null
  outliers: Array<RedditApiPostItem & { outlierMultiplier: number; scorePerHour?: number | null }>
  highDebatePainPoints: Array<RedditApiPostItem & { debateRatio: number; hasFrustrationKeywords: boolean }>
  topHooks: Array<{
    postId: string
    title: string
    score: number
    numComments: number
    pattern: string
    hookTemplate: string
  }>
}

export function redditApiFeedScript(options: RedditApiFeedOptions = {}): string {
  const { subreddit, sort = 'hot', limit = 25 } = options
  const cleanSub = subreddit ? subreddit.replace(/^r\//, '') : ''
  const clampedLimit = Math.min(Math.max(limit, 1), 100)
  const url = cleanSub
    ? `/r/${encodeURIComponent(cleanSub)}/${sort}.json?limit=${clampedLimit}`
    : `/${sort}.json?limit=${clampedLimit}`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Feed request failed: ' + res.status }
      var json = await res.json()
      var children = (json.data && json.data.children) || []
      var items = children.map(function (c) {
        var p = c.data || {}
        return {
          id: p.name || ('t3_' + p.id),
          title: p.title || '',
          author: p.author || '',
          subreddit: p.subreddit_name_prefixed || (p.subreddit ? ('r/' + p.subreddit) : ''),
          score: p.score ?? p.ups ?? 0,
          numComments: p.num_comments ?? 0,
          url: p.url || '',
          permalink: p.permalink || '',
          createdUtc: p.created_utc || 0,
          selftext: p.selftext || '',
          isVideo: Boolean(p.is_video)
        }
      })
      return {
        ok: true,
        count: items.length,
        items: safe(items),
        posts: safe(items)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditApiSearchScript(query: string, options: RedditApiSearchOptions = {}): string {
  const { subreddit, limit = 25, sort } = options
  const time = cleanTimeFilter(options.t)
  const cleanSub = subreddit ? subreddit.replace(/^r\//, '') : ''
  const clampedLimit = Math.min(Math.max(limit, 1), 100)
  const extra = `${sort ? `&sort=${encodeURIComponent(sort)}` : ''}${time ? `&t=${time}` : ''}`
  const url = cleanSub
    ? `/r/${encodeURIComponent(cleanSub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${clampedLimit}${extra}`
    : `/search.json?q=${encodeURIComponent(query)}&limit=${clampedLimit}${extra}`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Search request failed: ' + res.status }
      var json = await res.json()
      var children = (json.data && json.data.children) || []
      var items = children.map(function (c) {
        var p = c.data || {}
        return {
          id: p.name || ('t3_' + p.id),
          title: p.title || '',
          author: p.author || '',
          subreddit: p.subreddit_name_prefixed || (p.subreddit ? ('r/' + p.subreddit) : ''),
          score: p.score ?? p.ups ?? 0,
          numComments: p.num_comments ?? 0,
          url: p.url || '',
          permalink: p.permalink || '',
          createdUtc: p.created_utc || 0,
          selftext: p.selftext || '',
          isVideo: Boolean(p.is_video)
        }
      })
      return {
        ok: true,
        count: items.length,
        items: safe(items),
        results: safe(items)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditApiPostCommentsScript(postId: string, limit = 50): string {
  const cleanId = postId.replace(/^t3_/, '')
  const clampedLimit = Math.min(Math.max(limit, 1), 200)
  const url = `/comments/${encodeURIComponent(cleanId)}.json?limit=${clampedLimit}&depth=4`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Failed to fetch comments: ' + res.status }
      var json = await res.json()
      if (!Array.isArray(json) || json.length < 2) return { ok: false, error: 'Unexpected comments structure' }

      var postData = (json[0] && json[0].data && json[0].data.children && json[0].data.children[0] && json[0].data.children[0].data) || {}
      var post = {
        id: postData.name || ('t3_' + postData.id),
        title: postData.title || '',
        author: postData.author || '',
        score: postData.score ?? postData.ups ?? 0,
        numComments: postData.num_comments ?? 0,
        url: postData.url || '',
        permalink: postData.permalink || ''
      }

      function flatten(children, out) {
        if (!children || !Array.isArray(children)) return
        for (var i = 0; i < children.length; i++) {
          var c = children[i].data
          if (!c || !c.body) continue
          out.push({
            author: c.author || '',
            body: c.body || '',
            score: c.score ?? c.ups ?? 0,
            createdUtc: c.created_utc || 0,
            id: c.name || ('t1_' + c.id),
            parentId: c.parent_id || ''
          })
          if (c.replies && c.replies.data && c.replies.data.children) {
            flatten(c.replies.data.children, out)
          }
        }
      }

      var allComments = []
      flatten(json[1] && json[1].data && json[1].data.children, allComments)
      allComments.sort(function (a, b) { return b.score - a.score })
      var topComments = allComments.slice(0, ${clampedLimit})

      return {
        ok: true,
        postId: ${JSON.stringify(cleanId)},
        post: safe(post),
        count: topComments.length,
        comments: safe(topComments)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}

export function redditOutlierScript(subreddit: string, minMultiplier = 3.0, options: RedditOutlierOptions = {}): string {
  const cleanSub = subreddit.replace(/^r\//, '')
  const mult = Number.isFinite(minMultiplier) && minMultiplier > 0 ? minMultiplier : 3.0
  const sort = options.sort === 'top' || options.sort === 'rising' ? options.sort : 'hot'
  const time = cleanTimeFilter(options.t)
  const url = `/r/${encodeURIComponent(cleanSub)}/${sort}.json?limit=50${time ? `&t=${time}` : ''}`

  return `(async function () {
    ${PRELUDE}
    try {
      var res = await fetch(${JSON.stringify(url)}, { headers: { 'accept': 'application/json' } })
      if (!res.ok) return { ok: false, status: res.status, error: 'Outlier fetch failed: ' + res.status }
      var json = await res.json()
      var children = (json.data && json.data.children) || []
      var posts = children.map(function (c) {
        var p = c.data || {}
        return {
          id: p.name || ('t3_' + p.id),
          title: p.title || '',
          author: p.author || '',
          subreddit: p.subreddit_name_prefixed || (p.subreddit ? ('r/' + p.subreddit) : ''),
          score: p.score ?? p.ups ?? 0,
          numComments: p.num_comments ?? 0,
          url: p.url || '',
          permalink: p.permalink || '',
          createdUtc: p.created_utc || 0,
          selftext: (p.selftext || '').slice(0, 1000),
          isVideo: Boolean(p.is_video)
        }
      })
      var nowSec = Date.now() / 1000
      posts.forEach(function (p) {
        // Velocity: score per hour since posting (floor at 1h so fresh posts don't explode).
        var hours = p.createdUtc > 0 ? Math.max(1, (nowSec - p.createdUtc) / 3600) : 0
        p.scorePerHour = hours > 0 ? Number((p.score / hours).toFixed(2)) : null
      })

      function calcMedian(numbers) {
        if (!numbers.length) return 0
        var sorted = numbers.slice().sort(function (a, b) { return a - b })
        var mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      }

      var scores = posts.map(function (p) { return p.score })
      var commentsList = posts.map(function (p) { return p.numComments })
      var medianScore = calcMedian(scores)
      var medianComments = calcMedian(commentsList)

      var multiplierThreshold = ${mult} * Math.max(1, medianScore)
      var outliers = posts.filter(function (p) {
        return p.score >= multiplierThreshold
      }).map(function (p) {
        var actualMult = medianScore > 0 ? Number((p.score / medianScore).toFixed(1)) : 1
        return Object.assign({}, p, { outlierMultiplier: actualMult })
      }).sort(function (a, b) {
        return b.score - a.score
      })

      var frustrationRegex = /(?:how do i|why does|worst|hate|problem)/i
      var highDebatePainPoints = posts.filter(function (p) {
        var ratio = p.numComments / Math.max(1, p.score)
        var hasFrustration = frustrationRegex.test(p.title)
        return ratio >= 1.2 || hasFrustration
      }).map(function (p) {
        return Object.assign({}, p, {
          debateRatio: Number((p.numComments / Math.max(1, p.score)).toFixed(2)),
          hasFrustrationKeywords: frustrationRegex.test(p.title)
        })
      }).sort(function (a, b) {
        return b.numComments - a.numComments
      })

      function extractHookStructure(title) {
        var t = (title || '').trim()
        var pattern = 'Statement / Observation'
        if (/^how\\s+(?:to|do|can|i)\\b/i.test(t)) pattern = 'How-To / Tactical Guide'
        else if (/^why\\s+(?:does|do|is|are|did)\\b/i.test(t)) pattern = 'Curiosity / Why Question'
        else if (/^(?:what|which|where|when|who)\\b/i.test(t)) pattern = 'Direct Question / Inquiry'
        else if (/^\\d+\\b/i.test(t)) pattern = 'Listicle / Numbered Tips'
        else if (/\\b(?:psa|warning|never|stop|don't)\\b/i.test(t)) pattern = 'Urgent / Contrarian Warning'
        else if (/\\b(?:unpopular opinion|hot take|my thoughts on)\\b/i.test(t)) pattern = 'Hot Take / Debate Starter'
        else if (/^i\\s+(?:tried|built|tested|spent|made|lost|quit)\\b/i.test(t)) pattern = 'First-Person Case Study'
        else if (/\\?$/.test(t)) pattern = 'Discussion Question'
        return {
          title: t,
          pattern: pattern,
          template: t.replace(/\\b\\d+\\b/g, '[X]').replace(/r\\/[A-Za-z0-9_]+/g, 'r/[Subreddit]')
        }
      }

      var sortedPosts = posts.slice().sort(function (a, b) { return b.score - a.score })
      var seenIds = {}
      var hookSources = []
      for (var s = 0; s < outliers.length; s++) {
        seenIds[outliers[s].id] = true
        hookSources.push(outliers[s])
      }
      for (var s2 = 0; s2 < sortedPosts.length; s2++) {
        if (!seenIds[sortedPosts[s2].id]) {
          seenIds[sortedPosts[s2].id] = true
          hookSources.push(sortedPosts[s2])
        }
      }
      var topHooks = hookSources.slice(0, 10).map(function (p) {
        var h = extractHookStructure(p.title)
        return {
          postId: p.id,
          title: p.title,
          score: p.score,
          numComments: p.numComments,
          pattern: h.pattern,
          hookTemplate: h.template
        }
      })

      return {
        ok: true,
        subreddit: ${JSON.stringify(cleanSub)},
        sort: ${JSON.stringify(sort)},
        t: ${JSON.stringify(time ?? null)},
        sampleSize: posts.length,
        medianScore: medianScore,
        medianComments: medianComments,
        minMultiplier: ${mult},
        outlierCount: outliers.length,
        outliers: safe(outliers),
        highDebatePainPoints: safe(highDebatePainPoints),
        topHooks: safe(topHooks)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })()`
}
