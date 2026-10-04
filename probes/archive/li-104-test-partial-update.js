// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }
  const token = csrf()
  const urn = 'urn:li:fsd_profile:ACoAAENA46cB7EHnR4amnmcBfY3nanhv5M92yRw'
  const patchBody = {
    patch: {
      '$set': {
        headline: 'Full-Stack AI Developer | AI Agents & Automations',
        multiLocaleHeadline: {
          en_US: 'Full-Stack AI Developer | AI Agents & Automations'
        }
      }
    }
  }

  const res = await fetch(`/voyager/api/identity/dash/profiles/${encodeURIComponent(urn)}`, {
    method: 'POST',
    headers: {
      'csrf-token': token,
      'x-restli-method': 'partial_update',
      'x-restli-protocol-version': '2.0.0',
      'content-type': 'application/json'
    },
    body: JSON.stringify(patchBody)
  })

  let text = ''
  try { text = await res.text() } catch {}

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text
  }
})()
