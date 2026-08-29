// @target linkedin.com
//
// READ-ONLY. Exercises the messaging read path found in the CDP capture
// (probes/FINDINGS-linkedin.md) from our own code rather than by watching
// LinkedIn's, which is the only way to know we can actually drive it:
//   inbox list -> one thread's messages -> unread counts -> paging cursor
//
// Nothing here writes. Sending stays approval-gated and out of probes.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function api(url) {
  var t0 = Date.now()
  var r = await fetch(url, {
    credentials: 'include',
    headers: {
      'csrf-token': csrf(),
      'accept': 'application/json',
      'x-restli-protocol-version': '2.0.0',
    },
  })
  var text = await r.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) {}
  return { status: r.status, ms: Date.now() - t0, bytes: text.length, json: json, raw: json ? null : text.slice(0, 300) }
}

// Shrinks an object to its shape: keys, and scalar leaves only. A probe that
// returns whole LinkedIn entities produces a result nobody can read.
// The sender shape was guessed wrong on the first run and every name came
// back null. Rather than guess again, walk whatever nesting is there.
function nameOf(participant) {
  if (!participant) return null
  var p = participant.participantType || participant
  var m = p.member || p.organization || p
  var first = m.firstName && (m.firstName.text || m.firstName)
  var last = m.lastName && (m.lastName.text || m.lastName)
  var name = [first, last].filter(Boolean).join(' ')
  return name || m.name || participant.entityUrn || null
}

function shape(v, depth) {
  depth = depth || 0
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v
  if (Array.isArray(v)) return depth >= 2 ? '[' + v.length + ' items]' : v.slice(0, 2).map(function (x) { return shape(x, depth + 1) })
  if (depth >= 3) return '{' + Object.keys(v).slice(0, 12).join(',') + '}'
  var out = {}
  Object.keys(v).slice(0, 30).forEach(function (k) { out[k] = shape(v[k], depth + 1) })
  return out
}

var GQL = '/voyager/api/voyagerMessagingGraphQL/graphql'
var Q_CONVERSATIONS = 'messengerConversations.9501074288a12f3ae9e3c7ea243bccbf'
// Two messengerMessages queryIds exist and they are NOT interchangeable: the
// hash below is the one that takes (deliveredAt, conversationUrn, countBefore,
// countAfter). Calling it with conversationUrn alone returns 400 — which is
// exactly what the first run of this probe did.
var Q_MESSAGES = 'messengerMessages.d8ea76885a52fd5dc5c317078ab7c977'

// encodeURIComponent deliberately leaves ( ) unescaped, but LinkedIn escapes
// them — and a conversation urn contains a parenthesised pair, so the default
// encoding produces a URL the server rejects.
function liEncode(value) {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29')
}
var Q_COUNTS = 'messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b'

// ── who we are ────────────────────────────────────────────────────────
var me = await api('/voyager/api/me')
var meText = JSON.stringify(me.json || {})
var idMatch = meText.match(/ACoAA[A-Za-z0-9_-]+/)
if (!idMatch) return { step: 'identity', ok: false, me: shape(me.json), note: 'no ACoAA… profile id in /voyager/api/me' }
var mailboxUrn = 'urn:li:fsd_profile:' + idMatch[0]

// ── inbox ─────────────────────────────────────────────────────────────
var vars = '(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:'
  + liEncode(mailboxUrn) + ')'
var inbox = await api(GQL + '?queryId=' + Q_CONVERSATIONS + '&variables=' + vars)

var block = inbox.json && inbox.json.data && inbox.json.data.messengerConversationsByCategoryQuery
var elements = (block && block.elements) || []
var cursor = block && block.metadata && block.metadata.nextCursor

// A conversation summarised the way the bridge will need it — proving the
// fields we want are actually present, not merely plausible.
var conversations = elements.slice(0, 5).map(function (c) {
  var participants = (c.conversationParticipants || []).map(function (p) {
    var m = p.participantType && p.participantType.member
    return m ? [m.firstName && m.firstName.text, m.lastName && m.lastName.text].filter(Boolean).join(' ') : (p.entityUrn || '?')
  })
  var last = (c.messages && c.messages.elements && c.messages.elements[0]) || null
  return {
    entityUrn: c.entityUrn,
    title: c.title,
    unreadCount: c.unreadCount,
    read: c.read,
    lastActivityAt: c.lastActivityAt,
    participants: participants,
    lastMessageText: last && last.body && last.body.text ? last.body.text.slice(0, 100) : null,
    lastMessageSenderRaw: last && last.sender ? Object.keys(last.sender) : null,
    lastMessageSender: nameOf(last && last.sender),
  }
})

// ── one thread's messages ─────────────────────────────────────────────
var thread = null
if (elements.length && elements[0].entityUrn) {
  var convUrn = elements[0].entityUrn
  var msgVars = '(deliveredAt:' + Date.now()
    + ',conversationUrn:' + liEncode(convUrn)
    + ',countBefore:20,countAfter:0)'
  var msgs = await api(GQL + '?queryId=' + Q_MESSAGES + '&variables=' + msgVars)
  var mblock = msgs.json && msgs.json.data
  var mkey = mblock ? Object.keys(mblock).filter(function (k) { return k.indexOf('messenger') === 0 })[0] : null
  var mels = (mkey && mblock[mkey] && mblock[mkey].elements) || []
  thread = {
    status: msgs.status,
    bytes: msgs.bytes,
    responseKey: mkey,
    messageCount: mels.length,
    nextCursor: mkey && mblock[mkey].metadata ? mblock[mkey].metadata.nextCursor : undefined,
    firstMessageKeys: mels[0] ? Object.keys(mels[0]) : null,
    messages: mels.slice(0, 4).map(function (m) {
      return {
        deliveredAt: m.deliveredAt,
        from: nameOf(m.sender),
        text: m.body && m.body.text ? m.body.text.slice(0, 160) : null,
        hasAttachments: !!(m.renderContent && m.renderContent.length),
      }
    }),
  }
}

// ── unread counts ─────────────────────────────────────────────────────
var counts = await api(GQL + '?queryId=' + Q_COUNTS + '&variables=(mailboxUrn:' + liEncode(mailboxUrn) + ')')

return {
  href: location.href,
  mailboxUrn: mailboxUrn,
  inbox: {
    status: inbox.status,
    bytes: inbox.bytes,
    conversationCount: elements.length,
    hasNextCursor: !!cursor,
    firstConversationKeys: elements[0] ? Object.keys(elements[0]) : null,
    conversations: conversations,
  },
  thread: thread,
  counts: { status: counts.status, bytes: counts.bytes, data: shape(counts.json && counts.json.data) },
}
