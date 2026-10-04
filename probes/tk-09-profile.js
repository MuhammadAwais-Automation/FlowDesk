// @target tiktok.com
// Dump profile DOM summary
try {
  const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.includes('/video/'))
  const userPostItems = Array.from(document.querySelectorAll('[data-e2e*="user-post"], [data-e2e*="video"]')).map(el => el.getAttribute('data-e2e'))
  const h1 = document.querySelector('h1, h2')?.innerText
  const bodySnippet = document.body.innerText.slice(0, 500)

  return {
    url: window.location.href,
    title: document.title,
    heading: h1,
    videoHrefCount: allLinks.length,
    sampleVideoLinks: allLinks.slice(0, 5),
    userPostItems,
    bodySnippet,
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
