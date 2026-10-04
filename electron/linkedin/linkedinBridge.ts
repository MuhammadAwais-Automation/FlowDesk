/**
 * LinkedIn messaging bridge — the JavaScript that runs inside the live,
 * logged-in LinkedIn page.
 *
 * Deliberately NOT modelled on whatsappInject.ts, and the difference is worth
 * stating because the filename would otherwise imply it.
 *
 * WhatsApp required a persistent injection: its wire traffic is Noise-encrypted
 * binary, so the only readable copy of a message is inside the page's own
 * decrypted store, reached by hooking its module loader on dom-ready. That
 * injection then has to survive — and dies on every navigation.
 *
 * LinkedIn needs none of that. Its messaging API is ordinary authenticated
 * JSON; the page is needed only as a place that already holds the session
 * cookie. So each call is a self-contained script evaluated on demand, with no
 * persistent state, no dom-ready dependency, and nothing to break when the
 * user navigates. Everything here is a pure string builder, which is also what
 * makes it testable without an Electron window.
 *
 * Evidence for every endpoint and payload below is in probes/FINDINGS-linkedin.md,
 * captured from real traffic rather than guessed.
 */

/** Endpoints and query hashes, all observed on the wire. */
const GQL = '/voyager/api/voyagerMessagingGraphQL/graphql'
const Q_CONVERSATIONS = 'messengerConversations.9501074288a12f3ae9e3c7ea243bccbf'
const Q_MESSAGES = 'messengerMessages.d8ea76885a52fd5dc5c317078ab7c977'
const Q_COUNTS = 'messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b'
const SEND_URL = '/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage'
const MARK_READ_URL = '/voyager/api/voyagerMessagingDashMessagingBadge?action=markAllMessagesAsSeen'

/**
 * Read surfaces beyond messaging. Every one of these was observed answering
 * with real data — see probes/FINDINGS-linkedin.md. Two of them are legacy
 * routes the current web client no longer calls but the server still serves,
 * which is why they were found by trying rather than by watching.
 */
const GRAPHQL = '/voyager/api/graphql?includeWebMetadata=true'
const FEED_URL = '/voyager/api/feed/updatesV2'
const COMMENTS_URL = '/voyager/api/feed/comments'
const NOTIFICATIONS_URL = '/voyager/api/voyagerIdentityDashNotificationCards'
const NOTIFICATIONS_DECORATION = 'com.linkedin.voyager.dash.deco.identity.notifications.CardsCollection-80'
const Q_SEARCH = 'voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa'
const Q_MY_POSTS = 'voyagerFeedDashProfileUpdates.20c70fe0314184158516a7ec004c0408'

/**
 * Shared prelude. Written in ES5-flavoured JavaScript on purpose: it is a
 * string, so TypeScript never parses it, and a syntax error here surfaces only
 * at runtime inside someone else's page. Keeping it plain removes a whole class
 * of "worked in the editor" mistakes.
 */
/**
 * Creating a post.
 *
 * Captured from a real post published by hand while the CDP recorder ran, then
 * read off the wire:
 *
 *   POST /voyager/api/graphql?action=execute&queryId=voyagerContentcreationDashShares.<hash>
 *   {"variables":{"post":{...,"commentary":{"text":"...","attributesV2":[]}}},"queryId":"...","includeWebMetadata":true}
 *   -> 200 {"data":{"data":{"createContentcreationDashShares":{"*entity":"urn:li:fsd_share:urn:li:share:<id>"}}}}
 *
 * This matters more than it looks. Liking and commenting are Server-Driven UI:
 * their requests carry binding keys derived from a page load, not data, so
 * there is nothing to replay and both had to be driven by clicking the real
 * controls. Posting is not — the text travels in the payload in plain sight, so
 * it can be sent directly. No composer, no click, no tab navigation, and
 * nothing that breaks the next time LinkedIn moves a button.
 *
 * The queryId is a build-specific hash and WILL rotate when LinkedIn ships a
 * new web client. That is not a hidden failure: a rotated id returns a non-200
 * and the error below says exactly what to do about it, rather than the call
 * appearing to succeed.
 */
const CREATE_POST_QUERY_ID = 'voyagerContentcreationDashShares.80089eb2e82a2dfa23cb621fb09eb7bf'
const CREATE_POST_URL = `/voyager/api/graphql?action=execute&queryId=${CREATE_POST_QUERY_ID}`

/**
 * Deleting a post, and the id problem that had to be solved first.
 *
 * Delete itself is simple and was verified end to end against a throwaway
 * draft: `DELETE /voyager/api/contentcreation/normShares/<share urn>` returns
 * 204, and reading the share back afterwards returns 400 rather than the post.
 *
 * The trap is which id. Every read tool here reports an ACTIVITY id, and the
 * same post's SHARE urn is a different number — the post published during this
 * work was activity 7497263203417169921 and share 7497263200586039296. Feeding
 * an activity id to the delete route does not fail safely, it just 400s; but
 * worse, the mapping response contains MORE than one share urn when a post
 * reshares somebody else's content, so pulling one out with a regex could
 * delete the wrong post permanently.
 *
 * `GET /voyager/api/feed/updates/urn:li:activity:<id>` returns both, paired
 * inside `included[].updateMetadata` — `urn` (the activity) alongside
 * `shareUrn`. Matching on the pair is what makes this safe, and it is why the
 * resolve step below does not simply search the payload.
 */
const UPDATE_BY_ACTIVITY_URL = '/voyager/api/feed/updates/'
const NORM_SHARES_URL = '/voyager/api/contentcreation/normShares/'

/**
 * Attaching an image to a post.
 *
 * Verified end to end against the live API with a real 200x200 PNG (a 2x2 test
 * image was rejected by the upload validator — size matters):
 *
 *   1. POST /voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload
 *      { mediaUploadType: 'IMAGE_SHARING', fileSize, filename }
 *      -> data.value { urn (the asset), singleUploadUrl, pollingUrl }
 *   2. PUT the bytes to singleUploadUrl with content-type image/png -> 201
 *   3. poll pollingUrl until the feedshare-image recipe reports AVAILABLE
 *   4. create the post with media: { mediaUrn, category: 'IMAGE', altText }
 *
 * The create field was found by error-probing: `media` is a Map (ShareMedia),
 * its asset field is `mediaUrn`, and `category` is a NonNull that must be
 * 'IMAGE'. Guessing any one of those wrong returns a precise validation error
 * naming the next missing field, which is how the shape was assembled.
 */
const MEDIA_UPLOAD_URL = '/voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload'

/**
 * Deleting a comment.
 *
 * Verified: `DELETE /voyager/api/feed/comments/<comment urn>` -> 204, and the
 * comment is gone from the thread afterwards. The comment urn has the form
 * `urn:li:comment:(activity:<postId>,<commentId>)`, and each comment element
 * carries a `canDelete` boolean — checked before attempting, so the tool never
 * tries to delete a comment LinkedIn would refuse (someone else's).
 */
const COMMENTS_DELETE_URL = '/voyager/api/feed/comments/'

const PRELUDE = `
  var GQL = ${JSON.stringify(GQL)}
  var Q_CONVERSATIONS = ${JSON.stringify(Q_CONVERSATIONS)}
  var Q_MESSAGES = ${JSON.stringify(Q_MESSAGES)}
  var Q_COUNTS = ${JSON.stringify(Q_COUNTS)}
  var SEND_URL = ${JSON.stringify(SEND_URL)}
  var MARK_READ_URL = ${JSON.stringify(MARK_READ_URL)}
  var GRAPHQL = ${JSON.stringify(GRAPHQL)}
  var FEED_URL = ${JSON.stringify(FEED_URL)}
  var COMMENTS_URL = ${JSON.stringify(COMMENTS_URL)}
  var NOTIFICATIONS_URL = ${JSON.stringify(NOTIFICATIONS_URL)}
  var NOTIFICATIONS_DECORATION = ${JSON.stringify(NOTIFICATIONS_DECORATION)}
  var Q_SEARCH = ${JSON.stringify(Q_SEARCH)}
  var Q_MY_POSTS = ${JSON.stringify(Q_MY_POSTS)}
  var CREATE_POST_URL = ${JSON.stringify(CREATE_POST_URL)}
  var CREATE_POST_QUERY_ID = ${JSON.stringify(CREATE_POST_QUERY_ID)}
  var UPDATE_BY_ACTIVITY_URL = ${JSON.stringify(UPDATE_BY_ACTIVITY_URL)}
  var NORM_SHARES_URL = ${JSON.stringify(NORM_SHARES_URL)}
  var MEDIA_UPLOAD_URL = ${JSON.stringify(MEDIA_UPLOAD_URL)}
  var COMMENTS_DELETE_URL = ${JSON.stringify(COMMENTS_DELETE_URL)}

  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  // Rest.li keeps its own parens literal but escapes them inside values, and
  // encodeURIComponent deliberately does not touch parens. A conversation urn
  // contains a parenthesised pair, so the default encoding returns 400 — a
  // failure already hit once during discovery.
  function enc(v) {
    return encodeURIComponent(String(v)).replace(/\\(/g, '%28').replace(/\\)/g, '%29')
  }

  async function api(url, options) {
    options = options || {}
    var token = csrf()
    if (!token) return { status: 0, error: 'no JSESSIONID cookie — not signed in to LinkedIn' }
    var headers = {
      'csrf-token': token,
      'accept': options.accept || 'application/json',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json; charset=UTF-8'
    var response = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: headers,
      body: options.body,
    })
    var text = await response.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) { /* non-JSON is itself the answer */ }
    return { status: response.status, ok: response.ok, json: json, text: json ? null : text.slice(0, 400) }
  }

  async function selfUrn() {
    var me = await api('/voyager/api/me')
    if (me.status !== 200) return { error: 'GET /voyager/api/me returned ' + me.status }
    var found = JSON.stringify(me.json || {}).match(/ACoAA[A-Za-z0-9_-]+/)
    if (!found) return { error: 'no profile id in /voyager/api/me response' }
    var mini = (me.json && me.json.miniProfile) || {}
    return {
      urn: 'urn:li:fsd_profile:' + found[0],
      name: [mini.firstName, mini.lastName].filter(Boolean).join(' ') || null,
      headline: mini.occupation || null,
      publicId: mini.publicIdentifier || null,
    }
  }

  function participantsOf(conversation) {
    return (conversation.conversationParticipants || []).map(function (p) {
      var member = (p.participantType && p.participantType.member) || {}
      var first = member.firstName && (member.firstName.text || member.firstName)
      var last = member.lastName && (member.lastName.text || member.lastName)
      return {
        urn: p.hostIdentityUrn || p.entityUrn || null,
        name: [first, last].filter(Boolean).join(' ') || null,
        headline: member.headline && (member.headline.text || member.headline) || null,
      }
    })
  }

  // Message sender resolution, thread responses only. In the INBOX response the
  // sender object carries urns but no name, and — verified by probe li-04 — it
  // reports the mailbox owner for every row regardless of who actually sent the
  // preview message. So the inbox deliberately reports no sender at all rather
  // than a confident wrong one; ask for the thread if you need to know.
  function senderOf(message, selfProfileUrn) {
    var sender = message.sender || {}
    var member = (sender.participantType && sender.participantType.member) || {}
    var first = member.firstName && (member.firstName.text || member.firstName)
    var last = member.lastName && (member.lastName.text || member.lastName)
    var name = [first, last].filter(Boolean).join(' ') || null
    var urn = sender.hostIdentityUrn || null
    return { name: name, urn: urn, fromMe: !!(urn && selfProfileUrn && urn === selfProfileUrn) }
  }

  function textOf(message) {
    return (message.body && typeof message.body.text === 'string') ? message.body.text : null
  }

  // LinkedIn wraps nearly every user-visible string as { text, textDirection },
  // and sometimes nests it twice ({ text: { text } }). Unwrapping in one place
  // avoids the class of bug that made every comment author come back null.
  function str(v) {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') return v
    if (typeof v.text === 'string') return v.text
    if (v.text && typeof v.text.text === 'string') return v.text.text
    return null
  }

  // A character class, not a backslash escape, on purpose. Inside a template
  // literal a lone backslash is swallowed, so a regex written with one
  // reaches the page with the escape stripped: it still compiles, still
  // runs, and silently matches nothing. That is exactly what happened —
  // every activityId came back null while the urn sat right beside it.
  // [0-9] cannot be corrupted this way.
  function activityIdOf(urn) {
    var m = /activity:([0-9]+)/.exec(String(urn || ''))
    return m ? m[1] : null
  }
`

/**
 * Every result is flattened before it crosses back to the main process.
 *
 * executeJavaScript structured-clones its return value, and one un-cloneable
 * value fails the WHOLE call with "An object could not be cloned" — which
 * during the WhatsApp work destroyed a diagnostic's own report. Exploratory
 * shapes are exactly where that bites, so it is handled centrally.
 */
const SAFE = `
  function safe(v, depth) {
    depth = depth || 0
    if (v === null || v === undefined) return null
    var t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') return v
    if (t === 'function') return '[function]'
    if (t === 'symbol' || t === 'bigint') return String(v)
    if (depth >= 8) return '[depth limit]'
    try {
      if (Array.isArray(v)) return v.map(function (x) { return safe(x, depth + 1) })
      var out = {}
      var keys = Object.keys(v)
      for (var i = 0; i < keys.length; i++) out[keys[i]] = safe(v[keys[i]], depth + 1)
      return out
    } catch (e) { return '[unreadable]' }
  }
`

/**
 * Wraps a body as an async IIFE that always resolves to an object.
 *
 * A rejected promise crossing executeJavaScript arrives as an Error whose
 * message has already lost the useful part, so failures are converted to
 * `{ ok: false, error }` here instead — the caller is usually an agent, and a
 * readable failure is something it can act on.
 */
export function buildScript(body: string): string {
  return `(async function () {
${SAFE}
${PRELUDE}
  try {
${body}
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

export function statusScript(): string {
  return buildScript(`
    if (location.hostname.indexOf('linkedin.com') === -1) {
      return { ok: false, error: 'the open view is not on linkedin.com (it is on ' + location.hostname + ')' }
    }
    var me = await selfUrn()
    if (me.error) return { ok: false, signedIn: false, error: me.error }
    var counts = await api(GQL + '?queryId=' + Q_COUNTS + '&variables=(mailboxUrn:' + enc(me.urn) + ')')
    return {
      ok: true,
      signedIn: true,
      name: me.name,
      headline: me.headline,
      publicId: me.publicId,
      mailboxUrn: me.urn,
      countsReachable: counts.status === 200,
    }
  `)
}

export function listChatsScript(options: { limit?: number; cursor?: string; onlyUnread?: boolean }): string {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50)
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    // Built up in steps so an absent cursor produces no key at all rather than
    // an empty one, which Rest.li rejects.
    var base = '(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:${limit}'
    var cursor = ${JSON.stringify(options.cursor ?? '')}
    if (cursor) base += ',nextCursor:' + enc(cursor)
    base += ',mailboxUrn:' + enc(me.urn) + ')'

    var res = await api(GQL + '?queryId=' + Q_CONVERSATIONS + '&variables=' + base)
    if (res.status !== 200) return { ok: false, error: 'conversation list returned ' + res.status, detail: res.text }

    var block = res.json && res.json.data && res.json.data.messengerConversationsByCategoryQuery
    if (!block) return { ok: false, error: 'unexpected response shape — no messengerConversationsByCategoryQuery' }

    var elements = block.elements || []
    var chats = elements.map(function (c) {
      var people = participantsOf(c)
      var others = people.filter(function (p) { return p.urn !== me.urn })
      var preview = (c.messages && c.messages.elements && c.messages.elements[0]) || null
      return {
        conversationUrn: c.entityUrn,
        title: c.title || others.map(function (p) { return p.name }).filter(Boolean).join(', ') || null,
        isGroup: !!c.groupChat,
        unreadCount: c.unreadCount || 0,
        read: !!c.read,
        lastActivityAt: c.lastActivityAt || null,
        participants: people,
        lastMessage: preview ? {
          text: textOf(preview),
          deliveredAt: preview.deliveredAt || null,
          // Intentionally absent: see senderOf(). The inbox response names the
          // mailbox owner as sender on every row, so any value here would be a
          // confident lie. Use list_messages on this conversation instead.
          sender: null,
          senderUnavailableReason: 'LinkedIn does not return a usable sender in the inbox response',
        } : null,
      }
    })

    var filtered = ${options.onlyUnread ? 'chats.filter(function (c) { return c.unreadCount > 0 })' : 'chats'}
    return {
      ok: true,
      count: filtered.length,
      totalReturned: chats.length,
      nextCursor: (block.metadata && block.metadata.nextCursor) || null,
      chats: safe(filtered),
    }
  `)
}

export function listMessagesScript(options: { conversationUrn: string; limit?: number; before?: number }): string {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var convUrn = ${JSON.stringify(options.conversationUrn)}
    if (!convUrn || convUrn.indexOf('urn:li:msg_conversation:') !== 0) {
      return { ok: false, error: 'conversationUrn must look like "urn:li:msg_conversation:(...)" — got: ' + convUrn }
    }

    // deliveredAt is the anchor to page backwards from; countBefore is how many
    // to take before it. Omitting these returns 400 — this exact call failed
    // that way during discovery before the required variables were known.
    var anchor = ${options.before !== undefined ? String(Math.floor(options.before)) : 'Date.now()'}
    var vars = '(deliveredAt:' + anchor + ',conversationUrn:' + enc(convUrn) + ',countBefore:${limit},countAfter:0)'

    var res = await api(GQL + '?queryId=' + Q_MESSAGES + '&variables=' + vars)
    if (res.status !== 200) return { ok: false, error: 'message list returned ' + res.status, detail: res.text }

    var data = res.json && res.json.data
    var key = data ? Object.keys(data).filter(function (k) { return k.indexOf('messengerMessages') === 0 })[0] : null
    if (!key) return { ok: false, error: 'unexpected response shape — no messengerMessages* key' }

    var elements = (data[key] && data[key].elements) || []
    var messages = elements.map(function (m) {
      var who = senderOf(m, me.urn)
      return {
        messageUrn: m.entityUrn || null,
        text: textOf(m),
        deliveredAt: m.deliveredAt || null,
        from: who.name,
        fromUrn: who.urn,
        fromMe: who.fromMe,
        hasAttachment: !!(m.renderContent && m.renderContent.length),
        attachmentSummary: (m.renderContent && m.renderContent.length) ? m.renderContentFallbackText || '[attachment]' : null,
      }
    })

    // Ascending by time reads the way a conversation does. LinkedIn's order is
    // not guaranteed, so it is imposed here rather than assumed.
    messages.sort(function (a, b) { return (a.deliveredAt || 0) - (b.deliveredAt || 0) })

    return {
      ok: true,
      conversationUrn: convUrn,
      count: messages.length,
      oldestDeliveredAt: messages.length ? messages[0].deliveredAt : null,
      hasMore: messages.length >= ${limit},
      messages: safe(messages),
    }
  `)
}

export function unreadScript(): string {
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }
    var res = await api(GQL + '?queryId=' + Q_COUNTS + '&variables=(mailboxUrn:' + enc(me.urn) + ')')
    if (res.status !== 200) return { ok: false, error: 'unread counts returned ' + res.status, detail: res.text }
    var block = res.json && res.json.data && res.json.data.messengerMailboxCountsByMailbox
    var elements = (block && block.elements) || []
    var total = 0
    var byCategory = elements.map(function (e) {
      var n = e.unreadCount || e.count || 0
      total += n
      return { category: e.category || e.mailboxCategory || e.entityUrn || 'unknown', unread: n }
    })
    return { ok: true, totalUnread: total, byCategory: safe(byCategory) }
  `)
}

/**
 * Finds a person among existing conversations, and returns the conversationUrn
 * needed to message them.
 *
 * It searches conversations rather than the connection list, which is a
 * deliberate correction rather than a shortcut. `voyagerRelationshipsDashConnections`
 * returns `connectedMember` as a bare urn with no name attached — verified by
 * probe li-06 under both Accept headers — so a connection-based search would
 * have to resolve every urn with its own request and would still return people
 * this bridge cannot message, since sending requires an existing conversation.
 * Conversation participants carry real names and come with the urn `send`
 * needs, so this answers the question the caller actually has.
 */
export function findPeopleScript(query: string, pages = 3): string {
  const pageCount = Math.min(Math.max(pages, 1), 10)
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var query = ${JSON.stringify(query ?? '')}.toLowerCase().trim()
    var people = []
    var seen = {}
    var cursor = ''
    var scanned = 0
    var pagesRead = 0

    for (var page = 0; page < ${pageCount}; page++) {
      var base = '(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20'
      if (cursor) base += ',nextCursor:' + enc(cursor)
      base += ',mailboxUrn:' + enc(me.urn) + ')'

      var res = await api(GQL + '?queryId=' + Q_CONVERSATIONS + '&variables=' + base)
      if (res.status !== 200) {
        // A later page failing should not discard the pages that succeeded —
        // partial results with an honest note beat an all-or-nothing error.
        if (page === 0) return { ok: false, error: 'conversation list returned ' + res.status, detail: res.text }
        break
      }

      var block = res.json && res.json.data && res.json.data.messengerConversationsByCategoryQuery
      var elements = (block && block.elements) || []
      pagesRead++
      scanned += elements.length

      for (var i = 0; i < elements.length; i++) {
        var conversation = elements[i]
        var participants = participantsOf(conversation)
        for (var j = 0; j < participants.length; j++) {
          var person = participants[j]
          if (!person.name || person.urn === me.urn) continue
          var key = person.urn || person.name
          if (seen[key]) continue
          var haystack = (person.name + ' ' + (person.headline || '')).toLowerCase()
          if (query && haystack.indexOf(query) === -1) continue
          seen[key] = true
          people.push({
            name: person.name,
            headline: person.headline,
            profileUrn: person.urn,
            // The reason this tool exists: this is what send() needs.
            conversationUrn: conversation.entityUrn,
            isGroup: !!conversation.groupChat,
            lastActivityAt: conversation.lastActivityAt || null,
          })
        }
      }

      cursor = (block && block.metadata && block.metadata.nextCursor) || ''
      if (!cursor) break
    }

    return {
      ok: true,
      query: query,
      count: people.length,
      conversationsScanned: scanned,
      moreConversationsExist: !!cursor,
      // Stated because it changes what an empty result means: this searches
      // people you already have a conversation with, not all of LinkedIn.
      note: 'searched participants of the ' + scanned + ' most recent conversations; people you have never messaged are not included',
      people: safe(people),
    }
  `)
}

/**
 * Send. Called only after the user has approved this exact recipient and text —
 * the approval happens in the tool layer, above this string.
 */
export function sendScript(conversationUrn: string, text: string): string {
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var convUrn = ${JSON.stringify(conversationUrn)}
    var text = ${JSON.stringify(text)}
    if (!convUrn || convUrn.indexOf('urn:li:msg_conversation:') !== 0) {
      return { ok: false, error: 'conversationUrn must look like "urn:li:msg_conversation:(...)" — got: ' + convUrn }
    }
    if (!text || !text.trim()) return { ok: false, error: 'refusing to send empty text' }

    // originToken is the client-generated id LinkedIn echoes back; it is also
    // the natural idempotency key if retries are ever added.
    var originToken = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
    var raw = new Uint8Array(16)
    crypto.getRandomValues(raw)
    var trackingId = String.fromCharCode.apply(null, Array.prototype.slice.call(raw))

    var payload = {
      message: {
        body: { attributes: [], text: text },
        renderContentUnions: [],
        conversationUrn: convUrn,
        originToken: originToken,
      },
      mailboxUrn: me.urn,
      trackingId: trackingId,
      dedupeByClientGeneratedToken: false,
    }

    var res = await api(SEND_URL, { method: 'POST', body: JSON.stringify(payload) })

    // The whole point of this block: success is what the SERVER says, not that
    // the promise resolved. During the WhatsApp work a resolved promise was
    // read as "sent" and reported messages that never left. A 200 with no
    // entityUrn is a failure here.
    var value = res.json && res.json.value
    if (res.status !== 200 || !value || !value.entityUrn) {
      return {
        ok: false,
        error: 'send was not confirmed by LinkedIn (HTTP ' + res.status + ')',
        detail: res.text || (res.json ? JSON.stringify(res.json).slice(0, 400) : null),
      }
    }

    return {
      ok: true,
      sent: true,
      messageUrn: value.entityUrn,
      conversationUrn: value.backendConversationUrn || convUrn,
      deliveredAt: value.deliveredAt || null,
      originToken: originToken,
      text: text,
    }
  `)
}

export function markReadScript(): string {
  return buildScript(`
    var until = Date.now()
    var res = await api(MARK_READ_URL, { method: 'POST', body: JSON.stringify({ until: until }) })
    if (res.status !== 200) return { ok: false, error: 'mark-read returned ' + res.status, detail: res.text }
    return { ok: true, markedReadUntil: until }
  `)
}

/**
 * Who can see a post.
 *
 * Only the two values the real client sends are offered. An invented third
 * would be rejected by the server at best, and at worst silently widen who sees
 * something the user meant to keep narrow.
 */
export type PostVisibility = 'anyone' | 'connections'

const VISIBILITY_TYPES: Record<PostVisibility, string> = {
  anyone: 'ANYONE',
  connections: 'CONNECTIONS_ONLY',
}

export interface CreatePostOptions {
  visibility?: PostVisibility
  asDraft?: boolean
  /** Epoch milliseconds to publish at. Turns the post into a scheduled post. */
  scheduledAt?: number | null
  /** A base64 PNG/JPEG to attach, with its alt text. Uploaded before the post. */
  image?: { base64: string; altText?: string } | null
}

export function createPostScript(text: string, options: CreatePostOptions = {}): string {
  const visibility = options.visibility ?? 'anyone'
  const visibilityType = VISIBILITY_TYPES[visibility]
  const asDraft = options.asDraft ?? false
  const scheduledAt = options.scheduledAt ?? null
  const image = options.image ?? null

  // Scheduling and drafting are mutually exclusive states of the same field.
  // A scheduled post is neither a draft nor immediately public — it is its own
  // lifecycle state, verified against the live API (scheduledAt is epoch ms).
  const lifeCycleState = scheduledAt ? 'SCHEDULED' : asDraft ? 'DRAFT' : 'PUBLISHED'

  return buildScript(`
    var asset = null
    ${image ? `
    // ── image upload, before the post references it ──
    var b64 = ${JSON.stringify(image.base64)}
    var bin = atob(b64)
    var bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    var reg = await api(MEDIA_UPLOAD_URL, {
      method: 'POST',
      body: JSON.stringify({ mediaUploadType: 'IMAGE_SHARING', fileSize: bytes.length, filename: 'flowdesk.png' }),
    })
    var regVal = (reg.json && reg.json.data && reg.json.data.value) || (reg.json && reg.json.value) || {}
    asset = regVal.urn
    var uploadUrl = regVal.singleUploadUrl
    if (!asset || !uploadUrl) {
      return { ok: false, error: 'the image upload could not be registered (HTTP ' + reg.status + ')',
        detail: reg.text || JSON.stringify(reg.json).slice(0, 300) }
    }

    // The DMS storage endpoint is not a voyager route — it takes the image
    // bytes with an image content type, not the csrf/restli headers. Verified:
    // a real PNG returns 201 here; a 2x2 image returns 400.
    var put = await fetch(uploadUrl, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'image/png' }, body: bytes })
    if (put.status < 200 || put.status >= 300) {
      return { ok: false, error: 'the image bytes were rejected by LinkedIn storage (HTTP ' + put.status + ')' }
    }

    // Poll until the image is processed, or the post will reference an asset
    // that is not ready. AVAILABLE is the state the feedshare recipe reports.
    if (regVal.pollingUrl) {
      var ready = false
      for (var p = 0; p < 8 && !ready; p++) {
        await new Promise(function (r) { setTimeout(r, 1200) })
        try {
          var ps = await fetch(regVal.pollingUrl, { credentials: 'include' })
          var pj = await ps.json()
          if (JSON.stringify(pj).indexOf('AVAILABLE') !== -1) ready = true
        } catch (e) {}
      }
      if (!ready) return { ok: false, error: 'the image did not finish processing in time', asset: asset }
    }
    ` : ''}

    var post = {
      allowedCommentersScope: 'ALL',
      intendedShareLifeCycleState: ${JSON.stringify(lifeCycleState)},
      origin: 'FEED',
      visibilityDataUnion: { visibilityType: ${JSON.stringify(visibilityType)} },
      commentary: { text: ${JSON.stringify(text)}, attributesV2: [] },
    }
    ${scheduledAt ? `post.scheduledAt = ${JSON.stringify(scheduledAt)}` : ''}
    if (asset) {
      // ShareMedia: mediaUrn is the asset, category is a NonNull enum.
      post.media = { mediaUrn: asset, category: 'IMAGE', altText: ${JSON.stringify(image ? (image.altText || '') : '')} }
    }

    var res = await api(CREATE_POST_URL, {
      method: 'POST',
      body: JSON.stringify({ variables: { post: post }, queryId: CREATE_POST_QUERY_ID, includeWebMetadata: true }),
      accept: 'application/vnd.linkedin.normalized+json+2.1',
    })

    // Success is what the server says, not that the request resolved. A 200
    // carrying no share urn is a failure — the same rule the send path learned
    // the hard way, where a resolved promise was read as "sent".
    var created = null
    try {
      created = res.json && res.json.data && res.json.data.data &&
        res.json.data.data.createContentcreationDashShares
    } catch (e) {}
    var entity = created && (created['*entity'] || created.resourceKey)

    if (res.status !== 200 || !entity) {
      var errMsg = null
      try { errMsg = res.json.data.errors[0].message } catch (e) {}
      return {
        ok: false,
        error: 'LinkedIn did not confirm the post (HTTP ' + res.status + ')',
        detail: errMsg || res.text || (res.json ? JSON.stringify(res.json).slice(0, 400) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the queryId in linkedinBridge.ts may have rotated — publish one post by hand with the CDP recorder running and read the new one off the wire'
          : undefined,
      }
    }

    var shareId = String(entity).match(/urn:li:share:([0-9]+)/)

    return {
      ok: true,
      posted: ${JSON.stringify(!asDraft && !scheduledAt)},
      draft: ${JSON.stringify(asDraft && !scheduledAt)},
      scheduled: ${JSON.stringify(!!scheduledAt)},
      scheduledAt: ${scheduledAt ? JSON.stringify(scheduledAt) : 'null'},
      withImage: ${JSON.stringify(!!image)},
      shareUrn: entity,
      permalink: shareId ? 'https://www.linkedin.com/feed/update/urn:li:share:' + shareId[1] + '/' : null,
      visibility: ${JSON.stringify(visibility)},
      text: ${JSON.stringify(text)},
    }
  `)
}

/**
 * Resolves an activity id to its share urn and deletes that share.
 *
 * Both halves are here rather than split, deliberately: the resolve is only
 * meaningful for the delete that immediately follows it, and separating them
 * would invite a caller to resolve once and delete later against a stale urn.
 */
export function deletePostScript(activityId: string): string {
  return buildScript(`
    var activityUrn = 'urn:li:activity:' + ${JSON.stringify(String(activityId))}

    // The accept header decides the SHAPE, not just the encoding. With plain
    // application/json — which is api()'s default — LinkedIn returns a form
    // with no \`included\` array at all, and the paired lookup below finds
    // nothing. That is exactly how this failed on its first live run: the guard
    // correctly refused to delete, and the post stayed up, because the data it
    // needed had been requested in the wrong representation.
    var update = await api(UPDATE_BY_ACTIVITY_URL + enc(activityUrn), {
      accept: 'application/vnd.linkedin.normalized+json+2.1',
    })
    if (update.status !== 200 || !update.json) {
      return {
        ok: false,
        error: 'could not read the post (HTTP ' + update.status + ')',
        hint: 'the activityId may be wrong, or the post may already be gone',
        activityUrn: activityUrn,
      }
    }

    // Paired lookup, not a search. A post that reshares someone else's content
    // carries their share urn in this same payload, and taking "the first share
    // urn" would delete THEIR post — an error with no undo. Only the shareUrn
    // sitting beside this activity's own urn is accepted.
    var shareUrn = null
    var included = update.json.included || []
    for (var i = 0; i < included.length; i++) {
      var meta = included[i] && included[i].updateMetadata
      if (meta && meta.urn === activityUrn && meta.shareUrn) { shareUrn = meta.shareUrn; break }
    }

    if (!shareUrn) {
      return {
        ok: false,
        error: 'the post was found but no share urn is paired with it, so there is nothing safe to delete',
        hint: 'reposts of other people\\'s content and some post types have no share of their own — delete those from LinkedIn directly',
        activityUrn: activityUrn,
      }
    }

    var res = await api(NORM_SHARES_URL + enc(shareUrn), { method: 'DELETE' })
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        error: 'LinkedIn refused the delete (HTTP ' + res.status + ')',
        detail: res.text || (res.json ? JSON.stringify(res.json).slice(0, 300) : null),
        hint: res.status === 403 ? 'this post does not belong to the signed-in account' : undefined,
        activityUrn: activityUrn,
        shareUrn: shareUrn,
      }
    }

    // A 2xx is the server accepting the request, not proof the post is gone.
    // Reading it back is. Verified behaviour: the share returns 400 afterwards.
    await new Promise(function (r) { setTimeout(r, 1200) })
    var check = await api(NORM_SHARES_URL + enc(shareUrn))
    var stillThere = check.status === 200

    return {
      ok: !stillThere,
      deleted: !stillThere,
      activityUrn: activityUrn,
      shareUrn: shareUrn,
      deleteStatus: res.status,
      error: stillThere
        ? 'LinkedIn accepted the delete but the post is still readable, so it may not have been removed'
        : undefined,
    }
  `)
}

/**
 * Deletes one comment, addressed by the post's activity id and the comment id.
 *
 * The two ids together reconstruct the comment urn
 * `urn:li:comment:(activity:<postId>,<commentId>)` that the delete route needs.
 * Before deleting, the comment is looked up in the thread and its `canDelete`
 * flag is checked — LinkedIn sets it false for comments that are not the
 * signed-in user's, so this refuses rather than firing a request that would be
 * rejected, and never risks touching a comment that is not the user's own.
 */
export function deleteCommentScript(activityId: string, commentId: string): string {
  return buildScript(`
    var activityId = String(${JSON.stringify(String(activityId))})
    var commentId = String(${JSON.stringify(String(commentId))})
    var commentUrn = 'urn:li:comment:(activity:' + activityId + ',' + commentId + ')'

    // Confirm the comment exists and is the user's own before deleting.
    var read = await api(COMMENTS_URL + '?count=50&q=comments&sortOrder=CHRON&updateId=' + enc('activity:' + activityId))
    var elements = (read.json && read.json.elements) || []
    var match = null
    for (var i = 0; i < elements.length; i++) {
      if (String(elements[i].urn) === commentUrn || String(elements[i].urn).indexOf(commentId) !== -1) { match = elements[i]; break }
    }
    if (!match) {
      return { ok: false, error: 'that comment was not found on the post — it may already be gone, or the id may be wrong',
        activityId: activityId, commentId: commentId }
    }
    if (match.canDelete !== true) {
      // LinkedIn's own signal that this is not the user's comment to remove.
      return { ok: false, error: 'this comment cannot be deleted by the signed-in account (it is not yours)',
        activityId: activityId, commentId: commentId }
    }

    var res = await api(COMMENTS_DELETE_URL + enc(commentUrn), { method: 'DELETE' })
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: 'LinkedIn refused the delete (HTTP ' + res.status + ')', detail: res.text }
    }

    // A 2xx is acceptance, not proof. Re-read and confirm it is gone.
    await new Promise(function (r) { setTimeout(r, 1200) })
    var after = await api(COMMENTS_URL + '?count=50&q=comments&sortOrder=CHRON&updateId=' + enc('activity:' + activityId))
    var still = false
    var af = (after.json && after.json.elements) || []
    for (var i = 0; i < af.length; i++) { if (String(af[i].urn) === commentUrn) still = true }

    return {
      ok: !still,
      deleted: !still,
      commentUrn: commentUrn,
      error: still ? 'LinkedIn accepted the delete but the comment is still present' : undefined,
    }
  `)
}

// ── Viral Hook & Outlier Engine ──────────────────────────────────────

export type HookPattern = 'Contrarian' | 'Story / Vulnerability' | 'Framework / List' | 'Observation / Question'

export interface OutlierOptions {
  minMultiplier?: number
  limit?: number
}

export function calculateMedian(numbers: number[]): number {
  if (!numbers || !numbers.length) return 0
  const sorted = numbers.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function extractHook(text: string): string {
  if (!text) return ''
  const clean = text.replace(/(\.\.\.|…)\s*see more.*$/is, '').trim()
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const hookLines = lines.slice(0, 3)
  let h = hookLines.join('\n').trim()
  if (h.length > 200) {
    h = h.slice(0, 197).trim() + '...'
  }
  return h
}

export function classifyHook(text: string): HookPattern {
  const s = (text || '').trim().toLowerCase()
  if (!s) return 'Observation / Question'

  if (
    /stop doing|unpopular opinion|\bdon'?t\b|\bwrong\b|\bmistake(s)?\b|\bmyth(s)?\b|\bnever\b|\blies?\b|nobody (talks about|wants to admit)|bad advice/i.test(s)
  ) {
    return 'Contrarian'
  }

  if (
    /years ago|months ago|i failed|i was fired|today i\b|when i was|when i started|i lost|i quit|my biggest failure|i was broke|\$0 in/i.test(s)
  ) {
    return 'Story / Vulnerability'
  }

  if (
    /\b\d+\s+(steps?|tools?|ways?|rules?|tips?|lessons?|habits?|principles?|secrets?|reasons?|frameworks?|books?|prompts?|ideas?)\b/i.test(s) ||
    /\b(framework|how to|playbook|cheat sheet|roadmap|guide to)\b/i.test(s)
  ) {
    return 'Framework / List'
  }

  return 'Observation / Question'
}

export function extractTakeaways(text: string): string[] {
  if (!text) return []
  const clean = text.replace(/(\.\.\.|…)\s*see more.*$/is, '').trim()
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const results: string[] = []
  const bulletRegex = /^([•\-*→✓✔]|\d+[\.)])\s+(.+)$/
  for (const line of lines) {
    const m = line.match(bulletRegex)
    if (m && m[2] && m[2].trim().length > 5) {
      results.push(m[2].trim())
    }
  }
  if (results.length > 0) return results.slice(0, 7)
  const candidate = lines.slice(3).filter(l => l.length >= 20 && !l.toLowerCase().includes('see more'))
  if (candidate.length > 0) return candidate.slice(0, 5)
  return lines.slice(0, 3)
}

export function linkedinApiFeedScript(limit = 20): string {
  const count = Math.min(Math.max(limit, 1), 100)
  return buildScript(`
    var limit = ${count}
    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var posts = []
    var seen = {}

    function addPost(p) {
      if (!p || (!p.activityId && !p.postUrn)) return
      var id = p.activityId || p.postUrn
      if (seen[id]) return
      seen[id] = true
      posts.push(p)
    }

    // 1. Try Voyager API feed endpoint
    try {
      var res = await api(FEED_URL + '?count=' + limit + '&q=feed&start=0')
      if (res.status === 200 && res.json && res.json.elements) {
        var elements = res.json.elements || []
        for (var i = 0; i < elements.length; i++) {
          var item = elements[i]
          var counts = (item.socialDetail && item.socialDetail.totalSocialActivityCounts) || {}
          var urn = (item.updateMetadata && item.updateMetadata.urn) || item.entityUrn || null
          var actId = activityIdOf(urn)
          var actor = item.actor || {}
          var mini = (actor.image && actor.image.attributes && actor.image.attributes[0]
            && actor.image.attributes[0].miniProfile) || {}
          var commentary = str(item.commentary)
          var postObj = {
            activityId: actId,
            postUrn: urn,
            url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null,
            author: str(actor.name),
            authorHeadline: str(actor.description),
            authorUrn: mini.dashEntityUrn || null,
            authorProfile: mini.publicIdentifier ? 'https://www.linkedin.com/in/' + mini.publicIdentifier : null,
            postedAgo: str(actor.subDescription),
            text: commentary,
            likes: counts.numLikes || counts.likesCount || 0,
            reactions: counts.numLikes || counts.totalReactionCount || 0,
            comments: counts.numComments || counts.commentsCount || 0,
            shares: counts.numShares || 0,
          }
          addPost(postObj)
          if (posts.length >= limit) break
        }
      }
    } catch (e) {}

    // 2. If needed, supplement or extract from DOM code[id*="bpr-guid"] blocks
    if (posts.length < limit) {
      try {
        var codeTags = document.querySelectorAll('code[id*="bpr-guid"]')
        for (var c = 0; c < codeTags.length; c++) {
          if (posts.length >= limit) break
          var content = codeTags[c].textContent || ''
          if (content.indexOf('com.linkedin.voyager') === -1 && content.indexOf('socialDetail') === -1) continue
          var parsed = null
          try { parsed = JSON.parse(content) } catch (e) { continue }
          var inc = (parsed && parsed.included) || (parsed && parsed.data && parsed.data.elements) || []
          if (!Array.isArray(inc)) continue
          for (var j = 0; j < inc.length; j++) {
            if (posts.length >= limit) break
            var it = inc[j]
            if (!it) continue
            var type = it.$type || ''
            var isUpdate = type.indexOf('Update') !== -1 || type.indexOf('Share') !== -1 || it.commentary
            if (isUpdate && (it.commentary || it.socialDetail || it.entityUrn)) {
              var urn = it.entityUrn || (it.updateMetadata && it.updateMetadata.urn) || null
              var actId = activityIdOf(urn)
              var text = str(it.commentary) || (it.commentary && it.commentary.text) || null
              var sCounts = (it.socialDetail && it.socialDetail.totalSocialActivityCounts) || {}
              var actor = it.actor || {}
              var p = {
                activityId: actId,
                postUrn: urn,
                url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null,
                author: str(actor.name) || null,
                authorHeadline: str(actor.description) || null,
                authorUrn: null,
                authorProfile: null,
                postedAgo: str(actor.subDescription) || null,
                text: text,
                likes: sCounts.numLikes || 0,
                reactions: sCounts.numLikes || sCounts.totalReactionCount || 0,
                comments: sCounts.numComments || 0,
                shares: sCounts.numShares || 0,
              }
              if (p.text || p.activityId) {
                addPost(p)
              }
            }
          }
        }
      } catch (e) {}
    }

    return {
      ok: true,
      count: posts.length,
      posts: safe(posts),
    }
  `)
}

export function linkedinOutlierScript(options: OutlierOptions = {}): string {
  const limit = Math.min(Math.max(options.limit ?? 25, 5), 100)
  const minMultiplier = options.minMultiplier && options.minMultiplier > 0 ? options.minMultiplier : 2.5

  return buildScript(`
    var limit = ${limit}
    var minMultiplier = ${minMultiplier}

    var me = await selfUrn()
    if (me.error) return { ok: false, error: me.error }

    var posts = []
    var seen = {}

    function addPost(p) {
      if (!p || (!p.activityId && !p.postUrn)) return
      var id = p.activityId || p.postUrn
      if (seen[id]) return
      seen[id] = true
      posts.push(p)
    }

    // 1. Fetch feed posts via Voyager API
    try {
      var res = await api(FEED_URL + '?count=' + limit + '&q=feed&start=0')
      if (res.status === 200 && res.json && res.json.elements) {
        var elements = res.json.elements || []
        for (var i = 0; i < elements.length; i++) {
          var item = elements[i]
          var counts = (item.socialDetail && item.socialDetail.totalSocialActivityCounts) || {}
          var urn = (item.updateMetadata && item.updateMetadata.urn) || item.entityUrn || null
          var actId = activityIdOf(urn)
          var actor = item.actor || {}
          var commentary = str(item.commentary)
          var postObj = {
            activityId: actId,
            postUrn: urn,
            url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null,
            author: str(actor.name),
            authorHeadline: str(actor.description),
            postedAgo: str(actor.subDescription),
            text: commentary,
            likes: counts.numLikes || counts.likesCount || 0,
            reactions: counts.numLikes || counts.totalReactionCount || 0,
            comments: counts.numComments || counts.commentsCount || 0,
            shares: counts.numShares || 0,
          }
          addPost(postObj)
          if (posts.length >= limit) break
        }
      }
    } catch (e) {}

    // 2. Fallback / supplementary extraction from DOM code tags
    if (posts.length < limit) {
      try {
        var codeTags = document.querySelectorAll('code[id*="bpr-guid"]')
        for (var c = 0; c < codeTags.length; c++) {
          if (posts.length >= limit) break
          var content = codeTags[c].textContent || ''
          if (content.indexOf('com.linkedin.voyager') === -1 && content.indexOf('socialDetail') === -1) continue
          var parsed = null
          try { parsed = JSON.parse(content) } catch (e) { continue }
          var inc = (parsed && parsed.included) || (parsed && parsed.data && parsed.data.elements) || []
          if (!Array.isArray(inc)) continue
          for (var j = 0; j < inc.length; j++) {
            if (posts.length >= limit) break
            var it = inc[j]
            if (!it) continue
            var type = it.$type || ''
            var isUpdate = type.indexOf('Update') !== -1 || type.indexOf('Share') !== -1 || it.commentary
            if (isUpdate && (it.commentary || it.socialDetail || it.entityUrn)) {
              var urn = it.entityUrn || (it.updateMetadata && it.updateMetadata.urn) || null
              var actId = activityIdOf(urn)
              var text = str(it.commentary) || (it.commentary && it.commentary.text) || null
              var sCounts = (it.socialDetail && it.socialDetail.totalSocialActivityCounts) || {}
              var actor = it.actor || {}
              var p = {
                activityId: actId,
                postUrn: urn,
                url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null,
                author: str(actor.name) || null,
                authorHeadline: str(actor.description) || null,
                postedAgo: str(actor.subDescription) || null,
                text: text,
                likes: sCounts.numLikes || 0,
                reactions: sCounts.numLikes || sCounts.totalReactionCount || 0,
                comments: sCounts.numComments || 0,
                shares: sCounts.numShares || 0,
              }
              if (p.text || p.activityId) {
                addPost(p)
              }
            }
          }
        }
      } catch (e) {}
    }

    if (!posts.length) {
      return {
        ok: true,
        postsAnalyzed: 0,
        medianReactions: 0,
        medianComments: 0,
        medianScore: 0,
        minMultiplier: minMultiplier,
        outliersCount: 0,
        outliers: [],
        note: 'no posts found in current feed'
      }
    }

    function calcMedian(arr) {
      if (!arr || !arr.length) return 0
      var s = arr.slice().sort(function (a, b) { return a - b })
      var mid = Math.floor(s.length / 2)
      return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
    }

    function extractHook(t) {
      if (!t) return ''
      var clean = t.replace(/(\\.\\.\\.|…)\\s*see more.*$/is, '').trim()
      var lines = clean.split(/\\r?\\n/).map(function (l) { return l.trim() }).filter(Boolean)
      var hookLines = lines.slice(0, 3)
      var h = hookLines.join('\\n').trim()
      if (h.length > 200) h = h.slice(0, 197).trim() + '...'
      return h
    }

    function classifyHook(t) {
      var s = (t || '').trim().toLowerCase()
      if (!s) return 'Observation / Question'
      if (/stop doing|unpopular opinion|\\bdon'?t\\b|\\bwrong\\b|\\bmistake(s)?\\b|\\bmyth(s)?\\b|\\bnever\\b|\\blies?\\b|nobody (talks about|wants to admit)|bad advice/i.test(s)) {
        return 'Contrarian'
      }
      if (/years ago|months ago|i failed|i was fired|today i\\b|when i was|when i started|i lost|i quit|my biggest failure|i was broke|\\$0 in/i.test(s)) {
        return 'Story / Vulnerability'
      }
      if (/\\b\\d+\\s+(steps?|tools?|ways?|rules?|tips?|lessons?|habits?|principles?|secrets?|reasons?|frameworks?|books?|prompts?|ideas?)\\b/i.test(s) ||
          /\\b(framework|how to|playbook|cheat sheet|roadmap|guide to)\\b/i.test(s)) {
        return 'Framework / List'
      }
      return 'Observation / Question'
    }

    function extractTakeaways(t) {
      if (!t) return []
      var lines = t.split(/\\r?\\n/).map(function (l) { return l.trim() }).filter(Boolean)
      var results = []
      var bulletRegex = /^([•\\-*→✓✔]|\\d+[\\.)])\\s+(.+)$/
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(bulletRegex)
        if (m && m[2] && m[2].trim().length > 5) {
          results.push(m[2].trim())
        }
      }
      if (results.length > 0) return results.slice(0, 7)
      var candidate = lines.slice(3).filter(function (l) { return l.length >= 20 && l.toLowerCase().indexOf('see more') === -1 })
      if (candidate.length > 0) return candidate.slice(0, 5)
      return lines.slice(0, 3)
    }

    var reactionsList = posts.map(function (p) { return p.reactions || p.likes || 0 })
    var commentsList = posts.map(function (p) { return p.comments || 0 })
    var scoresList = posts.map(function (p) {
      return (p.reactions || p.likes || 0) + (p.comments || 0) * 2
    })

    var medianReactions = calcMedian(reactionsList)
    var medianComments = calcMedian(commentsList)
    var medianScore = calcMedian(scoresList)
    var effectiveMedian = Math.max(1, medianScore)
    var threshold = minMultiplier * effectiveMedian

    var outliers = []
    for (var k = 0; k < posts.length; k++) {
      var post = posts[k]
      var r = post.reactions || post.likes || 0
      var c = post.comments || 0
      var score = r + c * 2
      if (score >= threshold) {
        var hook = extractHook(post.text)
        var pattern = classifyHook(hook || post.text)
        var takeaways = extractTakeaways(post.text)
        var mult = Math.round((score / effectiveMedian) * 100) / 100
        outliers.push({
          activityId: post.activityId,
          postUrn: post.postUrn,
          url: post.url,
          author: post.author,
          authorHeadline: post.authorHeadline,
          postedAgo: post.postedAgo,
          text: post.text,
          likes: post.likes,
          reactions: r,
          comments: c,
          shares: post.shares,
          score: score,
          multiplier: mult,
          hook: hook,
          hookPattern: pattern,
          takeaways: takeaways,
        })
      }
    }

    outliers.sort(function (a, b) { return b.score - a.score })

    return {
      ok: true,
      postsAnalyzed: posts.length,
      medianReactions: medianReactions,
      medianComments: medianComments,
      medianScore: medianScore,
      minMultiplier: minMultiplier,
      outliersCount: outliers.length,
      outliers: safe(outliers),
    }
  `)
}

