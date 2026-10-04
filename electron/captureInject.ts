/**
 * Builds a main-world capture script for a given provider's streaming
 * endpoint. Tees the matching fetch() response so the page keeps working
 * normally while a copy of every chunk is posted out (via window.postMessage
 * → webviewPreload.ts → IPC) for capture in the main process.
 *
 * matchSource is a regex *source string* (no literal JS regex here) because
 * it gets embedded into the injected script via JSON.stringify + `new RegExp`.
 *
 * `tool` is stamped into every posted message at the source. Some providers
 * (claude.ai) call fetch() with a relative path ("/api/organizations/...")
 * rather than an absolute URL, so sniffing the tool back out of `url` in the
 * main process is unreliable — tag it here instead, where we already know
 * which CAPTURE_RULES entry matched.
 */
export function buildCaptureInjectSrc(matchSource: string, tool: string, flags = ''): string {
  return `
(function () {
  if (window.__fdCapture) return true
  window.__fdCapture = true

  var MATCH = new RegExp(${JSON.stringify(matchSource)}, ${JSON.stringify(flags)})
  var TOOL = ${JSON.stringify(tool)}

  var origFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var input = args[0]
    var url = typeof input === 'string' ? input : (input && (input.url || input.href)) || ''

    return origFetch.apply(this, args).then(function (res) {
      if (!MATCH.test(url) || !res.body || res.status !== 200) return res
      try {
        var teed = res.body.tee()
        drain(teed[1], url)
        return new Response(teed[0], {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        })
      } catch (e) {
        return res
      }
    })
  }

  function drain(stream, url) {
    var reader = stream.getReader()
    var decoder = new TextDecoder()
    var id = 'fd_' + Date.now() + '_' + Math.random().toString(36).slice(2)

    function pump() {
      reader.read().then(function (result) {
        if (result.done) {
          window.postMessage({ __flowdeskCapture: { id: id, tool: TOOL, url: url, done: true } }, '*')
          return
        }
        var text = decoder.decode(result.value, { stream: true })
        window.postMessage({ __flowdeskCapture: { id: id, tool: TOOL, url: url, chunk: text } }, '*')
        pump()
      }).catch(function (err) {
        window.postMessage({ __flowdeskCapture: { id: id, tool: TOOL, url: url, error: String(err) } }, '*')
      })
    }
    pump()
  }
})();
true;
`
}

/**
 * XHR variant of the same idea. Some providers (Google's web apps,
 * historically including Gemini/Bard) use the old "batchexecute" protocol
 * over XMLHttpRequest rather than fetch()+ReadableStream — fetch-patching
 * alone would silently capture nothing for those. Sends the same
 * { id, tool, url, chunk/done } shape, computing each chunk as the new
 * suffix of responseText since the last 'progress' event.
 */
export function buildXHRCaptureInjectSrc(matchSource: string, tool: string, flags = ''): string {
  return `
(function () {
  if (window.__fdXHRCapture) return true
  window.__fdXHRCapture = true

  var MATCH = new RegExp(${JSON.stringify(matchSource)}, ${JSON.stringify(flags)})
  var TOOL = ${JSON.stringify(tool)}

  var OrigXHR = window.XMLHttpRequest
  var origOpen = OrigXHR.prototype.open
  var origSend = OrigXHR.prototype.send

  OrigXHR.prototype.open = function (method, url) {
    this.__fdUrl = url
    this.__fdMatch = MATCH.test(String(url))
    return origOpen.apply(this, arguments)
  }

  OrigXHR.prototype.send = function () {
    if (this.__fdMatch) {
      var id = 'fd_' + Date.now() + '_' + Math.random().toString(36).slice(2)
      var lastLen = 0
      var url = this.__fdUrl
      var self = this

      var flush = function (isFinal) {
        try {
          var text = self.responseText || ''
          if (text.length > lastLen) {
            var chunk = text.slice(lastLen)
            lastLen = text.length
            window.postMessage({ __flowdeskCapture: { id: id, tool: TOOL, url: url, chunk: chunk } }, '*')
          }
        } catch (e) {}
        if (isFinal) window.postMessage({ __flowdeskCapture: { id: id, tool: TOOL, url: url, done: true } }, '*')
      }

      this.addEventListener('progress', function () { flush(false) })
      this.addEventListener('loadend', function () { flush(true) })
    }
    return origSend.apply(this, arguments)
  }
})();
true;
`
}

/**
 * WebSocket variant. Grok's web app doesn't stream over fetch/XHR at all —
 * it opens one persistent wss:// connection per session and pushes typed
 * JSON events (confirmed via a real capture): "response.chunk" carries a
 * word-ish text delta at event.chunk.text.text (only on the
 * "CHANNEL_ASSISTANT_RESPONSE" channel — there's also a
 * "CHANNEL_ASSISTANT_NOTETAKER_HEADER" channel that must be excluded), and
 * "response.done" (event.response.id) signals that response is complete.
 * A single connection carries many turns over its lifetime, so captures are
 * correlated by response_id, not by the connection itself — unlike the
 * fetch/XHR variants above where one capture id = one call.
 *
 * The extraction happens here, client-side, rather than being deferred to a
 * *Parser.ts file like chatgpt/claude/gemini — Grok's payload is already
 * clean per-event JSON, so there's no SSE-style reassembly needed on the
 * main-process side; main.ts just appends payload.chunk verbatim.
 */
export function buildWSCaptureInjectSrc(urlMatchSource: string, tool: string): string {
  return `
(function () {
  if (window.__fdWSCapture) return true
  window.__fdWSCapture = true

  var URL_MATCH = new RegExp(${JSON.stringify(urlMatchSource)})
  var TOOL = ${JSON.stringify(tool)}

  var OrigWS = window.WebSocket
  if (!OrigWS) return true

  var WrappedWS = function (url, protocols) {
    var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols)
    if (URL_MATCH.test(String(url))) {
      ws.addEventListener('message', function (ev) {
        try {
          if (typeof ev.data !== 'string') return
          var obj = JSON.parse(ev.data)
          var evt = obj && obj.event
          if (!evt || !evt.type) return

          // Debug-only: forward every event type verbatim so the main
          // process can print it (see FD_CAPTURE_DEBUG) — used to discover
          // what else this WS connection carries beyond response.chunk/done.
          window.postMessage({ __flowdeskGrokRaw: { type: evt.type, evt: evt } }, '*')

          if (evt.type === 'response.chunk') {
            var textNode = evt.chunk && evt.chunk.text
            if (textNode && textNode.channel === 'CHANNEL_ASSISTANT_RESPONSE' && typeof textNode.text === 'string') {
              window.postMessage({ __flowdeskCapture: { id: evt.response_id, tool: TOOL, url: url, chunk: textNode.text } }, '*')
            }
          } else if (evt.type === 'response.done') {
            var doneId = evt.response && evt.response.id
            if (doneId) window.postMessage({ __flowdeskCapture: { id: doneId, tool: TOOL, url: url, done: true } }, '*')
          }
        } catch (e) {}
      })
    }
    return ws
  }
  WrappedWS.prototype = OrigWS.prototype
  WrappedWS.CONNECTING = OrigWS.CONNECTING
  WrappedWS.OPEN = OrigWS.OPEN
  WrappedWS.CLOSING = OrigWS.CLOSING
  WrappedWS.CLOSED = OrigWS.CLOSED
  window.WebSocket = WrappedWS
})();
true;
`
}

/**
 * Discovery-only: logs every fetch/XHR URL (method + url + response size)
 * without trying to capture bodies. Used to find a provider's real
 * streaming endpoint when the obvious guesses (see GEMINI_MATCH_SRC) don't
 * pan out — e.g. Gemini's actual generate-content call turned out not to
 * match /StreamGenerate|batchexecute/ at all when tested against real
 * traffic, so this casts a total net instead of a smarter guess.
 */
export function buildURLSnifferSrc(tool: string): string {
  return `
(function () {
  if (window.__fdSniffer) return true
  window.__fdSniffer = true
  var TOOL = ${JSON.stringify(tool)}

  var origFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var input = args[0]
    var url = typeof input === 'string' ? input : (input && (input.url || input.href)) || ''
    var method = (args[1] && args[1].method) || 'GET'
    return origFetch.apply(this, args).then(function (res) {
      try {
        window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'fetch', method: method, url: url, status: res.status } }, '*')
      } catch (e) {}
      return res
    })
  }

  var OrigXHR = window.XMLHttpRequest
  var origOpen = OrigXHR.prototype.open
  OrigXHR.prototype.open = function (method, url) {
    this.__fdM = method
    this.__fdU = url
    this.addEventListener('loadend', function () {
      var self = this
      try {
        window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'xhr', method: self.__fdM, url: String(self.__fdU), status: self.status, size: (self.responseText || '').length } }, '*')
      } catch (e) {}
    })
    return origOpen.apply(this, arguments)
  }

  var OrigWS = window.WebSocket
  if (OrigWS) {
    var WrappedWS = function (url, protocols) {
      var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols)
      try {
        window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'ws-open', method: 'WS', url: String(url) } }, '*')
      } catch (e) {}
      ws.addEventListener('message', function (ev) {
        try {
          // Binary frames need their real byte length reported, not the
          // length of a '[binary]' placeholder: on a target whose frames are
          // all binary (WhatsApp Web's are Noise-encrypted), frame size is
          // the only signal left for telling a real content frame apart from
          // a heartbeat, and collapsing every frame to a constant 8 would
          // throw away the one thing discovery is looking for.
          if (typeof ev.data === 'string') {
            window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'ws-message', method: 'WS', url: String(url), size: ev.data.length, preview: ev.data.slice(0, 800) } }, '*')
            return
          }
          var kind = ev.data instanceof Blob ? 'blob' : (ev.data instanceof ArrayBuffer ? 'arraybuffer' : 'binary')
          var bytes = ev.data instanceof Blob ? ev.data.size : (ev.data instanceof ArrayBuffer ? ev.data.byteLength : -1)
          window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'ws-message', method: 'WS', url: String(url), size: bytes, preview: '[' + kind + ']' } }, '*')
        } catch (e) {}
      })
      return ws
    }
    WrappedWS.prototype = OrigWS.prototype
    WrappedWS.CONNECTING = OrigWS.CONNECTING
    WrappedWS.OPEN = OrigWS.OPEN
    WrappedWS.CLOSING = OrigWS.CLOSING
    WrappedWS.CLOSED = OrigWS.CLOSED
    window.WebSocket = WrappedWS
  }
})();
true;
`
}

export const CHATGPT_MATCH_SRC = '/backend-api/(f/)?conversation(?:/|\\?|$)'
export const CLAUDE_MATCH_SRC = '/api/organizations/[^/]+/chat_conversations/[^/]+/completion'
// Confirmed via buildURLSnifferSrc against a real session: Gemini's actual
// generate-content call is this specific StreamGenerate RPC over XHR
// (~5KB response), not the small batchexecute calls (~150 bytes each,
// telemetry/heartbeat) that a broader 'batchexecute' match was catching
// instead.
export const GEMINI_MATCH_SRC = '/BardChatUi/data/assistant\\.lamda\\.BardFrontendService/StreamGenerate'
// Confirmed via buildURLSnifferSrc: Grok streams over a persistent
// wss://grok.com/ws/mgw/ connection, not fetch/XHR at all.
export const GROK_MATCH_SRC = 'wss?://grok\\.com/ws/mgw/'
// Confirmed via buildURLSnifferSrc: fetch()-based, and literally named "sse"
// in the path — the raw event format still needs verifying though (main.ts
// dumps it raw for now rather than assuming it matches ChatGPT/Claude's).
export const PERPLEXITY_MATCH_SRC = '/rest/sse/perplexity_ask'

export const CHATGPT_CAPTURE_SRC = buildCaptureInjectSrc(CHATGPT_MATCH_SRC, 'chatgpt')
export const CLAUDE_CAPTURE_SRC = buildCaptureInjectSrc(CLAUDE_MATCH_SRC, 'claude')
// Discovery build: patches both fetch and XHR since we don't yet know which
// transport Gemini's web app actually uses for its streaming response.
export const GEMINI_CAPTURE_SRC =
  buildCaptureInjectSrc(GEMINI_MATCH_SRC, 'gemini', 'i') + '\n' +
  buildXHRCaptureInjectSrc(GEMINI_MATCH_SRC, 'gemini', 'i')
export const GROK_CAPTURE_SRC = buildWSCaptureInjectSrc(GROK_MATCH_SRC, 'grok')
export const QWEN_SNIFFER_SRC = buildURLSnifferSrc('qwen')
// Confirmed via buildURLSnifferSrc against a real session: Qwen's actual
// answer call is a fetch() POST to this endpoint (query string carries
// chat_id, so no trailing anchor other than the path itself).
export const QWEN_MATCH_SRC = '/api/v2/chat/completions'
export const QWEN_CAPTURE_SRC = buildCaptureInjectSrc(QWEN_MATCH_SRC, 'qwen')
export const PERPLEXITY_CAPTURE_SRC = buildCaptureInjectSrc(PERPLEXITY_MATCH_SRC, 'perplexity')
export const DEEPSEEK_MATCH_SRC = '/api/v0/chat/completion'
export const DEEPSEEK_CAPTURE_SRC = buildCaptureInjectSrc(DEEPSEEK_MATCH_SRC, 'deepseek')

export interface ImageProgressStage {
  stageNumber: number
  percent: number
  stage: string
}

export const CHATGPT_IMAGE_STAGES: Record<number, ImageProgressStage> = {
  1: { stageNumber: 1, percent: 15, stage: 'Prompt injected & request received by ChatGPT backend' },
  2: { stageNumber: 2, percent: 35, stage: 'DALL-E tool invoked / image generation started' },
  3: { stageNumber: 3, percent: 60, stage: 'Image rendering in progress' },
  4: { stageNumber: 4, percent: 85, stage: 'Asset pointer received' },
  5: { stageNumber: 5, percent: 95, stage: 'Fetching and saving high-res image bytes to disk' },
  6: { stageNumber: 6, percent: 100, stage: 'Image saved as flowdesk-image:// and available' },
}

export function isDalleToolInvoked(evt: string): boolean {
  return /t2uay3k\.sj1i4kz|"recipient"\s*:\s*"[^"]*dalle[^"]*"|"name"\s*:\s*"[^"]*dalle[^"]*"|image_gen_title|generating_image/i.test(evt)
}

export function detectImageProgressStage(evt: string, currentStage = 0): ImageProgressStage | null {
  if (/sediment:\/\//i.test(evt)) return CHATGPT_IMAGE_STAGES[4]
  if (isDalleToolInvoked(evt)) return CHATGPT_IMAGE_STAGES[2]
  if (/image_asset_pointer|"content_type"\s*:\s*"image|dalle|asset_pointer/i.test(evt)) {
    return currentStage >= 2 ? CHATGPT_IMAGE_STAGES[3] : CHATGPT_IMAGE_STAGES[2]
  }
  return null
}

// Discovery-only, no capture rule yet: WhatsApp Web is expected to differ
// fundamentally from every provider above. Its transport is a WebSocket to
// web.whatsapp.com carrying Noise-protocol-encrypted binary frames, so
// unlike Grok's clean per-event JSON there is likely nothing readable to
// tee at the network layer at all — buildWSCaptureInjectSrc bails on
// non-string ev.data by design. Run this sniffer against a real session
// first and read the actual frames before writing any capture rule: if the
// ws-message entries come back as [blob]/[arraybuffer], the interception
// point has to move up a layer to WhatsApp Web's own already-decrypted
// internal modules rather than staying on the wire.
export const WHATSAPP_SNIFFER_SRC = buildURLSnifferSrc('whatsapp')

/**
 * Step 2 of WhatsApp discovery. The sniffer above already answered step 1,
 * and the answer was conclusive: on a real logged-in session every single
 * content frame on wss://web.whatsapp.com:5222/ws/chat came back as
 * [arraybuffer] — not one string frame in the whole run — with real payloads
 * up to 482KB riding alongside 39-58 byte heartbeats. So the wire carries
 * exactly the Noise-encrypted binary it was expected to, and there is
 * nothing tee-able there at any size. Network-layer capture is ruled out.
 *
 * That moves the interception point up to where the page has already
 * decrypted everything for its own rendering: WhatsApp Web's module
 * registry. But which registry is itself an open question — the old
 * moduleRaid/`webpackChunkwhatsapp_web_client` trick that every WhatsApp
 * automation library was built on assumes plain webpack, and the sniffer log
 * shows this build is NOT plain webpack: it boots through Meta's Comet
 * loader (`/ajax/bootloader-endpoint/?nb_modules=WAWebCollections,...`),
 * which is a different module system entirely.
 *
 * So probe before building: report which loader globals actually exist on
 * the live page and whether a known WA module can be pulled out of them,
 * rather than picking an injection library on the strength of its README and
 * finding out later. Re-runs on a delay because the registry populates as
 * the app boots — a single probe at dom-ready is too early to be meaningful.
 */
/**
 * Step 3 of WhatsApp discovery, and the last one before a real capture rule.
 *
 * Step 2 answered the access question outright, and more cheaply than
 * expected. Probed against a live session, the page exposes Meta's Comet
 * loader directly — require/__d/requireLazy/importNamespace are all
 * functions — and `require('WAWebCollections')` returns the live, decrypted
 * store synchronously: Chat, Msg, MsgInfo, Contact, GroupMetadata, Presence,
 * Reactions and ~40 more. (`webpackChunkwhatsapp_web_client` does also still
 * exist, contrary to what the Comet bootloader URLs suggested — but it is
 * moot, since nothing here needs moduleRaid-style chunk injection or any
 * third-party injection library to reach the same objects.)
 *
 * What is still unknown is the SHAPE of what those collections hold, and
 * that is the one thing a parser cannot be written against from a module
 * listing. So this pass does not extract anything for real use — it reports
 * the key list of one genuine message model plus a heavily truncated body,
 * enough to write extraction against observed structure rather than an
 * assumed one, and no more than that (this is the user's own live inbox).
 *
 * It also enumerates the module registry for send-capable modules instead of
 * guessing a name like WAWebSendMsgChatAction and hoping: the name is
 * discoverable, so it should be discovered.
 */
export const WHATSAPP_STORE_PROBE_SRC = `
(function () {
  if (window.__fdWaStore) return true
  window.__fdWaStore = true

  var seen = {}
  var liveCount = 0

  // Static facts dedupe; live message arrivals deliberately do not. The
  // previous pass deduped everything by key, which silenced the hook after
  // its very first event — and that first event happened to be a newsletter
  // image, so the actual text message sent seconds later never appeared and
  // the run looked like it had captured the wrong thing. Cap rather than
  // dedupe: enough events to see both directions of a real exchange, not so
  // many that a history sync floods the log.
  function report(what, detail, always) {
    if (!always) {
      if (seen[what]) return
      seen[what] = true
    }
    try {
      window.postMessage({ __flowdeskSniff: {
        tool: 'whatsapp', transport: 'store-probe', method: what,
        url: '', preview: String(detail).slice(0, 1200)
      } }, '*')
    } catch (e) {}
  }

  function sample(m) {
    var body = typeof m.body === 'string' ? m.body : ''
    return JSON.stringify({
      type: m.type,
      fromMe: m.id && m.id.fromMe,
      chat: m.id && String(m.id.remote),
      hasCaption: !!m.caption,
      // Media bodies are base64 payloads, not text: reporting 60 chars of a
      // JPEG tells us nothing and buries the text case, so label instead.
      body: m.type === 'chat' ? body.slice(0, 80) : '[' + m.type + ' payload ' + body.length + 'b]'
    })
  }

  function findSendModule() {
    // require.__debug.modules is not exposed on this build (confirmed), so
    // the registry cannot simply be listed. Two fallbacks, both verified by
    // what actually resolves rather than by picking a name from a README.
    var candidates = [
      'WAWebSendTextMsgChatAction', 'WAWebSendMsgChatAction', 'WAWebSendTextMsg',
      'WAWebChatSendMessages', 'WAWebSendMsg', 'WAWebMsgSendUtils',
      'WAWebComposeBoxActions', 'WAWebSendMessageAction'
    ]
    var hits = []
    for (var i = 0; i < candidates.length; i++) {
      try {
        var mod = window.require(candidates[i])
        if (mod) hits.push(candidates[i] + '{' + Object.keys(mod).slice(0, 12).join('|') + '}')
      } catch (e) {}
    }
    report('send/directRequire', hits.length ? hits.join('  ||  ') : 'none of the candidate names resolved')

    // webpackChunkwhatsapp_web_client does exist on this build (confirmed in
    // the previous pass), so its factory sources can be scanned for the real
    // export name even though Comet's own registry is closed.
    try {
      var chunk = window.webpackChunkwhatsapp_web_client
      if (chunk && chunk.push) {
        var ids = []
        chunk.push([['__fdProbe'], {}, function (req) {
          try { ids = Object.keys(req.m || req.c || {}) } catch (e) {}
        }])
        report('send/webpackModuleCount', String(ids.length))
      } else {
        report('send/webpack', 'chunk global present but not pushable')
      }
    } catch (e) { report('send/webpack-error', e && e.message) }
  }

  function attach() {
    var Store
    try { Store = window.require('WAWebCollections') } catch (e) { return false }
    if (!Store || !Store.Msg) return false

    // Report counts on a delay too: at dom-ready the collections exist but
    // are empty, and a single early reading (chats:0, msgs:0) reads as a
    // failure when it is really just history sync not having landed yet.
    function counts(tag) {
      report('counts/' + tag, JSON.stringify({
        chats: Store.Chat && Store.Chat.length,
        msgs: Store.Msg && Store.Msg.length,
        contacts: Store.Contact && Store.Contact.length
      }))
    }
    counts('t0')
    setTimeout(function () { counts('t15s') }, 15000)
    setTimeout(function () {
      counts('t40s')
      try {
        var models = Store.Msg.models || []
        var chats = models.filter(function (m) { return m.type === 'chat' })
        var m = chats[chats.length - 1]
        if (m) {
          report('msg/attrKeys', Object.keys(m).filter(function (k) { return k.indexOf('__x_') === 0 }).slice(0, 80).join(','))
          report('msg/sample', sample(m))
        } else {
          report('msg/sample', 'no type=chat message loaded yet')
        }
      } catch (e) { report('msg/shape-error', e && e.message) }
      findSendModule()
    }, 40000)

    try {
      Store.Msg.on('add', function (m) {
        if (liveCount >= 8) return
        liveCount++
        try { report('LIVE#' + liveCount, sample(m), true) } catch (e) {}
      })
      report('hook/msg-add', 'attached')
    } catch (e) { report('hook/msg-add-error', e && e.message) }

    return true
  }

  var tries = 0
  var timer = setInterval(function () {
    tries++
    if (attach() || tries > 30) clearInterval(timer)
  }, 2000)
  if (attach()) clearInterval(timer)
  return true
})()
`

export const WHATSAPP_MODULE_PROBE_SRC = `
(function () {
  if (window.__fdWaProbe) return true
  window.__fdWaProbe = true

  function report(what, detail) {
    try {
      window.postMessage({ __flowdeskSniff: {
        tool: 'whatsapp', transport: 'module-probe', method: what,
        url: '', preview: String(detail).slice(0, 900)
      } }, '*')
    } catch (e) {}
  }

  function keysOf(mod) {
    if (!mod) return 'null'
    try { return Object.keys(mod).slice(0, 60).join(',') } catch (e) { return 'unlistable:' + e.message }
  }

  function run(pass) {
    try {
      var chunkGlobals = []
      for (var k in window) { if (k.indexOf('webpackChunk') === 0 || k.indexOf('webpackJsonp') === 0) chunkGlobals.push(k) }
      report('pass' + pass + '/globals', JSON.stringify({
        require: typeof window.require,
        __d: typeof window.__d,
        requireLazy: typeof window.requireLazy,
        importNamespace: typeof window.importNamespace,
        WPP: typeof window.WPP,
        webpackGlobals: chunkGlobals
      }))
    } catch (e) { report('pass' + pass + '/globals-error', e && e.message) }

    // Comet's synchronous require: works only for modules already loaded.
    try {
      if (typeof window.require === 'function') {
        report('pass' + pass + '/require(WAWebCollections)', keysOf(window.require('WAWebCollections')))
      }
    } catch (e) { report('pass' + pass + '/require-error', e && e.message) }

    // Comet's async loader: pulls the module in if it is not resident yet.
    try {
      if (typeof window.requireLazy === 'function') {
        window.requireLazy(['WAWebCollections'], function (mod) {
          report('pass' + pass + '/requireLazy(WAWebCollections)', keysOf(mod))
        })
        window.requireLazy(['WAWebChatCollection'], function (mod) {
          report('pass' + pass + '/requireLazy(WAWebChatCollection)', keysOf(mod))
        })
      }
    } catch (e) { report('pass' + pass + '/requireLazy-error', e && e.message) }
  }

  // Boot is asynchronous and the registry fills in progressively: the useful
  // signal is not any single pass but which of these three first succeeds.
  run(1)
  setTimeout(function () { run(2) }, 8000)
  setTimeout(function () { run(3) }, 20000)
  return true
})()
`

