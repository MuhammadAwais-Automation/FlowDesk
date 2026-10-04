// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  const token = csrf()
  const urn = 'ACoAAENA46cB7EHnR4amnmcBfY3nanhv5M92yRw'

  // Test 1: Check what methods are supported on /voyager/api/identity/dash/profiles/
  const res = await fetch(`/voyager/api/identity/dash/profiles/${encodeURIComponent(urn)}`, {
    method: 'OPTIONS',
    headers: {
      'csrf-token': token,
      'x-restli-protocol-version': '2.0.0'
    }
  })

  // Test 2: Check GET /voyager/api/identity/dash/profiles/{urn}
  const getRes = await fetch(`/voyager/api/identity/dash/profiles/${encodeURIComponent(urn)}`, {
    method: 'GET',
    headers: {
      'csrf-token': token,
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0'
    }
  })

  let getData = null
  try { getData = await getRes.json() } catch {}

  return {
    optionsStatus: res.status,
    optionsHeaders: Object.fromEntries(res.headers.entries()),
    getStatus: getRes.status,
    hasProfileData: !!getData
  }
})()
