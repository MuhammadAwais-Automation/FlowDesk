// @target web.whatsapp.com
//
// READ-ONLY. Reads function source text. Nothing is called.
//
// wa-02 found two candidate routes to sending an attachment:
//
//   A  AttachMediaCollection.processAttachmentsForChat(...) — mirrors what the
//      attachment tray does, and carries its picker/preview state with it
//   B  WAWebPrepRawMedia.prepRawMedia(file, opts) -> MediaPrep.sendToChat(chat, opts)
//      — two calls, no UI state
//
// B looks like the smaller surface, and its source head already leaked real
// option names (isPtt, asDocument, asGif). Before calling anything inside a
// live messaging session, this reads the sources in full so the argument
// shapes come from the code rather than from a blog post about a different
// WhatsApp build.
//
// Minified builds keep parameter names meaningless but preserve DESTRUCTURING
// of option objects — `e.asDocument`, `t.caption` — which is exactly the part
// that has to be right.

function src(fn, limit) {
  try { return String(fn).slice(0, limit || 4000) } catch (e) { return '[unreadable: ' + String(e && e.message) + ']' }
}

var prep = window.require('WAWebPrepRawMedia')
var mediaPrep = window.require('WAWebMediaPrep')
var collection = window.require('WAWebAttachMediaCollection')

// Option keys read out of the source rather than assumed. Anything of the form
// `.someName` that follows a parameter is a candidate; this just surfaces the
// distinctive ones so they can be eyeballed against the full text below.
function optionKeysIn(text) {
  var found = {}
  var re = /\.(as[A-Z][A-Za-z]+|is[A-Z][A-Za-z]+|caption|filename|mimetype|quality|type|stickerPack|forwarded|mentionedJidList|viewOnce)\b/g
  var m
  while ((m = re.exec(text))) found[m[1]] = (found[m[1]] || 0) + 1
  return Object.keys(found).sort()
}

var prepSource = src(prep.prepRawMedia, 6000)
var sendToChatSource = src(mediaPrep.MediaPrep.prototype.sendToChat, 6000)
var waitForPrepSource = src(mediaPrep.MediaPrep.prototype.waitForPrep, 2500)
var sendMediaMsgSource = src(mediaPrep.sendMediaMsgToChat, 4000)
var processForChatSource = src(collection.prototype.processAttachmentsForChat, 3000)
var processSource = src(collection.prototype.processAttachments, 3000)

return {
  routeB: {
    prepRawMedia: { arity: prep.prepRawMedia.length, optionKeys: optionKeysIn(prepSource), source: prepSource },
    sendToChat: { arity: mediaPrep.MediaPrep.prototype.sendToChat.length, optionKeys: optionKeysIn(sendToChatSource), source: sendToChatSource },
    waitForPrep: { arity: mediaPrep.MediaPrep.prototype.waitForPrep.length, source: waitForPrepSource },
    sendMediaMsgToChat: { arity: mediaPrep.sendMediaMsgToChat.length, optionKeys: optionKeysIn(sendMediaMsgSource), source: sendMediaMsgSource },
  },
  routeA: {
    processAttachmentsForChat: { arity: collection.prototype.processAttachmentsForChat.length, source: processForChatSource },
    processAttachments: { arity: collection.prototype.processAttachments.length, source: processSource },
  },
  // The outward types decide document-vs-image, and are what `asDocument`
  // selects between. Reading the real enum avoids inventing a value.
  outwardTypes: (function () {
    try { return window.require('WAWebMediaTypes').OUTWARD_TYPES } catch (e) { return { error: String(e && e.message) } }
  })(),
}
