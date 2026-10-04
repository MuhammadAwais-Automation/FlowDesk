// @target linkedin.com
// @timeout 30000

return (function () {
  const codeTags = Array.from(document.querySelectorAll('code[id*="bpr-guid"]'))
  let voyagerUpdatesCount = 0
  let sampleUpdate = null

  for (const tag of codeTags) {
    const text = tag.textContent || ''
    if (text.includes('com.linkedin.voyager') || text.includes('updateMetadata') || text.includes('socialDetail')) {
      voyagerUpdatesCount++
      if (!sampleUpdate && text.length > 500) {
        sampleUpdate = text.slice(0, 1000)
      }
    }
  }

  // Check main container classes
  const main = document.querySelector('main')
  const allContainers = Array.from(document.querySelectorAll('div[data-view-name], ul.reusable-search__entity-result-list li, div.search-results-container'))

  // Also check all links on page
  const updateLinks = Array.from(document.querySelectorAll('a[href*="/feed/update/"], a[href*="/activity/"]')).map(a => a.href)

  return {
    url: window.location.href,
    title: document.title,
    codeTagsCount: codeTags.length,
    voyagerUpdatesCount,
    containersCount: allContainers.length,
    updateLinksCount: updateLinks.length,
    sampleLinks: updateLinks.slice(0, 10),
    mainTextSnippet: main ? main.innerText.slice(0, 800) : document.body.innerText.slice(0, 800)
  }
})()
