// @target linkedin.com
// @timeout 30000

return await (async function () {
  // Search all script tags or webpack chunk cache for queryId starting with voyagerIdentity
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
  const results = []

  // Check inline scripts
  for (const s of Array.from(document.querySelectorAll('script:not([src])'))) {
    const txt = s.innerText
    const matches = txt.match(/voyagerIdentity[a-zA-Z0-9_\.]+/g)
    if (matches) results.push(...matches)
  }

  // Fetch 3-5 main vendor / profile scripts and regex them
  const profileScripts = scripts.filter(s => s.includes('profile') || s.includes('identity') || s.includes('voyager') || s.includes('flagship'))

  for (const src of profileScripts.slice(0, 5)) {
    try {
      const res = await fetch(src)
      const code = await res.text()
      const matches = code.match(/voyagerIdentityDash[a-zA-Z0-9_\.]+/g)
      if (matches) results.push(...matches)
    } catch {}
  }

  // Unique
  const unique = Array.from(new Set(results))

  return {
    scriptsChecked: profileScripts.length,
    foundQueryIds: unique
  }
})()
