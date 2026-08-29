// @target facebook.com
//
// READ-ONLY. Nothing is clicked, created, changed or deleted.
//
// Pull out the actual fb_dtsg token and any doc_id-looking GraphQL identifiers
// already present in the page HTML, so their real shape is known before trying
// to build anything with them.

var html = document.documentElement.innerHTML || ''

var dtsg = /"token":"([^"]{10,80})"/.exec(html)
var dtsgAlt = /name="fb_dtsg"\s+value="([^"]+)"/.exec(html)
var revision = /"client_revision":(\d+)/.exec(html)
var haste = /"__spin_r":(\d+)/.exec(html)
var docIds = Array.from(new Set((html.match(/"doc_id":"(\d+)"/g) || []).slice(0, 15)))
var userIdMatch = /"USER_ID":"(\d+)"/.exec(html) || /"actorID":"(\d+)"/.exec(html)

return {
  dtsgFromScript: dtsg ? dtsg[1].slice(0, 15) + '…' : null,
  dtsgFromInput: dtsgAlt ? dtsgAlt[1].slice(0, 15) + '…' : null,
  clientRevision: revision ? revision[1] : null,
  spinR: haste ? haste[1] : null,
  docIdSample: docIds.slice(0, 10),
  docIdCount: docIds.length,
  userId: userIdMatch ? userIdMatch[1] : null,
}
