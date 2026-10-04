// @target linkedin.com
// @timeout 45000

return await (async function () {
  const allScriptUrls = Array.from(document.querySelectorAll('script')).map(s => s.src).filter(Boolean)
  const matches = []

  for (const url of allScriptUrls) {
    try {
      const res = await fetch(url)
      const code = await res.text()
      const m = code.match(/voyagerIdentity[a-zA-Z0-9_\.]+/g)
      if (m) {
        matches.push(...m)
      }
      const postShares = code.match(/voyager[a-zA-Z0-9_]*Dash[a-zA-Z0-9_\.]+/g)
      if (postShares) {
        matches.push(...postShares.filter(x => x.toLowerCase().includes('profile') || x.toLowerCase().includes('identity') || x.toLowerCase().includes('photo') || x.toLowerCase().includes('image')))
      }
    } catch {}
  }

  const unique = Array.from(new Set(matches))
  return {
    uniqueMatchesCount: unique.length,
    uniqueMatches: unique
  }
})()
