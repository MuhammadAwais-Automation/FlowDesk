// @target linkedin.com
// @goto https://www.linkedin.com/search/results/content/?keywords=Autonomous%20Agents&sortBy=%22date_posted%22
// @timeout 35000

return await (async function () {
  await new Promise(r => setTimeout(r, 4500))

  // Click all '... more' buttons to expand full post text!
  const moreBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('more'))
  for (const b of moreBtns) {
    try { b.click() } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 1000))

  // Extract all text chunks by 'Feed post'
  const main = document.querySelector('main') || document.body
  const fullText = main.innerText
  const chunks = fullText.split('Feed post').filter(Boolean)

  // Also collect all links
  const links = Array.from(document.querySelectorAll('a[href*="/feed/update/"], a[href*="/activity/"]')).map(a => a.href)

  return {
    url: window.location.href,
    title: document.title,
    chunksCount: chunks.length,
    chunks: chunks.map(c => c.slice(0, 2500)),
    links: [...new Set(links)]
  }
})()
