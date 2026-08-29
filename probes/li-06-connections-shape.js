// @target linkedin.com
// READ-ONLY. Why do connection names come back null? Compares the two Accept
// headers on the same route — the flat body may only carry a urn reference,
// with the actual profile parked in the normalized body's included[].
function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
async function get(accept) {
  var r = await fetch('/voyager/api/voyagerRelationshipsDashConnections?count=3&q=search&sortType=RECENTLY_ADDED&start=0', {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': accept, 'x-restli-protocol-version': '2.0.0' },
  })
  var t = await r.text()
  var j = null
  try { j = JSON.parse(t) } catch (e) {}
  return { status: r.status, json: j, raw: j ? null : t.slice(0, 200) }
}

var flat = await get('application/json')
var norm = await get('application/vnd.linkedin.normalized+json+2.1')

var flatEl = flat.json && flat.json.elements && flat.json.elements[0]
var normEl = norm.json && norm.json.data && norm.json.data.elements && norm.json.data.elements[0]
var included = (norm.json && norm.json.included) || []

return {
  flat: {
    status: flat.status,
    firstElement: flatEl,
  },
  normalized: {
    status: norm.status,
    topKeys: norm.json ? Object.keys(norm.json) : null,
    firstElement: normEl,
    includedCount: included.length,
    includedTypes: included.slice(0, 6).map(function (x) { return x.$type || x._type }),
    firstIncluded: included[0] ? {
      entityUrn: included[0].entityUrn,
      firstName: included[0].firstName,
      lastName: included[0].lastName,
      headline: included[0].headline,
      publicIdentifier: included[0].publicIdentifier,
    } : null,
  },
}
