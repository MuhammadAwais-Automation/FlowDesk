// @target linkedin.com
// @timeout 30000

return await (async function () {
  const chunks = window.webpackChunk || []
  const foundNames = []

  for (const chunk of chunks) {
    if (Array.isArray(chunk) && chunk[1]) {
      const modules = chunk[1]
      for (const modId of Object.keys(modules)) {
        const str = String(modules[modId])
        const m = str.match(/voyager[a-zA-Z0-9_\.]+/g)
        if (m) {
          foundNames.push(...m)
        }
      }
    }
  }

  const unique = Array.from(new Set(foundNames)).filter(x => x.includes('.'))
  return {
    chunkCount: chunks.length,
    foundCount: unique.length,
    queryIds: unique
  }
})()
