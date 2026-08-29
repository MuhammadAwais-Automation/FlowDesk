// @target example.com
//
// Checks whether an endpoint EXISTS, without triggering what it does.
//
// The trick: send a deliberately invalid argument. The status code separates
// the two cases, and nothing happens either way.
//
//   404, or an HTML error page  -> the route is not in this build
//   400 / 422 with a JSON body  -> the route exists and rejected the payload
//
// This is worth knowing before deciding an action is impossible, and it is far
// safer than "just try it and see" — an invalid invitee cannot invite anyone,
// an invalid post id cannot delete a post.
//
// Two cautions:
//   - Make the invalid argument OBVIOUSLY invalid. "test" might be a real
//     handle; "ACoAA_DOES_NOT_EXIST_PROBE" is not.
//   - A 400 tells you the route is there. It does not tell you the payload
//     shape. For that you still need a capture of the real action — guessing
//     shapes against a live endpoint is how accounts get rate-limited.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)   // adapt to the site
  return m ? m[1] : null
}

async function probe(url, body) {
  var headers = {
    'csrf-token': csrf(),
    'accept': 'application/json',
  }
  if (body !== undefined) headers['content-type'] = 'application/json; charset=UTF-8'
  var r = await fetch(url, { method: 'POST', credentials: 'include', headers: headers, body: body })
  var text = await r.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) {}
  var isHtml = /^\s*<!--|^\s*<html/i.test(text)
  return {
    status: r.status,
    // An HTML error page means the route does not exist at all; a JSON body
    // means something on the other end read the request and had an opinion.
    routeExists: !isHtml && r.status !== 404,
    bodyKind: isHtml ? 'html-error-page' : (json ? 'json' : 'text'),
    code: (json && json.data && json.data.code) || (json && json.code) || null,
    detail: text.slice(0, 160),
  }
}

var INVALID = 'FLOWDESK_PROBE_DOES_NOT_EXIST'

var attempts = [
  { name: 'candidate A', url: '/api/things?action=create', body: JSON.stringify({ target: INVALID }) },
  { name: 'candidate B', url: '/api/v2/things', body: JSON.stringify({ targetUrn: 'urn:x:' + INVALID }) },
]

var results = []
for (var i = 0; i < attempts.length; i++) {
  var r = await probe(attempts[i].url, attempts[i].body)
  results.push({ name: attempts[i].name, url: attempts[i].url, result: r })
}

// Confirm nothing was actually created. Pick a counter that WOULD move if it
// had — and check that it is the right counter. A count of things received
// cannot move when you send one, so it proves nothing.
var verify = await fetch('/api/things?q=mine&count=1', {
  credentials: 'include',
  headers: { 'csrf-token': csrf(), 'accept': 'application/json' },
})
var verifyJson = null
try { verifyJson = await verify.json() } catch (e) {}

return {
  attempts: results,
  // Name the field so a reader can judge whether it would really have moved.
  verifiedNothingCreated: {
    field: 'total (things I have created)',
    value: verifyJson && verifyJson.paging && verifyJson.paging.total,
  },
}
