// @target reddit.com
//
// READ-ONLY. Nothing is clicked, created, changed or deleted.
//
// First Reddit probe: inspect session identity, user authentication state,
// CSRF/token presence, and sample feed/subreddit JSON structures.

const url = window.location.href
const title = document.title

// 1. Check cookies & tokens for Reddit auth
const cookies = document.cookie || ''
const hasRedditSession = cookies.includes('reddit_session')
const loidMatch = cookies.match(/loid=([^;]+)/)
const sessionMatch = cookies.match(/reddit_session=([^;]+)/)

// 2. Query Reddit identity endpoints
let meJson = null
let meStatus = null
try {
  const meRes = await fetch('/user/me/about.json', {
    headers: { 'Accept': 'application/json' },
  })
  meStatus = meRes.status
  if (meRes.ok) {
    meJson = await meRes.json()
  }
} catch (e) {
  meJson = { error: String(e) }
}

// 3. Query sample public feed to inspect post payload shape
let feedJson = null
let feedStatus = null
try {
  const feedRes = await fetch('/r/popular.json?limit=3', {
    headers: { 'Accept': 'application/json' },
  })
  feedStatus = feedRes.status
  if (feedRes.ok) {
    const data = await feedRes.json()
    feedJson = {
      kind: data?.kind,
      postsCount: data?.data?.children?.length ?? 0,
      samplePosts: data?.data?.children?.slice(0, 3).map(c => ({
        id: c.data?.id,
        name: c.data?.name,
        subreddit: c.data?.subreddit_name_prefixed,
        title: c.data?.title,
        author: c.data?.author,
        ups: c.data?.ups,
        num_comments: c.data?.num_comments,
        permalink: c.data?.permalink,
      })),
    }
  }
} catch (e) {
  feedJson = { error: String(e) }
}

// 4. Web Component / DOM architecture check
const shRedditApp = document.querySelector('shreddit-app')
const isShReddit = !!shRedditApp
const feedPosts = document.querySelectorAll('shreddit-post').length

return {
  url,
  title,
  frontend: isShReddit ? 'shreddit (modern web components)' : 'classic/react',
  auth: {
    hasRedditSession,
    loid: loidMatch ? loidMatch[1] : null,
    meStatus,
    user: meJson?.data ? {
      name: meJson.data.name,
      id: meJson.data.id,
      totalKarma: meJson.data.total_karma,
      inboxCount: meJson.data.inbox_count,
    } : null,
    rawMe: meStatus !== 200 ? meJson : undefined,
  },
  feed: {
    feedStatus,
    posts: feedJson,
    domShredditPostsFound: feedPosts,
  },
}
