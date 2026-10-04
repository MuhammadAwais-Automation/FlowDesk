// @target tiktok.com
// @timeout 200000
// Waits (up to 180s) for the user to press Schedule, recording the network meanwhile.
const cap = await probe.captureNetwork(async () => {
  const start = Date.now()
  while (Date.now() - start < 180000) {
    if (!location.href.includes('/tiktokstudio/upload')) return { left: location.href }
    await new Promise(r => setTimeout(r, 1000))
  }
  return { timedOut: true }
})
const keep = (cap.requests || []).filter(r => /project\/post|schedul/i.test(r.url))
return { result: cap.result, reqs: keep.map(r => ({ m: r.method, url: r.url.slice(0, 300), status: r.status, post: typeof r.postData === 'string' ? r.postData.slice(0, 20000) : null, resp: (r.responseBody || '').slice(0, 1500) })) }
