// @target tiktok.com
/**
 * tk-03-search.js
 *
 * Probe 3: TikTok Search, SEO & Competitive Intelligence
 * Searches keywords, hashtags, viral metrics (views, creator follower counts).
 */

try {
  // Test if we are on a search results page or can query search APIs
  const isSearchPage = window.location.href.includes('/search')
  
  // DOM search results
  const searchCards = Array.from(document.querySelectorAll('[data-e2e="search_video-item"], [data-e2e="search-card-user"]'))
  
  const parsedCards = searchCards.map((card, i) => {
    const titleEl = card.querySelector('[data-e2e="search-card-video-caption"]')
    const userEl = card.querySelector('[data-e2e="search-card-user-unique-id"], [data-e2e="search-user-name"]')
    const viewsEl = card.querySelector('[data-e2e="search-card-like-container"], [data-e2e="video-views"]')

    return {
      index: i,
      title: titleEl ? titleEl.textContent.trim() : null,
      user: userEl ? userEl.textContent.trim() : null,
      viewsOrLikes: viewsEl ? viewsEl.textContent.trim() : null,
    }
  }).slice(0, 20)

  // Probe search input on page
  const searchInput = document.querySelector('input[type="search"], input[name="q"], [data-e2e="search-user-input"]')

  return {
    isSearchPage,
    currentUrl: window.location.href,
    searchInputFound: Boolean(searchInput),
    currentQuery: searchInput ? searchInput.value : null,
    cardCount: searchCards.length,
    cards: parsedCards,
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
