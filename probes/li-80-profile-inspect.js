// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  async function api(url, options = {}) {
    const token = csrf()
    if (!token) return { status: 0, error: 'no JSESSIONID cookie' }
    const headers = {
      'csrf-token': token,
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      ...(options.headers || {})
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = await res.text()
    }
    return { status: res.status, ok: res.ok, data }
  }

  // 1. Check /voyager/api/me
  const meRes = await api('/voyager/api/me')

  // 2. Discover member URN or public identifier from meRes or DOM
  let publicIdentifier = 'mushtaq-assi-573a5a275'
  let memberUrn = null

  if (meRes.ok && meRes.data) {
    const raw = meRes.data
    // extract miniProfile or entity
    const included = raw.included || []
    const mini = included.find(x => x.$type?.includes('MiniProfile') || x.publicIdentifier)
    if (mini) {
      publicIdentifier = mini.publicIdentifier || publicIdentifier
      memberUrn = mini.entityUrn || mini.objectUrn
    }
  }

  // 3. Try voyager profile endpoint
  const profileRes = await api(`/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicIdentifier)}`, {
    headers: {
      'accept': 'application/vnd.linkedin.normalized+json+2.1'
    }
  })

  // 4. Try legacy profile endpoint
  const legacyProfileRes = await api(`/voyager/api/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileView`, {
    headers: {
      'accept': 'application/vnd.linkedin.normalized+json+2.1'
    }
  })

  return {
    publicIdentifier,
    memberUrn,
    me: meRes.data,
    profileDash: profileRes.ok ? profileRes.data : { status: profileRes.status, err: profileRes.data },
    legacyProfile: legacyProfileRes.ok ? legacyProfileRes.data : { status: legacyProfileRes.status, err: legacyProfileRes.data },
  }
})()
