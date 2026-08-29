// @target linkedin.com
//
// READ-ONLY. Establishes the three things every other LinkedIn call needs:
// whether the csrf-token derivation works, what our own mailbox/profile URN is,
// and which Accept header shape the API answers with.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function api(path, accept) {
  var t0 = Date.now()
  var r = await fetch(path, {
    credentials: 'include',
    headers: {
      'csrf-token': csrf(),
      'accept': accept || 'application/json',
      'x-restli-protocol-version': '2.0.0',
    },
  })
  var text = await r.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) {}
  return {
    status: r.status,
    ms: Date.now() - t0,
    bytes: text.length,
    topKeys: json ? Object.keys(json).slice(0, 12) : null,
    sample: json ? JSON.stringify(json).slice(0, 700) : text.slice(0, 300),
  }
}

var token = csrf()

// Same endpoint, two Accept headers. LinkedIn returns a flat body for one and
// a normalized body with a separate `included[]` array for the other; a bridge
// that assumes the wrong one silently reads undefined everywhere.
var plain = await api('/voyager/api/me', 'application/json')
var normalized = await api('/voyager/api/me', 'application/vnd.linkedin.normalized+json+2.1')

// Without the header at all — proves whether csrf is actually required or
// whether cookies alone are enough.
var noCsrfStatus = null
try {
  var r = await fetch('/voyager/api/me', { credentials: 'include' })
  noCsrfStatus = r.status
} catch (e) { noCsrfStatus = 'threw: ' + e.message }

return {
  href: location.href,
  csrfTokenFound: !!token,
  csrfTokenLooksLikeAjax: token ? token.indexOf('ajax:') === 0 : false,
  withCsrf_plain: plain,
  withCsrf_normalized: normalized,
  withoutCsrfHeader_status: noCsrfStatus,
}

// ping 1787533638
