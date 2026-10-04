// @target web.whatsapp.com
//
// READ-ONLY. Nothing is sent, nothing is clicked, no file is touched.
//
// Looking for the media-send equivalent of WAWebSendTextMsgChatAction, which
// discovery already found and which retired the whole CDP composer-typing path
// for text. If a comparable module exists for attachments, it retires the file
// path too — the alternative approaches (driving a hidden <input type=file>
// through CDP, or synthesising a drag-drop) both mean the native Windows file
// dialog and a lot of DOM guessing.
//
// This asks the page's own module registry rather than guessing names.

function names(map) {
  try { return Object.keys(map) } catch (e) { return [] }
}

var out = {
  hasRequire: typeof window.require === 'function',
  debugModuleError: null,
  moduleCount: 0,
  matches: {},
  sample: [],
}

if (!out.hasRequire) return out

// WhatsApp's bundler exposes its module map under this id. If the shape has
// changed, the error is worth seeing verbatim rather than being swallowed —
// it is the difference between "no such module" and "no such registry".
var all = []
try {
  var dbg = window.require('__debug')
  var map = dbg && (dbg.modulesMap || dbg.modules || dbg)
  all = names(map)
} catch (e) {
  out.debugModuleError = String((e && e.message) || e)
}

out.moduleCount = all.length
out.sample = all.slice(0, 15)

// Grouped rather than one flat list: which bucket a name falls into says more
// about what it does than the name alone, and the buckets are what the next
// probe will actually call into.
var buckets = {
  sendMedia: /send.*media|media.*msg|sendmsg.*media/i,
  mediaPrep: /mediaprep|prepraw|preparemedia|mediaobject|mediadata/i,
  mediaCollection: /mediacollection|mediaentry/i,
  upload: /upload|encryptmedia|mmsupload/i,
  attach: /attach|dropzone|filepicker|inputfile/i,
  document: /senddoc|documentmsg/i,
  image: /sendimage|imagemsg|stickermsg|videomsg/i,
}

for (var key in buckets) {
  var re = buckets[key]
  var hits = []
  for (var i = 0; i < all.length; i++) {
    if (re.test(all[i])) hits.push(all[i])
  }
  out.matches[key] = hits.slice(0, 40)
}

return out
