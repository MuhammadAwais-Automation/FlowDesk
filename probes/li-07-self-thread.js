// @target linkedin.com
// READ-ONLY. Is there a conversation whose only participant is the user
// themselves? LinkedIn supports messaging yourself, and it is the one target
// where a live send test harms nobody. Sending needs an existing conversation,
// so this has to be answered before anything is attempted.
function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
function enc(v) { return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29') }

var meRaw = await (await fetch('/voyager/api/me', { credentials: 'include', headers: { 'csrf-token': csrf(), 'x-restli-protocol-version': '2.0.0' } })).text()
var self = 'urn:li:fsd_profile:' + meRaw.match(/ACoAA[A-Za-z0-9_-]+/)[0]

var cursor = ''
var selfThreads = []
var scanned = 0

for (var page = 0; page < 6; page++) {
  var base = '(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20'
  if (cursor) base += ',nextCursor:' + enc(cursor)
  base += ',mailboxUrn:' + enc(self) + ')'
  var r = await fetch('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf&variables=' + base, {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
  })
  if (r.status !== 200) break
  var j = await r.json()
  var block = j.data.messengerConversationsByCategoryQuery
  var els = block.elements || []
  scanned += els.length
  for (var i = 0; i < els.length; i++) {
    var c = els[i]
    var urns = (c.conversationParticipants || []).map(function (p) { return p.hostIdentityUrn })
    var others = urns.filter(function (u) { return u !== self })
    if (others.length === 0 && urns.length > 0) {
      var last = (c.messages && c.messages.elements && c.messages.elements[0]) || null
      selfThreads.push({
        conversationUrn: c.entityUrn,
        participantCount: urns.length,
        lastText: last && last.body ? last.body.text : null,
        lastActivityAt: c.lastActivityAt,
      })
    }
  }
  cursor = (block.metadata && block.metadata.nextCursor) || ''
  if (!cursor) break
}

return { self: self, conversationsScanned: scanned, selfThreadCount: selfThreads.length, selfThreads: selfThreads }
