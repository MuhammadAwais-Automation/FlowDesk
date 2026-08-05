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
          var data = typeof ev.data === 'string' ? ev.data : '[binary]'
          window.postMessage({ __flowdeskSniff: { tool: TOOL, transport: 'ws-message', method: 'WS', url: String(url), size: data.length, preview: data.slice(0, 800) } }, '*')
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
