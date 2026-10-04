// @target linkedin.com
// @timeout 45000

return await (async function () {
  // Let's scroll down progressively to load more posts
  for (let i = 0; i < 8; i++) {
    window.scrollBy(0, 1500)
    await new Promise(r => setTimeout(r, 2000))
  }

  // Find all post blocks. In modern LinkedIn search, each post often has aria-label="Feed post" or class containing feed/update or data-view-name
  // Let's search broadly
  const allDivs = Array.from(document.querySelectorAll('div, li, section'))
  
  // Find nodes whose text starts with or contains 'Feed post\n'
  // Or find all links matching /feed/update/urn:li:activity:
  const updateLinks = Array.from(document.querySelectorAll('a[href*="/feed/update/urn:li:activity:"]'))
  
  const postsMap = new Map()

  for (const a of updateLinks) {
    const href = a.href.split('?')[0]
    const activityMatch = href.match(/urn:li:activity:(\d+)/)
    const actId = activityMatch ? activityMatch[1] : href
    if (postsMap.has(actId)) continue

    // Find the enclosing card container
    let container = a
    for (let depth = 0; depth < 10; depth++) {
      if (!container.parentElement) break
      container = container.parentElement
      // Look for a reasonable container boundary
      if (container.innerText && container.innerText.includes('Feed post') && container.innerText.length > 200) {
        break
      }
      if (container.tagName === 'LI' || (container.getAttribute('data-view-name') || '').includes('feed')) {
        break
      }
    }

    const fullCardText = container.innerText || ''
    
    // Parse lines
    const lines = fullCardText.split('\n').map(l => l.trim()).filter(Boolean)
    
    postsMap.set(actId, {
      url: href,
      activityId: actId,
      cardText: fullCardText,
      lines: lines.slice(0, 25)
    })
  }

  return {
    url: window.location.href,
    postsFound: postsMap.size,
    posts: Array.from(postsMap.values())
  }
})()
