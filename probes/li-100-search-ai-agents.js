// @target linkedin.com
// @goto https://www.linkedin.com/search/results/content/?keywords=AI%20Agents&sortBy=%22relevance%22
// @timeout 45000

return await (async function () {
  await new Promise(r => setTimeout(r, 4000))

  for (let s = 0; s < 5; s++) {
    window.scrollBy(0, 1200)
    await new Promise(r => setTimeout(r, 1500))
  }

  // Look for update containers
  const postEls = Array.from(document.querySelectorAll('.feed-shared-update-v2, div[data-urn*="activity"], div[data-urn*="share"]'))
  
  const results = []
  for (const el of postEls) {
    const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || ''
    
    // Author
    const authorEl = el.querySelector('.update-components-actor__name, .feed-shared-actor__name, span[dir="ltr"] span')
    const author = authorEl ? authorEl.innerText.trim() : 'Unknown'

    // Subtitle / headline
    const headlineEl = el.querySelector('.update-components-actor__description, .feed-shared-actor__description')
    const headline = headlineEl ? headlineEl.innerText.trim() : ''

    // Time posted
    const timeEl = el.querySelector('.update-components-actor__sub-description, .feed-shared-actor__sub-description')
    const timePosted = timeEl ? timeEl.innerText.trim() : ''

    // Post content text
    const textEl = el.querySelector('.feed-shared-update-v2__description, .update-components-text, div.update-components-update-v2__commentary')
    const text = textEl ? textEl.innerText.trim() : (el.innerText || '')

    // Social counts
    const reactionsEl = el.querySelector('.social-details-social-counts__reactions-count, span.social-details-social-counts__social-num-reactions')
    const reactions = reactionsEl ? reactionsEl.innerText.trim() : '0'

    const commentsEl = el.querySelector('.social-details-social-counts__comments, button[aria-label*="comment"]')
    const comments = commentsEl ? commentsEl.innerText.trim() : '0'

    const repostsEl = el.querySelector('.social-details-social-counts__item--reposts, button[aria-label*="repost"]')
    const reposts = repostsEl ? repostsEl.innerText.trim() : '0'

    // Link
    let url = urn ? `https://www.linkedin.com/feed/update/${urn}/` : window.location.href

    results.push({
      author,
      headline,
      timePosted,
      reactions,
      comments,
      reposts,
      urn,
      url,
      textSnippet: text.slice(0, 300),
      fullText: text
    })
  }

  // If no container matched, extract code tags or general DOM summary
  return {
    url: window.location.href,
    title: document.title,
    count: results.length,
    posts: results
  }
})()
