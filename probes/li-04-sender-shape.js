// @target linkedin.com
// READ-ONLY. Answers one question: in the inbox response, how is a message's
// sender identified, and does it match an entry in conversationParticipants?
// The first read resolved to the viewer's own urn on every row, which is
// either a real quirk or a wrong assumption — worth one call to find out.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
function enc(v) { return encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29') }

var me = await (await fetch('/voyager/api/me', { credentials: 'include', headers: { 'csrf-token': csrf(), 'x-restli-protocol-version': '2.0.0' } })).text()
var self = 'urn:li:fsd_profile:' + me.match(/ACoAA[A-Za-z0-9_-]+/)[0]

var url = '/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf'
  + '&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:5,mailboxUrn:' + enc(self) + ')'
var r = await fetch(url, { credentials: 'include', headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' } })
var j = await r.json()
var els = j.data.messengerConversationsByCategoryQuery.elements

return {
  self: self,
  conversations: els.slice(0, 3).map(function (c) {
    var msgs = (c.messages && c.messages.elements) || []
    return {
      title: c.title,
      participants: (c.conversationParticipants || []).map(function (p) {
        var m = p.participantType && p.participantType.member
        return {
          entityUrn: p.entityUrn,
          hostIdentityUrn: p.hostIdentityUrn,
          name: m ? [m.firstName && m.firstName.text, m.lastName && m.lastName.text].filter(Boolean).join(' ') : null,
        }
      }),
      previewMessageCount: msgs.length,
      previewMessages: msgs.slice(0, 2).map(function (m) {
        return {
          text: m.body && m.body.text ? m.body.text.slice(0, 60) : null,
          deliveredAt: m.deliveredAt,
          senderKeys: m.sender ? Object.keys(m.sender) : null,
          senderEntityUrn: m.sender && m.sender.entityUrn,
          senderHostIdentityUrn: m.sender && m.sender.hostIdentityUrn,
          senderNestedName: m.sender && m.sender.participantType && m.sender.participantType.member
            ? [m.sender.participantType.member.firstName && m.sender.participantType.member.firstName.text,
               m.sender.participantType.member.lastName && m.sender.participantType.member.lastName.text].filter(Boolean).join(' ')
            : null,
        }
      }),
    }
  }),
}
