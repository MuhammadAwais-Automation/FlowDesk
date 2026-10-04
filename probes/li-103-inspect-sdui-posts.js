// @target linkedin.com
// @timeout 30000

return await (async function () {
  // Let's inspect the entire DOM text and find all instances of 'Feed post' or user names or 'Follow' buttons
  const followButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Follow' || b.getAttribute('aria-label')?.includes('Follow'))

  // Also let's find all post containers
  // Look for elements with data-chameleon-result-urn or similar
  const chameleonEls = Array.from(document.querySelectorAll('[data-chameleon-result-urn], [data-urn], [data-id]'))

  // Look for all text blocks in main
  const main = document.querySelector('main') || document.body
  const fullText = main.innerText

  // Split by 'Feed post'
  const chunks = fullText.split('Feed post').filter(Boolean)

  return {
    url: window.location.href,
    title: document.title,
    followButtonsCount: followButtons.length,
    chameleonCount: chameleonEls.length,
    feedPostChunksCount: chunks.length,
    chunks: chunks.map(c => c.slice(0, 1500))
  }
})()
