// @target linkedin.com
// @timeout 60000

return await (async function () {
  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  function str(v) {
    if (!v) return null
    if (typeof v === 'string') return v.trim()
    if (typeof v.text === 'string') return v.text.trim()
    if (v.values && v.values[0] && typeof v.values[0].value === 'string') return v.values[0].value.trim()
    return null
  }

  function activityIdOf(urn) {
    if (!urn) return null
    var m = String(urn).match(/activity:([0-9]+)/)
    return m ? m[1] : null
  }

  async function api(url) {
    const res = await fetch(url, {
      headers: {
        'csrf-token': csrf(),
        'accept': 'application/json',
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang': 'en_US'
      }
    })
    return await res.json()
  }

  const Q_SEARCH = "voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa"

  async function searchPosts(queryKeyword, datePosted) {
    let qParam = '(key:resultType,value:List(CONTENT))'
    if (datePosted) {
      qParam += ',(key:datePosted,value:List(' + datePosted + '))'
    }
    const vars = '(start:0,origin:FACETED_SEARCH,query:(keywords:' + encodeURIComponent(queryKeyword) + ',flagshipSearchIntent:SEARCH_SRP,queryParameters:List(' + qParam + ')))'
    const url = '/voyager/api/graphql?includeWebMetadata=true&variables=' + vars + '&queryId=' + Q_SEARCH

    const json = await api(url)
    const clusters = json?.data?.searchDashClustersByAll?.elements || []
    
    const posts = []
    for (const cluster of clusters) {
      const items = cluster.items || []
      for (const itemRow of items) {
        const update = itemRow.item?.searchFeedUpdate?.update
        if (!update) continue
        
        const urn = update.entityUrn || update.preDashEntityUrn
        const actId = activityIdOf(urn)
        const actor = update.actor || {}
        const social = update.socialDetail?.totalSocialActivityCounts || {}
        
        // Extract commentary text
        const commentary = update.commentary
        const text = str(commentary) || (commentary && commentary.text) || ''
        
        const likes = social.numLikes || 0
        const reactions = social.totalReactionCount || likes
        const comments = social.numComments || 0
        const shares = social.numShares || 0

        // Subdescription often contains posted time, e.g. "1d •", "23h •", etc.
        const postedAgo = str(actor.subDescription)

        posts.push({
          query: queryKeyword,
          activityId: actId,
          postUrn: urn,
          url: actId ? `https://www.linkedin.com/feed/update/urn:li:activity:${actId}/` : null,
          author: str(actor.name),
          headline: str(actor.description),
          postedAgo: postedAgo,
          reactions: reactions,
          likes: likes,
          comments: comments,
          shares: shares,
          text: text
        })
      }
    }
    return posts
  }

  // Run searches across the key niches
  const res1 = await searchPosts("AI Agents")
  const res1Past24 = await searchPosts("AI Agents", "past-24h")
  const res2 = await searchPosts("Autonomous Agents")
  const res2Past24 = await searchPosts("Autonomous Agents", "past-24h")
  const res3 = await searchPosts("LLM automations")
  const res4 = await searchPosts("AI Engineering")

  // Combine and deduplicate
  const allPosts = [...res1, ...res1Past24, ...res2, ...res2Past24, ...res3, ...res4]
  const deduped = []
  const seen = new Set()
  for (const p of allPosts) {
    if (!p.activityId || seen.has(p.activityId)) continue
    seen.add(p.activityId)
    deduped.push(p)
  }

  // Sort by engagement (reactions + comments * 2 + shares * 3)
  deduped.sort((a, b) => {
    const scoreA = (a.reactions || 0) + (a.comments || 0) * 2 + (a.shares || 0) * 3
    const scoreB = (b.reactions || 0) + (b.comments || 0) * 2 + (b.shares || 0) * 3
    return scoreB - scoreA
  })

  return {
    totalExtracted: allPosts.length,
    uniqueCount: deduped.length,
    topPosts: deduped
  }
})()
