// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }
  const token = csrf()
  const urn = 'urn:li:fsd_profile:ACoAAENA46cB7EHnR4amnmcBfY3nanhv5M92yRw'
  const res = await fetch(`/voyager/api/identity/dash/profiles/${encodeURIComponent(urn)}`, {
    headers: {
      'csrf-token': token,
      'x-restli-protocol-version': '2.0.0'
    }
  })
  return { status: res.status, text: await res.text() }
})()
