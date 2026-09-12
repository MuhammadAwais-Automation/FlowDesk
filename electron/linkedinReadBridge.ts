/**
 * Read surfaces beyond messaging: feed, comments, search, own posts,
 * notifications.
 *
 * Split from linkedinBridge.ts because these are a different kind of thing.
 * Messaging is a coherent API LinkedIn's own client uses; several of these are
 * legacy routes the current web client abandoned — the feed page and the jobs
 * page are Server-Driven UI now — that the server nonetheless still answers
 * with clean JSON. Keeping them apart makes it obvious which set is likely to
 * rot first.
 *
 * Every path below was read off a real response (probe li-11), not inferred.
 * That distinction is not ceremony: a guessed `commenter.miniProfile` path made
 * every comment author come back `null` while the name sat under
 * `commenterForDashConversion.title.text`, and nothing failed loudly.
 *
 * All read-only. Nothing here likes, comments, posts or connects.
 */

import { buildScript } from './linkedinBridge'

/**
 * The home feed.
 *
 * `feed/updatesV2` is legacy and unused by the current client, which is why it
 * was found by trying rather than by watching — and why it is worth saying out
 * loud that it could stop working without warning.
 */
export function feedScript(options: { limit?: number; start?: number; sortBy?: string } = {}): string {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
  const start = Math.max(options.start ?? 0, 0)
  // Only these two are accepted; relevanceFeed / topFeed / mainFeed all answer
  // 400. Anything else is coerced rather than passed through, since this value
  // is interpolated into the URL unquoted.
  const sortBy = options.sortBy === 'feed' ? 'feed' : 'chronFeed'
  return buildScript(`
    var res = await api(FEED_URL + '?count=${limit}&q=${sortBy}&start=${start}')
    if (res.status !== 200) return { ok: false, error: 'feed returned ' + res.status, detail: res.text }

    var elements = (res.json && res.json.elements) || []
    var posts = elements.map(function (p) {
      var counts = (p.socialDetail && p.socialDetail.totalSocialActivityCounts) || {}
      var urn = (p.updateMetadata && p.updateMetadata.urn) || p.entityUrn || null
      var actor = p.actor || {}
      var mini = (actor.image && actor.image.attributes && actor.image.attributes[0]
        && actor.image.attributes[0].miniProfile) || {}
      return {
        // The id every other post tool needs. Without it a post can be read
        // but never referred to again.
        activityId: activityIdOf(urn),
        postUrn: urn,
        // The permalink Brain's capture pipeline reads as canonicalUrl. Without
        // it every citation built from a feed post shows "Source link
        // unavailable" — the post was real, but nothing pointed back to it.
        url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null,
        author: str(actor.name),
        authorHeadline: str(actor.description),
        authorUrn: mini.dashEntityUrn || null,
        authorProfile: mini.publicIdentifier ? 'https://www.linkedin.com/in/' + mini.publicIdentifier : null,
        postedAgo: str(actor.subDescription),
        text: str(p.commentary),
        likes: counts.numLikes || 0,
        comments: counts.numComments || 0,
        shares: counts.numShares || 0,
        contentType: p.content ? Object.keys(p.content)[0] : null,
      }
    })

    return {
      ok: true,
      count: posts.length,
      start: ${start},
      sortBy: '${sortBy}',
      // Said every time, because the alternative is the agent telling the user
      // it read "your feed". It did not: the on-screen feed comes from
      // LinkedIn's Server-Driven UI, a separate pipeline that returns different
      // posts. A post the user can see may legitimately be absent here.
      note: 'this is a feed LinkedIn returned for this account, not the feed rendered on screen — those are different systems',
      posts: safe(posts),
    }
  `)
}

/** Comments on one post. */
export function postCommentsScript(options: { activityId: string; limit?: number }): string {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
  return buildScript(`
    var activityId = String(${JSON.stringify(options.activityId)})
    if (!/^[0-9]+$/.test(activityId)) {
      return { ok: false, error: 'activityId must be the numeric id from linkedin_feed (e.g. "7496811041339740160") — got: ' + activityId }
    }

    var res = await api(COMMENTS_URL + '?count=${limit}&q=comments&sortOrder=RELEVANCE&updateId=' + enc('activity:' + activityId))
    if (res.status !== 200) return { ok: false, error: 'comments returned ' + res.status, detail: res.text }

    var elements = (res.json && res.json.elements) || []
    var comments = elements.map(function (c) {
      var who = c.commenterForDashConversion || {}
      var counts = (c.socialDetail && c.socialDetail.totalSocialActivityCounts) || {}
      var text = (c.comment && c.comment.values && c.comment.values[0] && c.comment.values[0].value)
        || (c.commentV2 && (c.commentV2.text || str(c.commentV2)))
        || null
      return {
        author: str(who.title),
        // supplementaryActorInfoV2 holds the connection degree ("1st", "2nd"),
        // not a headline. Naming it authorHeadline made the field lie about
        // its own contents, which is worse than not having it.
        connectionDegree: (str(who.supplementaryActorInfoV2) || '').replace(/[^0-9a-zA-Z+]/g, '') || null,
        authorProfile: who.navigationUrl || null,
        authorUrn: (who.actorUnion && who.actorUnion.profileUrn) || null,
        text: text,
        createdAt: c.createdTime || null,
        likes: counts.numLikes || 0,
        edited: !!c.edited,
        pinned: !!c.pinned,
      }
    })

    return {
      ok: true,
      activityId: activityId,
      count: comments.length,
      // Separates "this post has no comments" from "the call did not work".
      // The first run of this route returned 200 with an empty list purely
      // because the post chosen had none — which reads identically to failure,
      // and was briefly mistaken for it.
      note: comments.length ? null : 'the call succeeded and this post has no comments',
      comments: safe(comments),
    }
  `)
}

/**
 * Search across LinkedIn — people, posts, companies, jobs.
 *
 * Results arrive grouped into clusters ("People", "Jobs", "Posts"), the same
 * grouping LinkedIn's own results page uses, so it is preserved rather than
 * flattened. Notably this is also the only clean route to jobs: the Jobs page
 * itself is Server-Driven UI with no API behind it.
 */
export function searchScript(options: { query: string; resultType?: string; limit?: number }): string {
  const resultType = (options.resultType ?? 'ALL').toUpperCase().replace(/[^A-Z_]/g, '')
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30)
  return buildScript(`
    var query = String(${JSON.stringify(options.query ?? '')}).trim()
    if (!query) return { ok: false, error: 'search needs a query' }

    var vars = '(start:0,origin:GLOBAL_SEARCH_HEADER,query:(keywords:' + query
      + ',flagshipSearchIntent:SEARCH_SRP'
      + ',queryParameters:List((key:resultType,value:List(${resultType})))'
      + ',includeFiltersInResponse:false,spellCorrectionEnabled:false))'

    var res = await api(GRAPHQL + '&variables=' + vars + '&queryId=' + Q_SEARCH)
    if (res.status !== 200) return { ok: false, error: 'search returned ' + res.status, detail: res.text }

    var block = res.json && res.json.data && res.json.data.searchDashClustersByAll
    if (!block) return { ok: false, error: 'unexpected response shape — no searchDashClustersByAll' }

    var clusters = (block.elements || []).map(function (cluster) {
      var items = (cluster.items || []).slice(0, ${limit}).map(function (row) {
        var e = (row.item && row.item.entityResult) || {}
        return {
          title: str(e.title),
          subtitle: str(e.primarySubtitle),
          detail: str(e.secondarySubtitle),
          summary: str(e.summary),
          // urn:li:fsd_profile:… for a person, urn:li:job:… for a job — the id
          // that lets a result be acted on rather than only displayed.
          urn: e.trackingUrn || null,
          url: e.navigationUrl || null,
        }
      }).filter(function (item) { return item.title })
      return {
        group: str(cluster.title) || 'results',
        totalResultCount: cluster.totalResultCount,
        count: items.length,
        items: items,
      }
    }).filter(function (c) { return c.count > 0 })

    return {
      ok: true,
      query: query,
      resultType: '${resultType}',
      groups: clusters.length,
      // LinkedIn ranks and filters this itself, so an empty group is not proof
      // that nothing matches.
      note: 'LinkedIn ranks and filters these results; an empty group does not prove nothing matches',
      clusters: safe(clusters),
    }
  `)
}

/** The user's own posts, with the engagement figures LinkedIn shows only to them. */
export function myPostsScript(options: { limit?: number; start?: number } = {}): string {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
  const start = Math.max(options.start ?? 0, 0)
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var vars = '(count:${limit},start:${start},profileUrn:' + enc(me.urn) + ')'
    var res = await api(GRAPHQL + '&variables=' + vars + '&queryId=' + Q_MY_POSTS)
    if (res.status !== 200) return { ok: false, error: 'own posts returned ' + res.status, detail: res.text }

    var data = res.json && res.json.data
    var key = data ? Object.keys(data).filter(function (k) { return k.indexOf('feedDashProfileUpdates') === 0 })[0] : null
    if (!key) return { ok: false, error: 'unexpected response shape — no feedDashProfileUpdates* key' }

    var elements = (data[key] && data[key].elements) || []
    var posts = elements.map(function (p) {
      var counts = (p.socialDetail && p.socialDetail.totalSocialActivityCounts) || {}
      var urn = (p.metadata && p.metadata.backendUrn) || null
      return {
        activityId: activityIdOf(urn),
        postUrn: urn,
        text: str(p.commentary),
        likes: counts.numLikes || 0,
        comments: counts.numComments || 0,
        shares: counts.numShares || 0,
        // Visible only on your own posts, and the figure that actually says
        // whether anyone saw it.
        impressions: counts.numImpressions || 0,
        audience: (p.metadata && p.metadata.shareAudience) || null,
        postedAgo: str((p.actor || {}).subDescription),
      }
    })

    return { ok: true, count: posts.length, start: ${start}, posts: safe(posts) }
  `)
}

/** Notifications, newest first. */
export function notificationsScript(options: { limit?: number; onlyUnread?: boolean } = {}): string {
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 50)
  return buildScript(`
    var url = NOTIFICATIONS_URL + '?decorationId=' + NOTIFICATIONS_DECORATION
      + '&count=${limit}&filterUrn=' + enc('urn:li:fsd_notificationFilter:ALL')
      + '&q=notifications&start=0'
    var res = await api(url)
    if (res.status !== 200) return { ok: false, error: 'notifications returned ' + res.status, detail: res.text }

    var elements = (res.json && res.json.elements) || []
    var items = elements.map(function (n) {
      return {
        text: str(n.headline),
        subtext: str(n.subHeadline),
        publishedAt: n.publishedAt || null,
        publishedAgo: str(n.publishedAtText),
        read: !!n.read,
        objectUrn: n.objectUrn || null,
        // Present when the notification is about a post, so it can be opened
        // with linkedin_post_comments without another lookup.
        activityId: activityIdOf(n.objectUrn),
        url: (n.cardAction && n.cardAction.actionTarget) || null,
      }
    })

    var filtered = ${options.onlyUnread ? 'items.filter(function (n) { return !n.read })' : 'items'}
    return { ok: true, count: filtered.length, totalReturned: items.length, notifications: safe(filtered) }
  `)
}
