/**
 * WhatsApp Web bridge — the real thing, built entirely on what three
 * discovery passes actually observed on a live session rather than on any
 * documented or third-party-library-assumed shape.
 *
 * What discovery settled, in order:
 *
 *  1. The wire is a dead end. Every content frame on
 *     wss://web.whatsapp.com:5222/ws/chat arrived as an encrypted
 *     arraybuffer — payloads up to 482KB, not one string frame in the whole
 *     run — so the fetch/XHR/WS tee that every other provider in this
 *     codebase uses cannot work here at any size.
 *
 *  2. The page's own module registry is open. `require('WAWebCollections')`
 *     returns the live, already-decrypted store synchronously (Chat, Msg,
 *     Contact, GroupMetadata + ~40 more). No moduleRaid, no webpack chunk
 *     injection, and no third-party injection library is needed to reach it
 *     — which also means nothing here breaks when one of those libraries
 *     falls behind a WhatsApp release.
 *
 *  3. Sending has a real API. `WAWebSendTextMsgChatAction.sendTextMsgToChat`
 *     was found by probing the live page, not guessed from a README. That
 *     retires the entire CDP composer-typing path (see injector.ts) for
 *     WhatsApp: no selector, no send-button scan, no "typed text did not
 *     land" failure mode — just a function call.
 *
 * Kept deliberately observational where discovery did NOT settle something:
 * `isNewMsg` is reported but not trusted as the live/history discriminator
 * (it was never verified), so the actual gate is a timestamp window, and
 * both values are forwarded so the cheaper gate can replace the coarser one
 * once real traffic shows which is reliable.
 */
export const WHATSAPP_BRIDGE_SRC = `
(function () {
  if (window.__fdWa) return true
  window.__fdWa = true

  var STARTED_AT = Math.floor(Date.now() / 1000)
  var suppressed = 0

  function post(payload) {
    try { window.postMessage({ __flowdeskWhatsApp: payload }, '*') } catch (e) {}
  }

  function store() { return window.require('WAWebCollections') }

  /**
   * Resolve a chat id to a human name. Raw ids on this build are @lid — an
   * opaque per-account identifier that carries no phone number and no name,
   * so a message logged as "243378767790137@lid" is unreadable on its own.
   * Contact is checked before Chat because it holds the saved address-book
   * name, which is what the user actually recognises; notifyName (the
   * sender's own chosen push name) is the last resort for someone not saved.
   */
  function nameFor(chatId, notifyName) {
    if (!chatId) return null
    try {
      var S = store()
      var c = S.Contact.get(chatId)
      if (c && (c.name || c.pushname || c.formattedName)) return String(c.name || c.pushname || c.formattedName)
      var ch = S.Chat.get(chatId)
      if (ch && (ch.name || ch.formattedTitle)) return String(ch.name || ch.formattedTitle)
    } catch (e) {}
    return notifyName ? String(notifyName) : null
  }

  function serialize(m) {
    var out = {}
    try {
      out.type = m.type
      out.fromMe = !!(m.id && m.id.fromMe)
      out.chatId = m.id && m.id.remote ? String(m.id.remote) : null
      out.msgId = m.id && m.id.id ? String(m.id.id) : null
      out.t = m.t || null
      out.isNewMsg = m.isNewMsg === undefined ? null : !!m.isNewMsg
      out.notifyName = m.notifyName || null
      out.name = nameFor(out.chatId, out.notifyName)
      out.isGroup = !!(out.chatId && out.chatId.indexOf('@g.us') !== -1)
      out.senderId = m.author ? String(m.author) : null
      out.sender = nameFor(out.senderId, out.notifyName)
      out.isStatus = out.chatId === 'status@broadcast'
      // Only type 'chat' carries readable text. Media types put a base64
      // thumbnail in .body — confirmed on a real capture, where an image
      // message's body was a 51KB JPEG in base64. Forwarding that as if it
      // were message text would be both useless and enormous.
      out.body = (m.type === 'chat' && typeof m.body === 'string') ? m.body : null
      out.caption = typeof m.caption === 'string' ? m.caption : null
    } catch (e) { out.error = String(e && e.message) }
    return out
  }

  function isLive(s) {
    // History sync replays 'add' for hundreds of old messages on every load
    // (375 were already resident 15s in), so an ungated hook would flood the
    // pipeline with the user's entire recent history on every app start.
    // A timestamp window is used rather than isNewMsg because isNewMsg was
    // never verified to be set on live arrivals — this gate can be reasoned
    // about without trusting a field whose semantics are still unknown.
    if (typeof s.t === 'number') return s.t >= STARTED_AT - 60
    return s.isNewMsg === true
  }

  var hooked = false
  var announced = false
  var lastChatCount = -1

  // Hooking and announcing are deliberately separate. The Msg hook must go on
  // as early as possible so no live message is missed, but 'ready' must NOT
  // fire until the collections actually hold data: they exist from the moment
  // the module loads and read 0/0 for the first ~15s while history sync runs.
  // Announcing on mere existence is exactly what made a name lookup search an
  // empty Chat collection and report a contact that does exist as missing.
  function tryHook() {
    var S
    try { S = store() } catch (e) { return false }
    if (!S || !S.Msg) return false
    if (hooked) return true
    hooked = true

    S.Msg.on('add', function (m) {
      var s = serialize(m)
      if (!isLive(s)) {
        suppressed++
        return
      }
      post({ kind: 'message', msg: s })
    })
    setTimeout(function () { post({ kind: 'stats', suppressedHistory: suppressed }) }, 30000)
    return true
  }

  function tryAnnounce() {
    if (announced) return true
    var S
    try { S = store() } catch (e) { return false }
    if (!S || !S.Chat || !S.Chat.length) return false
    // Not just "> 0": history sync fills the collection progressively, and a
    // run that announced at the first non-zero reading fired at 11 chats when
    // the account really has 189 — a name lookup on that event searched 6% of
    // the data. Wait for the count to stop moving between polls instead.
    var n = S.Chat.length
    if (n !== lastChatCount) { lastChatCount = n; return false }
    announced = true
    post({ kind: 'ready', chats: n, contacts: S.Contact && S.Contact.length })
    return true
  }

  // ── Phase 1 read tools ──────────────────────────────────────────────
  //
  // Every accessor below is tried rather than assumed, and what worked is
  // reported back in a _via field. Discovery has already caught three wrong
  // assumptions on this target (webpack was supposedly gone, WA-JS was
  // supposedly required, chats were supposedly keyed by @c.us), so these
  // report their own footing instead of failing silently when WhatsApp moves
  // something.

  /**
   * Make any value safe to hand back across the page boundary.
   *
   * executeJavaScript structured-clones the resolved value, and anything it
   * cannot clone — a function, a Blob, a DOM node — fails the WHOLE call with
   * "An object could not be cloned". That is worse than a plain failure: a
   * diagnostic built to explain why something broke reported isDownloadable,
   * which is a method rather than a value, and so destroyed the very report
   * that was supposed to explain the problem. Nothing was learned from that
   * run at all.
   *
   * Everything is therefore flattened to primitives before it leaves. A
   * function becomes "[function]" — which is itself the answer when the
   * question was "is this a value or a method?".
   */
  function safe(v, depth) {
    depth = depth || 0
    if (v === null || v === undefined) return null
    var t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') return v
    if (t === 'function') return '[function]'
    if (t === 'symbol' || t === 'bigint') return String(v)
    if (depth >= 3) return '[' + t + ']'
    try {
      if (Array.isArray(v)) {
        return v.slice(0, 50).map(function (x) { return safe(x, depth + 1) })
      }
      if (typeof Blob !== 'undefined' && v instanceof Blob) return '[Blob ' + v.size + 'b]'
      var out = {}
      var keys = Object.keys(v).slice(0, 40)
      for (var i = 0; i < keys.length; i++) {
        try { out[keys[i]] = safe(v[keys[i]], depth + 1) } catch (e) { out[keys[i]] = '[unreadable]' }
      }
      return out
    } catch (e) { return '[' + t + ']' }
  }

  function modelsOf(coll) {
    if (!coll) return []
    try {
      if (typeof coll.getModelsArray === 'function') return coll.getModelsArray() || []
    } catch (e) {}
    return coll.models || []
  }

  function accessorOf(coll) {
    if (!coll) return 'none'
    if (typeof coll.getModelsArray === 'function') return 'getModelsArray'
    if (coll.models) return 'models'
    return 'none'
  }

  function serializeMsg(m, bodyLimit) {
    var body = typeof m.body === 'string' ? m.body : ''
    // Who sent it. notifyName alone was empty on every message in a real run,
    // and in a group it is the one field that matters — 'author' carries the
    // participant's own id there, while 'from' is the chat itself. Resolve
    // that id to a saved name so a group message reads as a person, not a
    // number.
    var senderId = m.author ? String(m.author) : (m.from ? String(m.from) : null)
    return {
      msgId: m.id && m.id.id ? String(m.id.id) : null,
      type: m.type,
      fromMe: !!(m.id && m.id.fromMe),
      t: m.t || null,
      senderId: senderId,
      // Own messages are labelled outright rather than resolved. The author
      // id on a fromMe message is the user's own account, and looking that up
      // returns whatever name the user saved their OWN number under — a real
      // and correct contact name (saving your own number to message yourself
      // is common), but a useless one here: every outgoing message in every
      // chat then reads as though that contact had sent it. WhatsApp's own UI
      // hits the same thing and answers it the same way, by marking that
      // contact "(You)".
      sender: (m.id && m.id.fromMe) ? 'You' : nameFor(senderId, m.notifyName),
      // Media bodies hold a base64 thumbnail, not text — label them instead of
      // returning kilobytes of base64 that mean nothing to a caller.
      body: m.type === 'chat' ? body.slice(0, bodyLimit || 400) : null,
      caption: typeof m.caption === 'string' ? m.caption.slice(0, 200) : null,
      mediaBytes: m.type === 'chat' ? null : body.length
    }
  }

  function serializeChat(c) {
    var out = {}
    try {
      out.id = String(c.id)
      out.name = nameFor(out.id, null) || c.formattedTitle || c.name || null
      // From the id, not c.isGroup: that property does not exist on this
      // build, so trusting it reported every @g.us group as a 1:1 chat.
      out.isGroup = out.id.indexOf('@g.us') !== -1
      out.unread = typeof c.unreadCount === 'number' ? c.unreadCount : null
      out.t = c.t || null
      out.pinned = !!c.pin
      out.archived = !!c.archive
      out.muted = !!(c.mute && c.mute.isMuted)
      var msgs = modelsOf(c.msgs)
      var last = msgs.length ? msgs[msgs.length - 1] : null
      out.last = last ? serializeMsg(last, 120) : null
    } catch (e) { out.error = String(e && e.message) }
    return out
  }

  window.__fdWaStatus = function () {
    try {
      var S = store()
      var chats = modelsOf(S.Chat)
      var sample = chats.length ? chats[0] : null
      return {
        ok: true,
        ready: announced,
        hooked: hooked,
        chats: S.Chat ? S.Chat.length : 0,
        contacts: S.Contact ? S.Contact.length : 0,
        messagesLoaded: S.Msg ? S.Msg.length : 0,
        suppressedHistory: suppressed,
        _via: {
          chatAccessor: accessorOf(S.Chat),
          msgAccessor: accessorOf(S.Msg),
          // Which properties a chat really carries, so a null unread/last
          // above can be diagnosed without another round trip.
          chatKeys: sample ? Object.keys(sample).filter(function (k) {
            return /unread|^t$|pin|archive|mute|group|name|title|msgs/i.test(k)
          }).slice(0, 30) : null,
          chatMsgsAccessor: sample ? accessorOf(sample.msgs) : null
        }
      }
    } catch (e) { return { ok: false, error: String(e && e.message) } }
  }

  window.__fdWaListChats = function (opts) {
    try {
      var o = opts || {}
      var limit = o.limit || 30
      var S = store()
      var list = modelsOf(S.Chat).map(serializeChat)
      if (o.onlyUnread) list = list.filter(function (c) { return (c.unread || 0) > 0 })
      // Most recent first: a caller asking for "the last 20 chats" means the
      // 20 most recently active, and the collection's own order is not
      // guaranteed to be that.
      list.sort(function (a, b) { return (b.t || 0) - (a.t || 0) })
      return { ok: true, count: list.length, chats: list.slice(0, limit), _via: accessorOf(S.Chat) }
    } catch (e) { return { ok: false, error: String(e && e.message) } }
  }

  window.__fdWaListMessages = function (chatId, limit) {
    return new Promise(function (rawResolve) {
      var resolve = function (v) { rawResolve(safe(v)) }
      var S, chat
      try { S = store() } catch (e) { resolve({ ok: false, error: String(e && e.message) }); return }
      try { chat = S.Chat.get(chatId) } catch (e) {}
      if (!chat) { resolve({ ok: false, error: 'chat not found: ' + chatId }); return }

      var want = limit || 20
      var loadedVia = []

      // WhatsApp keeps only the open chat's messages in memory: a real call
      // against a chat with plenty of history returned exactly one message.
      // WAWebChatLoadMessages is the module that pages the rest in — found by
      // listing the registry, not by guessing at a name.
      var Loader = null
      try { Loader = window.require('WAWebChatLoadMessages') } catch (e) {}

      function finish(note) {
        var msgs = modelsOf(chat.msgs)
        var slice = msgs.slice(Math.max(msgs.length - want, 0))
        resolve({
          ok: true,
          chatId: String(chatId),
          name: nameFor(String(chatId), null),
          isGroup: String(chatId).indexOf('@g.us') !== -1,
          loaded: msgs.length,
          returned: slice.length,
          hasMore: chat.noEarlierMsgs === false,
          messages: slice.map(function (m) { return serializeMsg(m, 400) }),
          _via: {
            accessor: accessorOf(chat.msgs),
            loaded: loadedVia,
            note: note || null,
            // Arities, so a loader that keeps failing can be called correctly
            // next time instead of being guessed at again.
            loaderArity: Loader ? {
              loadRecentMsgs: typeof Loader.loadRecentMsgs === 'function' ? Loader.loadRecentMsgs.length : null,
              loadEarlierMsgs: typeof Loader.loadEarlierMsgs === 'function' ? Loader.loadEarlierMsgs.length : null
            } : null
          }
        })
      }

      // Two loaders, tried in order, and a failure of one must not end the
      // whole attempt. A real run had loadRecentMsgs fail with "reading
      // 'msgs'" and the old code called finish() right there — so
      // loadEarlierMsgs, which may well have worked, was never reached, and
      // the call reported the handful of messages that happened to be
      // resident as if that were the whole chat.
      var recentTried = false

      function pickLoader() {
        if (!recentTried && typeof Loader.loadRecentMsgs === 'function') {
          recentTried = true
          return 'loadRecentMsgs'
        }
        return typeof Loader.loadEarlierMsgs === 'function' ? 'loadEarlierMsgs' : null
      }

      function step(attempt) {
        var have = modelsOf(chat.msgs).length
        // Bounded on purpose: each pass is a network round trip, and a caller
        // asking for 20 messages should not be able to walk years of history.
        if (have >= want || !Loader || attempt >= 6 || chat.noEarlierMsgs === true) {
          finish(null)
          return
        }
        var fn = pickLoader()
        if (!fn) { finish('no usable loader on WAWebChatLoadMessages'); return }

        var before = have
        function onFailure(err) {
          loadedVia.push(fn + ' failed: ' + String((err && err.message) || err))
          // Fall through to the next loader rather than giving up — unless
          // that was already the last one available.
          if (fn === 'loadRecentMsgs' && typeof Loader.loadEarlierMsgs === 'function') {
            step(attempt + 1)
          } else {
            finish(fn + ' failed')
          }
        }

        var call
        try { call = Loader[fn](chat) } catch (e) { onFailure(e); return }

        Promise.resolve(call).then(function () {
          loadedVia.push(fn)
          // Stop when a pass brings nothing new, rather than spending the
          // whole attempt budget on a chat that has no more to give.
          if (modelsOf(chat.msgs).length === before) {
            if (fn === 'loadRecentMsgs' && typeof Loader.loadEarlierMsgs === 'function') {
              step(attempt + 1)
            } else {
              finish('no further messages from ' + fn)
            }
            return
          }
          step(attempt + 1)
        }, onFailure)
      }

      step(0)
    })
  }

  /**
   * Chat lookup, for turning a human name into the @lid/@g.us id that the
   * send call needs. Chat ids on this build are @lid (WhatsApp's newer
   * per-account identifier), not the @c.us seen in older writeups.
   */
  window.__fdWaChats = function (query) {
    try {
      var S = store()
      var q = String(query || '').toLowerCase()
      var out = []
      var models = S.Chat.getModelsArray ? S.Chat.getModelsArray() : (S.Chat.models || [])
      for (var i = 0; i < models.length; i++) {
        var c = models[i]
        var name = c.name || c.formattedTitle || (c.contact && c.contact.name) || ''
        if (q && String(name).toLowerCase().indexOf(q) === -1) continue
        out.push({ id: String(c.id), name: String(name), isGroup: !!c.isGroup })
        if (out.length >= 25) break
      }
      // Fall back to Contacts when no chat matches: a contact only appears in
      // the Chat collection once a conversation exists, so a name-only lookup
      // against chats alone reports plenty of real, messageable people as
      // missing (this account has 189 chats against 8364 contacts).
      var contacts = []
      if (!out.length && q) {
        var cm = S.Contact.getModelsArray ? S.Contact.getModelsArray() : (S.Contact.models || [])
        for (var j = 0; j < cm.length; j++) {
          var ct = cm[j]
          var cname = ct.name || ct.pushname || ct.formattedName || ''
          if (String(cname).toLowerCase().indexOf(q) === -1) continue
          // Report whatever phone linkage the model carries, and its own
          // property names alongside. Chats on this build are keyed by @lid,
          // an opaque id that shows no number — so picking a send target by
          // @lid alone means picking a recipient the user cannot verify.
          // Which field holds the number is not assumed: the key list comes
          // back too, so the right one can be read rather than guessed.
          var phone = null
          try {
            phone = ct.phoneNumber || ct.userid ||
              (ct.id && ct.id.user) ||
              (typeof ct.getPhoneNumber === 'function' ? String(ct.getPhoneNumber()) : null)
          } catch (e) {}
          contacts.push({
            id: String(ct.id),
            name: String(cname),
            source: 'contact',
            phone: phone ? String(phone) : null,
            keys: Object.keys(ct).filter(function (k) {
              return /phone|pn|lid|user|number|wid|jid/i.test(k)
            }).slice(0, 25)
          })
          if (contacts.length >= 25) break
        }
      }
      return { ok: true, chats: out, contacts: contacts }
    } catch (e) { return { ok: false, error: String(e && e.message) } }
  }

  /**
   * Diagnostic for the chat-resolution gap. Not used in normal operation.
   *
   * A real send to a contact with no existing chat failed with
   * "this.findImpl is not a function": ChatCollection.find() exists but
   * delegates to a findImpl that WhatsApp only wires up lazily. Rather than
   * guessing which module installs it, report what is actually present — the
   * same probe-don't-guess approach that found the send action itself.
   */
  window.__fdWaDiag = function () {
    var out = {}
    try {
      var S = store()
      out.chat = {
        length: S.Chat.length,
        find: typeof S.Chat.find,
        findImpl: typeof S.Chat.findImpl,
        get: typeof S.Chat.get,
        add: typeof S.Chat.add,
        proto: Object.getPrototypeOf(S.Chat) ? Object.getOwnPropertyNames(Object.getPrototypeOf(S.Chat)).slice(0, 40) : null
      }
      // Chats on this build are keyed by @lid, so check both spellings of the
      // same person: a @c.us id that resolves to nothing may well have a live
      // chat sitting under its @lid counterpart.
      out.probeGet = {
        cus: !!S.Chat.get('923176575459@c.us'),
        lid: !!S.Chat.get('65339874390087@lid')
      }
    } catch (e) { out.chatError = String(e && e.message) }

    try {
      var CC = window.require('WAWebChatCollection')
      out.chatCollectionModule = Object.keys(CC)
      if (CC.ChatCollectionImpl) {
        out.implKeys = Object.getOwnPropertyNames(CC.ChatCollectionImpl).slice(0, 40)
        var proto = CC.ChatCollectionImpl.prototype
        out.implProto = proto ? Object.getOwnPropertyNames(proto).slice(0, 40) : null
      }
    } catch (e) { out.implError = String(e && e.message) }

    // How to pull in messages that are not resident. A real list_messages
    // call returned 1 message for a chat that plainly has many, because
    // WhatsApp only keeps the open chat's messages in memory. The chat model
    // carries __x_noEarlierMsgs, which implies a paging call exists — find
    // its real name rather than guessing at one.
    try {
      var S2 = store()
      var anyChat = modelsOf(S2.Chat)[0]
      if (anyChat) {
        out.chatMsgLoaders = Object.getOwnPropertyNames(Object.getPrototypeOf(anyChat) || {})
          .filter(function (k) { return /load|earlier|fetch|page|more|msgs/i.test(k) }).slice(0, 40)
        out.chatMsgsProtoLoaders = anyChat.msgs
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(anyChat.msgs) || {})
              .filter(function (k) { return /load|earlier|fetch|page|more/i.test(k) }).slice(0, 40)
          : null
        out.chatMsgsLength = anyChat.msgs ? modelsOf(anyChat.msgs).length : null
        out.noEarlierMsgs = anyChat.noEarlierMsgs
      }
    } catch (e) { out.msgLoaderError = String(e && e.message) }

    var candidates = [
      'WAWebChatLoadMessages', 'WAWebLoadEarlierMsgsAction', 'WAWebFetchMessagesAction',
      'WAWebLoadEarlierChatMsgsAction', 'WAWebMsgLoadAction', 'WAWebChatLoadEarlierMsgs',
      'WAWebFindChatAction', 'WAWebChatCreate', 'WAWebOpenChatAction', 'WAWebCmd',
      'WAWebFindOrCreateLatestChatAction', 'WAWebCreateChatAction',
      'WAWebWidFactory', 'WAWebApiContact', 'WAWebChatGetters'
    ]
    out.modules = {}
    for (var i = 0; i < candidates.length; i++) {
      try {
        var m = window.require(candidates[i])
        if (m) out.modules[candidates[i]] = Object.keys(m).slice(0, 15)
      } catch (e) {}
    }
    return safe(out)
  }

  /** Locate one message by its short id within a chat. */
  function findMsg(chatId, msgId) {
    var S = store()
    var chat = S.Chat.get(chatId)
    if (!chat) return null
    var msgs = modelsOf(chat.msgs)
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].id && String(msgs[i].id.id) === String(msgId)) return msgs[i]
    }
    return null
  }

  /** Chunked so a multi-megabyte buffer does not blow the argument limit. */
  function bytesToBase64(bytes) {
    var binary = ""
    var CHUNK = 0x8000
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  }

  /**
   * Download one media message (voice note, image, video, document).
   *
   * Goes through WhatsApp's DownloadManager rather than the message's own
   * mediaData, because a real run settled that question: with mediaStage
   * reporting "RESOLVED", mediaBlob was still null, renderableUrl was absent,
   * and downloadMedia() itself returned undefined. There was nothing to read
   * on that path at all — WhatsApp resolves the metadata without ever
   * materialising a blob unless its own UI asks for one.
   *
   * The arguments below are not borrowed from elsewhere: every field was seen
   * on a real ptt message in an earlier probe (__x_directPath, __x_mediaKey,
   * __x_encFilehash, __x_filehash, __x_mediaKeyTimestamp). downloadQpl is the
   * exception and is openly a shim — the manager annotates a performance
   * logging object it expects to be handed, and a no-op satisfies that
   * without pretending to know what real telemetry would contain.
   *
   * The old mediaData path is kept as a fallback rather than deleted: it is
   * the route that works once WhatsApp's own UI has already played the media,
   * and it costs nothing on the runs where it does not.
   */
  window.__fdWaDownloadMedia = function (chatId, msgId) {
    return new Promise(function (rawResolve) {
      // Everything leaving this function goes through safe(): the result is
      // structured-cloned across the page boundary, and one un-cloneable
      // value fails the entire call with "An object could not be cloned" —
      // which is how a diagnostic built to explain a failure once destroyed
      // its own report and taught us nothing.
      var resolve = function (v) { rawResolve(safe(v)) }

      var m
      try { m = findMsg(chatId, msgId) } catch (e) { resolve({ ok: false, error: String(e && e.message) }); return }
      if (!m) { resolve({ ok: false, error: 'message not found: ' + msgId + ' in ' + chatId }); return }
      if (m.type === 'chat') { resolve({ ok: false, error: 'message has no media (type=chat)' }); return }

      var attempts = []

      function meta(extra) {
        var md = m.mediaData
        var base = {
          msgId: String(msgId),
          type: m.type,
          mimetype: m.mimetype || (md && md.mimetype) || null,
          filename: m.filename || null,
          duration: m.duration || null
        }
        for (var k in extra) base[k] = extra[k]
        return base
      }

      function deliverBytes(bytes, via) {
        try {
          resolve(meta({ ok: true, via: via, bytes: bytes.length, base64: bytesToBase64(bytes) }))
        } catch (e) {
          resolve({ ok: false, error: 'base64 encode failed: ' + String(e && e.message), attempts: attempts })
        }
      }

      function deliverBlob(blob, via) {
        var reader = new FileReader()
        reader.onload = function () {
          var res = String(reader.result || '')
          var comma = res.indexOf(',')
          resolve(meta({
            ok: true, via: via, bytes: blob.size,
            base64: comma >= 0 ? res.slice(comma + 1) : res
          }))
        }
        reader.onerror = function () { resolve({ ok: false, error: 'FileReader failed', via: via, attempts: attempts }) }
        reader.readAsDataURL(blob)
      }

      function shapeOf(v) {
        try {
          var name = (v && v.constructor && v.constructor.name) ? v.constructor.name : typeof v
          var keys = (v && typeof v === 'object') ? Object.keys(v).slice(0, 15).join('|') : ''
          return name + ' keys=' + keys
        } catch (e) { return typeof v }
      }

      /** Whatever the manager hands back, turn it into bytes. */
      function normalise(out, via) {
        if (!out) { attempts.push(via + ' returned nothing'); fallbackToMediaData(); return }
        if (out instanceof ArrayBuffer) { deliverBytes(new Uint8Array(out), via); return }
        if (typeof Uint8Array !== 'undefined' && out instanceof Uint8Array) { deliverBytes(out, via); return }
        if (typeof Blob !== 'undefined' && out instanceof Blob) { deliverBlob(out, via); return }
        if (out.buffer instanceof ArrayBuffer) { deliverBytes(new Uint8Array(out.buffer), via); return }
        // Unknown shape: say exactly what it was, so the next fix is aimed.
        attempts.push(via + ' returned an unrecognised shape: ' + shapeOf(out))
        fallbackToMediaData()
      }

      function viaDownloadManager() {
        var DM
        try { DM = window.require('WAWebDownloadManager') } catch (e) {
          attempts.push('require(WAWebDownloadManager) failed: ' + String(e && e.message))
          fallbackToMediaData(); return
        }
        var dm = DM && DM.downloadManager
        if (!dm) { attempts.push('WAWebDownloadManager exposes no downloadManager'); fallbackToMediaData(); return }

        // List what the manager really offers before picking a method, so a
        // rename surfaces as a list in the report rather than a bare failure.
        var names = []
        try {
          names = Object.getOwnPropertyNames(dm).concat(
            Object.getOwnPropertyNames(Object.getPrototypeOf(dm) || {}))
        } catch (e) {}

        var picked = null
        var order = ['downloadAndMaybeDecrypt', 'downloadAndDecrypt', 'download']
        for (var i = 0; i < order.length; i++) {
          if (typeof dm[order[i]] === 'function') { picked = order[i]; break }
        }
        if (!picked) {
          attempts.push('no download method on downloadManager; available: ' + names.slice(0, 30).join(','))
          fallbackToMediaData(); return
        }

        var args = {
          directPath: m.directPath,
          encFilehash: m.encFilehash,
          filehash: m.filehash,
          mediaKey: m.mediaKey,
          mediaKeyTimestamp: m.mediaKeyTimestamp,
          type: m.type,
          signal: (typeof AbortController !== 'undefined') ? new AbortController().signal : undefined,
          // A no-op stand-in for WhatsApp's performance logger: the manager
          // annotates this object as it works and fails if it is absent.
          downloadQpl: {
            addAnnotations: function () { return this },
            addPoint: function () { return this }
          }
        }

        var call
        try { call = dm[picked](args) } catch (e) {
          attempts.push(picked + ' threw: ' + String(e && e.message))
          fallbackToMediaData(); return
        }
        Promise.resolve(call).then(
          function (out) { normalise(out, 'downloadManager.' + picked) },
          function (err) {
            attempts.push(picked + ' rejected: ' + String((err && err.message) || err))
            fallbackToMediaData()
          })
      }

      /** Pre-materialised route: works once WhatsApp's own UI has played the media. */
      function fallbackToMediaData() {
        if (typeof m.downloadMedia !== 'function') { report('no downloadMedia() on this message'); return }
        var call
        try { call = m.downloadMedia({ downloadEvenIfExpensive: true }) } catch (e) {
          attempts.push('downloadMedia threw: ' + String(e && e.message)); report('downloadMedia threw'); return
        }
        Promise.resolve(call).then(function () {
          var md = m.mediaData
          var mb = md && md.mediaBlob
          if (typeof Blob !== 'undefined' && mb instanceof Blob) { deliverBlob(mb, 'mediaBlob'); return }
          if (mb && typeof mb.forceToBlob === 'function') {
            Promise.resolve(mb.forceToBlob()).then(
              function (b) { deliverBlob(b, 'mediaBlob.forceToBlob') },
              function (e) { attempts.push('forceToBlob failed: ' + String(e && e.message)); report('forceToBlob failed') })
            return
          }
          var url = md && (md.renderableUrl || md.staticUrl)
          if (url) {
            fetch(url).then(function (r) { return r.blob() })
              .then(function (b) { deliverBlob(b, 'renderableUrl') },
                    function (e) { attempts.push('fetch failed: ' + String(e && e.message)); report('fetch failed') })
            return
          }
          attempts.push('mediaData held no blob and no url')
          report('no readable media on either route')
        }, function (err) {
          attempts.push('downloadMedia rejected: ' + String((err && err.message) || err))
          report('downloadMedia rejected')
        })
      }

      function report(reason) {
        var md = m.mediaData
        resolve({
          ok: false,
          error: reason,
          attempts: attempts,
          _shape: {
            type: m.type,
            mediaStage: md ? md.mediaStage : null,
            hasDirectPath: !!m.directPath,
            hasMediaKey: !!m.mediaKey,
            hasEncFilehash: !!m.encFilehash,
            size: m.size || (md && md.size) || null,
            mediaBlobType: md && md.mediaBlob ? typeof md.mediaBlob : null,
            hasRenderableUrl: !!(md && (md.renderableUrl || md.staticUrl))
          }
        })
      }

      viaDownloadManager()
    })
  }

  /**
   * Delete a message. forEveryone=true recalls it for the recipient too
   * (WhatsApp's own time limit still applies); false removes it only from
   * this account. Both are irreversible, which is why the tool layer above
   * gates this behind explicit approval.
   */
  window.__fdWaDeleteMessage = function (chatId, msgId, forEveryone) {
    return new Promise(function (rawResolve) {
      var resolve = function (v) { rawResolve(safe(v)) }
      var S, chat, m
      try {
        S = store()
        chat = S.Chat.get(chatId)
        m = findMsg(chatId, msgId)
      } catch (e) { resolve({ ok: false, error: String(e && e.message) }); return }
      if (!chat) { resolve({ ok: false, error: 'chat not found: ' + chatId }); return }
      if (!m) { resolve({ ok: false, error: 'message not found: ' + msgId }); return }

      var Send
      try { Send = window.require('WAWebChatSendMessages') } catch (e) {
        resolve({ ok: false, error: 'WAWebChatSendMessages unavailable: ' + String(e && e.message) }); return
      }
      var fn = forEveryone ? 'sendRevokeMsgs' : 'sendDeleteMsgs'
      if (typeof Send[fn] !== 'function') { resolve({ ok: false, error: 'no ' + fn + ' on WAWebChatSendMessages' }); return }

      Promise.resolve(Send[fn](chat, [m], { clearMedia: true })).then(
        function () { resolve({ ok: true, via: fn, msgId: String(msgId) }) },
        function (err) { resolve({ ok: false, via: fn, error: String((err && err.message) || err) }) }
      )
    })
  }

  /**
   * Phase 3 discovery: media send, media download, and edit.
   *
   * Delete is already answered and does not need probing —
   * WAWebChatSendMessages.sendRevokeMsgs / sendDeleteMsgs turned up in an
   * earlier registry dump.
   *
   * The highest-signal part of this is not the module guesses at the bottom
   * but the inspection of a REAL media message above them: a message object
   * carrying its own download method settles the download question outright,
   * with no module name to get wrong. Module names are only guessed where
   * there is nothing concrete to inspect, and every guess reports whether it
   * resolved rather than being assumed.
   */
  window.__fdWaMediaProbe = function () {
    var out = {}
    try {
      var S = store()

      // Find one real message of each interesting kind from what is resident.
      var msgs = modelsOf(S.Msg)
      var byType = {}
      for (var i = msgs.length - 1; i >= 0 && Object.keys(byType).length < 6; i--) {
        var t = msgs[i].type
        if (!t || t === 'chat' || byType[t]) continue
        byType[t] = msgs[i]
      }
      out.mediaTypesFound = Object.keys(byType)

      var sample = byType.ptt || byType.audio || byType.image || byType.video || byType.document || byType.sticker
      if (sample) {
        out.sample = { type: sample.type, chat: sample.id && String(sample.id.remote) }
        out.sampleMediaKeys = Object.keys(sample).filter(function (k) {
          return /media|download|direct|mimetype|filehash|enc|url|size|duration|deprecated/i.test(k)
        }).slice(0, 40)
        var proto = Object.getPrototypeOf(sample)
        out.sampleMethods = proto
          ? Object.getOwnPropertyNames(proto).filter(function (k) {
              return /download|media|decrypt|blob|file|play/i.test(k)
            }).slice(0, 40)
          : null
        // mediaData is the object that actually knows how to fetch and
        // decrypt the payload; its own surface is what a download would use.
        out.mediaDataKeys = sample.mediaData ? Object.keys(sample.mediaData).slice(0, 30) : null
        out.mediaDataMethods = sample.mediaData && Object.getPrototypeOf(sample.mediaData)
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(sample.mediaData))
              .filter(function (k) { return /download|decrypt|blob|url|fetch/i.test(k) }).slice(0, 30)
          : null
      } else {
        out.sample = 'no non-text message resident — open a chat with media and retry'
      }
    } catch (e) { out.sampleError = String(e && e.message) }

    // MediaPrep and prepRawMedia both resolved, but nothing that turns a
    // File/Blob into what they accept did. Their own surface is the thing
    // that names it — read that instead of guessing more module names.
    try {
      var MP = window.require('WAWebMediaPrep')
      out.mediaPrepStatics = MP.MediaPrep ? Object.getOwnPropertyNames(MP.MediaPrep).slice(0, 30) : null
      out.mediaPrepProto = MP.MediaPrep && MP.MediaPrep.prototype
        ? Object.getOwnPropertyNames(MP.MediaPrep.prototype).slice(0, 30) : null
      out.prepRawMediaArity = (function () {
        try { return window.require('WAWebPrepRawMedia').prepRawMedia.length } catch (e) { return null }
      })()
    } catch (e) { out.mediaPrepError = String(e && e.message) }

    var candidates = [
      // send media — the wrapper type prepRawMedia expects
      'WAWebOpaqueDataJS', 'WAWebOpaqueDataUtils', 'WAWebMediaOpaqueData',
      'WAWebOpaqueDataFactory', 'WAWebMediaEntryUtils', 'WAWebMediaBlobUtils',
      // edit — none of the earlier three names existed, but the data model
      // carries __x_latestEditSenderTimestampMs, so the capability is there
      'WAWebSendEditMessageAction', 'WAWebEditMsgAction', 'WAWebMsgEditUtils',
      'WAWebSendMessageEditAction', 'WAWebEditMsg',
      'WAWebSendMediaMsgAction', 'WAWebMediaPrep', 'WAWebPrepRawMedia', 'WAWebOpaqueData',
      'WAWebMediaCollection', 'WAWebUploadMediaAction', 'WAWebSendMediaAction',
      // download media
      'WAWebDownloadManager', 'WAWebMediaDownloadUtils', 'WAWebDownloadMediaAction',
      'WAWebDecryptMedia', 'WAWebMmsMediaDownload',
      // edit
      'WAWebSendEditMsgAction', 'WAWebEditMessageAction', 'WAWebMsgEditAction',
      // delete — already known, confirmed here so the set is verified together
      'WAWebChatSendMessages'
    ]
    out.modules = {}
    for (var j = 0; j < candidates.length; j++) {
      try {
        var m = window.require(candidates[j])
        if (m) out.modules[candidates[j]] = Object.keys(m).slice(0, 20)
      } catch (e) {}
    }
    return safe(out)
  }

  /**
   * Send a text message. Nothing calls this on its own — main-process only.
   *
   * Chat resolution is the awkward part and is done defensively rather than
   * optimistically: Chat.get() only returns a chat that already exists, and a
   * first-ever message to a contact has none (a real lookup returned the
   * contact with zero matching chats). Chat.find() is the collection's own
   * create-or-get, but it is not assumed to exist — if it is missing, or if
   * the id needs to be a WID object rather than a string, this reports which
   * step failed instead of throwing an opaque error, so the next fix is aimed
   * at the actual failure rather than guessed at.
   */
  window.__fdWaSend = function (chatId, text) {
    return new Promise(function (rawResolve) {
      var resolve = function (v) { rawResolve(safe(v)) }
      var S
      try { S = store() } catch (e) { resolve({ ok: false, step: 'store', error: String(e && e.message) }); return }

      var SendText
      try { SendText = window.require('WAWebSendTextMsgChatAction') } catch (e) {
        resolve({ ok: false, step: 'require-send', error: String(e && e.message) }); return
      }

      function wid(id) {
        // String ids work for get() because the collection is keyed by the
        // stringified id, but find() and the send action generally want a
        // real WID object. Build one when the factory is available.
        try {
          var F = window.require('WAWebWidFactory')
          if (F && typeof F.createWid === 'function') return F.createWid(id)
        } catch (e) {}
        return id
      }

      function resolveChat() {
        var existing = null
        try { existing = S.Chat.get(chatId) } catch (e) {}
        if (existing) return Promise.resolve({ chat: existing, via: 'get' })

        // NOT ChatCollection.find(): it exists but delegates to a findImpl
        // that WhatsApp never wires up (diag confirmed findImpl:"undefined"),
        // so calling it throws "this.findImpl is not a function".
        // WAWebFindChatAction is the module that actually owns this — found
        // by listing what the page really exposes, not by guessing a name.
        try {
          var FindChat = window.require('WAWebFindChatAction')
          if (FindChat && typeof FindChat.findOrCreateLatestChat === 'function') {
            return Promise.resolve(FindChat.findOrCreateLatestChat(wid(chatId))).then(function (c) {
              return { chat: c, via: 'findOrCreateLatestChat' }
            })
          }
          if (FindChat && typeof FindChat.findExistingChat === 'function') {
            return Promise.resolve(FindChat.findExistingChat(wid(chatId))).then(function (c) {
              return { chat: c, via: 'findExistingChat' }
            })
          }
          return Promise.resolve({ chat: null, via: 'no-find-action' })
        } catch (e) {
          return Promise.resolve({ chat: null, via: 'find-action-threw', error: String(e && e.message) })
        }
      }

      resolveChat().then(function (r) {
        if (!r.chat) {
          resolve({ ok: false, step: 'resolve-chat', via: r.via, error: r.error || ('no chat for ' + chatId) })
          return
        }
        Promise.resolve(SendText.sendTextMsgToChat(r.chat, text)).then(
          function () { resolve({ ok: true, chatId: String(chatId), via: r.via }) },
          function (err) { resolve({ ok: false, step: 'send', via: r.via, error: String((err && err.message) || err) }) }
        )
      }, function (err) {
        resolve({ ok: false, step: 'resolve-chat-rejected', error: String((err && err.message) || err) })
      })
    })
  }

  /**
   * Attachment sending.
   *
   * Every step below was read off the live page (probes wa-01..wa-08), and the
   * route was verified end to end against a real chat before any of it was
   * written here — a document arrived with the right filename and size, and an
   * image arrived as an image.
   *
   *   WAWebMediaOpaqueData.createFromData(blob, mimetype)  -> opaque data
   *   WAWebPrepRawMedia.prepRawMedia(opaque, opts)         -> a MediaPrep
   *   prep.waitForPrep()                                   -> processing done
   *   prep.sendToChat({ chat, options })                   -> sent
   *
   * The first argument is NOT a File. prepRawMedia calls
   * autoreleaseWhenPromiseCompletes on it, which is an OpaqueData method; a
   * File would fail deep inside the send path rather than at the call.
   *
   * asDocument decides the outward type. Verified rather than assumed: with
   * no flags the type resolved to "image" for an image blob (WhatsApp even
   * transcoded PNG to JPEG itself), and with asDocument it resolved to
   * "document" and kept the filename. Sending a photo as a document is a
   * visibly wrong result, not a cosmetic one, which is why it was tested.
   *
   * ── Why the bytes arrive in chunks ──
   *
   * The page cannot read the filesystem, so the file crosses from the main
   * process as base64 inside an evaluated string. One string for a whole file
   * means a multi-megabyte script for a multi-megabyte attachment. Chunks are
   * staged here and assembled as a Blob at send time, so each evaluated
   * script stays small regardless of file size.
   */
  var fileStage = {}

  window.__fdWaStageChunk = function (token, base64Chunk, mimetype) {
    try {
      if (!fileStage[token]) fileStage[token] = []
      // Decoded per chunk rather than concatenating base64 and decoding once:
      // Blob assembles its parts without a further copy, so peak memory stays
      // close to the file size instead of several times it.
      var binary = atob(base64Chunk)
      var bytes = new Uint8Array(binary.length)
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      fileStage[token].push(new Blob([bytes], { type: mimetype || 'application/octet-stream' }))
      return { ok: true, chunks: fileStage[token].length }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  window.__fdWaDiscardFile = function (token) {
    delete fileStage[token]
    return { ok: true }
  }

  window.__fdWaSendFile = function (chatId, opts) {
    return new Promise(function (rawResolve) {
      var resolve = function (v) {
        // The staged bytes are dropped on every path. Leaving them behind
        // would keep a copy of a user's file in page memory for as long as the
        // tab lives, for no benefit — nothing retries from the stage.
        try { delete fileStage[opts && opts.token] } catch (e) {}
        rawResolve(safe(v))
      }

      var steps = []
      var S, OpaqueData, PrepRaw
      try {
        S = store()
        OpaqueData = window.require('WAWebMediaOpaqueData')
        PrepRaw = window.require('WAWebPrepRawMedia')
      } catch (e) {
        resolve({ ok: false, step: 'require', error: String((e && e.message) || e) }); return
      }

      var parts = fileStage[opts.token]
      if (!parts || !parts.length) {
        resolve({ ok: false, step: 'stage', error: 'no file bytes were staged for this send' }); return
      }

      var chat = null
      try { chat = S.Chat.get(chatId) } catch (e) {}
      if (!chat) {
        // Deliberately NOT findOrCreateLatestChat, which the text path uses.
        // Creating a brand-new chat as a side effect of sending a file to an id
        // that no longer exists is the wrong failure: it would deliver the
        // user's file somewhere they never chose.
        resolve({ ok: false, step: 'resolve-chat', error: 'no existing chat for ' + String(chatId) }); return
      }
      steps.push('chat resolved')

      var blob = new Blob(parts, { type: opts.mimetype || 'application/octet-stream' })
      steps.push('blob assembled: ' + blob.size + ' bytes')

      if (opts.expectedBytes && blob.size !== opts.expectedBytes) {
        // A short blob means a chunk was lost in transit, and sending it would
        // deliver a silently truncated file — which looks like a successful
        // send to everyone involved.
        resolve({ ok: false, step: 'verify-bytes', steps: steps,
          error: 'assembled ' + blob.size + ' bytes but the file is ' + opts.expectedBytes + ' — nothing was sent' })
        return
      }

      var prepOptions = { mimetype: opts.mimetype, filename: opts.filename }
      if (opts.asDocument) prepOptions.asDocument = true

      OpaqueData.createFromData(blob, opts.mimetype || 'application/octet-stream').then(function (opaque) {
        steps.push('opaque data created')
        var prep = PrepRaw.prepRawMedia(opaque, prepOptions)
        return Promise.resolve(prep.waitForPrep()).then(function () {
          steps.push('prep completed')
          var sendOptions = {}
          if (opts.caption) sendOptions.caption = opts.caption
          if (opts.filename) sendOptions.filename = opts.filename
          return Promise.resolve(prep.sendToChat({ chat: chat, options: sendOptions })).then(function () {
            steps.push('sendToChat resolved')
            var md = prep.mediaData
            resolve({
              ok: true,
              chatId: String(chatId),
              filename: opts.filename,
              bytes: blob.size,
              sentAs: md && md.type,
              mimetype: md && md.mimetype,
              steps: steps,
              // Not called delivered. sendToChat resolving is the client's own
              // word for it; whatsapp_list_messages on this chat is what shows
              // the message the server actually holds.
              note: 'sent — read the chat back to confirm what the server kept',
            })
          })
        })
      }).then(null, function (err) {
        resolve({ ok: false, step: 'send', steps: steps, error: String((err && err.message) || err) })
      })
    })
  }

  // Poll for population rather than assuming any fixed delay is enough — how
  // long history sync takes varies with account size and connection.
  var tries = 0
  var timer = setInterval(function () {
    tries++
    tryHook()
    if (tryAnnounce() || tries > 90) {
      if (!announced) post({ kind: 'ready', chats: 0, contacts: 0, timedOut: true })
      clearInterval(timer)
    }
  }, 2000)
  tryHook()
  tryAnnounce()

  return true
})()
`
