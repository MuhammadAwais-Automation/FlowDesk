// @target linkedin.com
//
// READ-ONLY.
//
// GET /voyager/api/feed/updates/urn:li:activity:<id> returns the right share
// urn — verified in li-41. But that was found by regexing the whole response,
// and a delete tool cannot work that way: a post that reshares someone else's
// content carries THEIR share urn in the same payload, and picking the wrong
// one deletes the wrong thing permanently.
//
// So this reports every path at which a share urn appears, to find a field that
// means "this post" rather than "a post mentioned in this response".

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
function enc(v) {
  return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

var ACTIVITY = '7497280269775859712'
var res = await fetch('/voyager/api/feed/updates/' + enc('urn:li:activity:' + ACTIVITY), {
  credentials: 'include',
  headers: {
    'csrf-token': csrf(),
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
  },
})
if (!res.ok) return { ok: false, status: res.status }
var json = await res.json()

var paths = []
;(function walk(node, path, depth) {
  if (depth > 12 || paths.length > 60) return
  if (typeof node === 'string') {
    if (/^urn:li:(share|activity|ugcPost):[0-9]+$/.test(node)) paths.push({ path: path, value: node })
    return
  }
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length && i < 12; i++) walk(node[i], path + '[' + i + ']', depth + 1)
    return
  }
  if (node && typeof node === 'object') {
    var keys = Object.keys(node)
    for (var i = 0; i < keys.length; i++) walk(node[keys[i]], path + '.' + keys[i], depth + 1)
  }
})(json, '', 0)

// updateMetadata objects specifically, since that is what the delete guard
// looks at and it found none.
var metas = []
var inc = json.included || []
for (var i = 0; i < inc.length; i++) {
  var m = inc[i] && inc[i].updateMetadata
  if (m) metas.push({ index: i, keys: Object.keys(m).slice(0, 12), urn: m.urn || null, shareUrn: m.shareUrn || null })
}

return {
  ok: true,
  activity: ACTIVITY,
  includedCount: inc.length,
  updateMetadatas: metas,
  topLevelKeys: Object.keys(json).slice(0, 20),
  urnPaths: paths,
}
