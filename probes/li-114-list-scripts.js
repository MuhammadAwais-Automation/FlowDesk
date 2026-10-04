// @target linkedin.com
// @timeout 30000

return await (async function () {
  const allScriptUrls = Array.from(document.querySelectorAll('script')).map(s => s.src).filter(Boolean)
  return {
    count: allScriptUrls.length,
    sample: allScriptUrls.slice(0, 10)
  }
})()
