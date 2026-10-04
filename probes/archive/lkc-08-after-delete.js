// @target linkedin.com
return await (async function () {

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


  var GQL = "/voyager/api/voyagerMessagingGraphQL/graphql"
  var Q_CONVERSATIONS = "messengerConversations.9501074288a12f3ae9e3c7ea243bccbf"
  var Q_MESSAGES = "messengerMessages.d8ea76885a52fd5dc5c317078ab7c977"
  var Q_COUNTS = "messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b"
  var SEND_URL = "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage"
  var MARK_READ_URL = "/voyager/api/voyagerMessagingDashMessagingBadge?action=markAllMessagesAsSeen"
  var GRAPHQL = "/voyager/api/graphql?includeWebMetadata=true"
  var FEED_URL = "/voyager/api/feed/updatesV2"
  var COMMENTS_URL = "/voyager/api/feed/comments"
  var NOTIFICATIONS_URL = "/voyager/api/voyagerIdentityDashNotificationCards"
  var NOTIFICATIONS_DECORATION = "com.linkedin.voyager.dash.deco.identity.notifications.CardsCollection-80"
  var Q_SEARCH = "voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa"
  var Q_MY_POSTS = "voyagerFeedDashProfileUpdates.20c70fe0314184158516a7ec004c0408"
  var CREATE_POST_URL = "/voyager/api/graphql?action=execute&queryId=voyagerContentcreationDashShares.80089eb2e82a2dfa23cb621fb09eb7bf"
  var CREATE_POST_QUERY_ID = "voyagerContentcreationDashShares.80089eb2e82a2dfa23cb621fb09eb7bf"
  var UPDATE_BY_ACTIVITY_URL = "/voyager/api/feed/updates/"
  var NORM_SHARES_URL = "/voyager/api/contentcreation/normShares/"
  var MEDIA_UPLOAD_URL = "/voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload"
  var COMMENTS_DELETE_URL = "/voyager/api/feed/comments/"

  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  // Rest.li keeps its own parens literal but escapes them inside values, and
  // encodeURIComponent deliberately does not touch parens. A conversation urn
  // contains a parenthesised pair, so the default encoding returns 400 — a
  // failure already hit once during discovery.
  function enc(v) {
    return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29')
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

  try {

    var activityId = String("7497263203417169921")
    if (!/^[0-9]+$/.test(activityId)) {
      return { ok: false, error: 'activityId must be the numeric id from linkedin_feed (e.g. "7496811041339740160") — got: ' + activityId }
    }

    var res = await api(COMMENTS_URL + '?count=20&q=comments&sortOrder=RELEVANCE&updateId=' + enc('activity:' + activityId))
    if (res.status !== 200) return { ok: false, error: 'comments returned ' + res.status, detail: res.text }

    var elements = (res.json && res.json.elements) || []
    var comments = elements.map(function (c) {
      var who = c.commenterForDashConversion || {}
      var counts = (c.socialDetail && c.socialDetail.totalSocialActivityCounts) || {}
      var text = (c.comment && c.comment.values && c.comment.values[0] && c.comment.values[0].value)
        || (c.commentV2 && (c.commentV2.text || str(c.commentV2)))
        || null
      // urn:li:comment:(activity:<post>,<comment>) — the comment's own number
      // is what liDeleteComment needs, and without it no tool could remove
      // a comment it had just written.
      var urn = c.urn || c.entityUrn || c.dashEntityUrn || ''
      var nums = String(urn).match(/[0-9]{12,}/g) || []
      var commentId = nums.filter(function (n) { return n !== activityId }).pop() || null
      return {
        commentId: commentId,
        commentUrn: urn || null,
        author: str(who.title),
        // supplementaryActorInfoV2 holds the connection degree ("1st", "2nd"),
        // not a headline. Naming it authorHeadline made the field lie about
        // its own contents, which is worse than not having it.
        connectionDegree: (str(who.supplementaryActorInfoV2) || '').replace(/[^0-9a-zA-Z+]/g, '') || null,
        authorProfile: who.navigationUrl || null,
        authorUrn: (who.actorUnion && who.actorUnion.profileUrn) || null,
        text: text,
        createdAt: c.createdTime || null,
        likes: counts.numLikes || 0,
        edited: !!c.edited,
        pinned: !!c.pinned,
      }
    })

    return {
      ok: true,
      activityId: activityId,
      count: comments.length,
      // Separates "this post has no comments" from "the call did not work".
      // The first run of this route returned 200 with an empty list purely
      // because the post chosen had none — which reads identically to failure,
      // and was briefly mistaken for it.
      note: comments.length ? null : 'the call succeeded and this post has no comments',
      comments: safe(comments),
    }
  
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()