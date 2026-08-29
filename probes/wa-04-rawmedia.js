// @target web.whatsapp.com
//
// READ-ONLY. Source text and shapes only. Nothing is called, nothing is sent.
//
// Route A turned out to be unreadable — processAttachmentsForChat is a
// five-argument async wrapper whose body is behind babel's transform, so its
// arguments cannot be learned from the page. Route B is readable, and
// wa-03 showed what it needs:
//
//   prepRawMedia(media, opts) -> WAWebProcessRawMedia.processRawMedia(media, opts)
//
// with `media.autoreleaseWhenPromiseCompletes(...)` called on it — which means
// the first argument is NOT a File. It is one of WhatsApp's own opaque-data
// wrappers. That single method call is the whole reason this probe exists:
// passing a File where an OpaqueData is expected would fail somewhere deep
// inside a send path, in a live chat.
//
// This reads what processRawMedia wants and how an OpaqueData is made.

function src(fn, limit) {
  try { return String(fn).slice(0, limit || 4000).replace(/\s+/g, ' ') } catch (e) { return '[unreadable]' }
}

function shapeOf(name) {
  try {
    var mod = window.require(name)
    var out = { keys: Object.keys(mod).slice(0, 30) }
    out.members = {}
    for (var i = 0; i < out.keys.length && i < 20; i++) {
      var k = out.keys[i]
      var v = mod[k]
      if (typeof v === 'function') {
        var proto = []
        try { proto = Object.getOwnPropertyNames(v.prototype || {}).slice(0, 30) } catch (e) {}
        out.members[k] = { kind: 'function', arity: v.length, head: src(v, 400), prototypeMethods: proto }
      } else {
        out.members[k] = { kind: typeof v }
      }
    }
    return out
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) }
  }
}

var processRawMediaSource = '[not found]'
try {
  processRawMediaSource = src(window.require('WAWebProcessRawMedia').processRawMedia, 6000)
} catch (e) {
  processRawMediaSource = '[error: ' + String(e && e.message) + ']'
}

return {
  processRawMedia: {
    source: processRawMediaSource,
    module: shapeOf('WAWebProcessRawMedia'),
  },
  // The wrapper the first argument has to be. createFromData(blob, type) was
  // seen referenced in getMediaPropsNew, so it is expected here — this
  // confirms it exists on THIS build rather than on the one that blog post
  // used.
  opaqueData: shapeOf('WAWebMediaOpaqueData'),
  // Present in the module list; if it exists it is the shortest honest path
  // from a File to something sendable.
  opaqueDataFromFile: (function () {
    try {
      var od = window.require('WAWebMediaOpaqueData')
      var names = Object.keys(od)
      var creators = []
      for (var i = 0; i < names.length; i++) {
        if (/create|from/i.test(names[i])) creators.push({ name: names[i], arity: typeof od[names[i]] === 'function' ? od[names[i]].length : null })
      }
      return creators
    } catch (e) { return { error: String(e && e.message) } }
  })(),
}
