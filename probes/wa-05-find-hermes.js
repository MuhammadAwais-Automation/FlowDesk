// @target web.whatsapp.com
//
// READ-ONLY. Looks up one chat by name. Nothing is sent.
//
// The send probe that follows needs a chat id, and the id must come from the
// page rather than from anything typed by hand: ids on this build are @lid,
// an opaque per-account identifier that carries no phone number and nothing
// recognisable. Typing one out is exactly how a test message lands in a
// stranger's chat.

var S = window.require('WAWebCollections')

function nameOf(chat) {
  try {
    var c = S.Contact.get(chat.id)
    if (c && (c.name || c.pushname || c.formattedName)) return String(c.name || c.pushname || c.formattedName)
  } catch (e) {}
  return String((chat.contact && chat.contact.name) || chat.formattedTitle || chat.name || '')
}

var models = S.Chat.getModelsArray()
var matches = []
for (var i = 0; i < models.length; i++) {
  var chat = models[i]
  var name = nameOf(chat)
  if (!/hermes/i.test(name)) continue
  matches.push({
    id: String(chat.id && chat.id._serialized ? chat.id._serialized : chat.id),
    name: name,
    isGroup: !!chat.isGroup,
    unread: chat.unreadCount,
    lastMessageAt: chat.t,
  })
}

return {
  totalChats: models.length,
  matches: matches,
  // Reported so the next probe can be aimed with certainty rather than with
  // "probably the first one".
  exactlyOne: matches.length === 1,
}
