// @target web.whatsapp.com
//
// READ-ONLY. Nothing is constructed, nothing is called, nothing is sent.
// Only shapes are read: what each module exports, and what its prototype
// offers.
//
// wa-01 narrowed 16,878 modules down to a handful. The point of reading shapes
// before calling anything is that a name is not an API — WAWebAttachMediaCollection
// could be a React helper, a constants bag, or the thing that actually sends.
// Guessing wrong here means calling an unknown function with unknown arguments
// inside a live messaging session, which is not a mistake worth making twice.

var TARGETS = [
  'WAWebAttachMediaCollection',
  'WAWebAttachMediaModel',
  'WAWebAttachMediaGetters',
  'WAWebMediaPrep',
  'WAWebPrepRawMedia',
  'WAWebMediaObject',
  'WAWebMediaData',
  'WAWebMediaEntry',
  'WAWebSendMsgChatAction',
  'WAWebSendTextMsgChatAction',
]

function describeFunction(fn) {
  // The parameter list, taken from the source text. Minified builds keep
  // argument NAMES meaningless but the COUNT and any default values survive,
  // and the count is what says whether a call site is plausible.
  var src = ''
  try { src = String(fn).slice(0, 240) } catch (e) { src = '[unreadable]' }
  return { arity: fn.length, sourceHead: src.replace(/\s+/g, ' ') }
}

function describe(value, depth) {
  if (value === null || value === undefined) return null
  var type = typeof value
  if (type !== 'object' && type !== 'function') return type + ':' + String(value).slice(0, 60)

  var out = { type: type }
  if (type === 'function') {
    out.fn = describeFunction(value)
    var protoKeys = []
    try { protoKeys = Object.getOwnPropertyNames(value.prototype || {}) } catch (e) {}
    if (protoKeys.length) out.prototypeMethods = protoKeys.slice(0, 40)
  }

  var keys = []
  try { keys = Object.keys(value) } catch (e) {}
  out.keys = keys.slice(0, 40)

  // One level down only, and only for the exports object — enough to see
  // whether the interesting function is `mod.default` or `mod.MediaCollection`
  // without dumping a framework.
  if (depth === 0 && keys.length) {
    out.members = {}
    for (var i = 0; i < keys.length && i < 20; i++) {
      try { out.members[keys[i]] = describe(value[keys[i]], depth + 1) } catch (e) { out.members[keys[i]] = '[unreadable]' }
    }
  }
  return out
}

var report = {}
for (var i = 0; i < TARGETS.length; i++) {
  var name = TARGETS[i]
  try {
    report[name] = describe(window.require(name), 0)
  } catch (e) {
    report[name] = { error: String((e && e.message) || e).slice(0, 160) }
  }
}

return report
