// @target linkedin.com
//
// READ-ONLY. Fetches scripts the page has already loaded and reads strings out
// of them. No API is called, nothing is created, changed or deleted.
//
// Why this beats capturing one action at a time: a GraphQL queryId is a
// build-specific hash, and the only ones seen so far are the ones that happened
// to run — 34 of them, all from features that were used. Discovering "delete a
// post" by capture means performing a real deletion first, and discovering
// "schedule a post" means scheduling one. That is a poor trade when the ids are
// sitting in the client bundle in plain text.
//
// The ids alone are not enough to call anything — the variables shape still has
// to be right — but they say which operations EXIST, which is what decides what
// is worth building and what is not there at all.

var pattern = /(?:voyager|liveVideo)[A-Za-z]+\.[0-9a-f]{32}/g

// Scripts live in the iframe, not the top document — li-35 established that
// the visible LinkedIn UI runs inside a same-origin iframe at
// /preload/?_bprMode=vanilla, and the captured post request confirmed it by
// carrying that page as its Referer. A first version of this probe scanned only
// the top document and found zero scripts.
//
// Cross-origin bundles are included too: LinkedIn serves its client from
// static.licdn.com, which is a different origin from www.linkedin.com, so
// restricting to same-origin would have excluded exactly the files worth
// reading. Whether they can actually be read is reported per failure rather
// than assumed either way.
var scripts = []
var hosts = {}

function collectFrom(doc, where) {
  try {
    var tags = doc.querySelectorAll('script[src]')
    for (var i = 0; i < tags.length; i++) {
      var src = tags[i].src
      if (!src) continue
      try { hosts[new URL(src).host] = (hosts[new URL(src).host] || 0) + 1 } catch (e) {}
      scripts.push({ src: src, where: where })
    }
  } catch (e) {}
}

collectFrom(document, 'top')

var frames = document.querySelectorAll('iframe')
for (var i = 0; i < frames.length; i++) {
  try {
    var doc = frames[i].contentDocument
    if (doc) collectFrom(doc, 'iframe:' + String(frames[i].getAttribute('src') || '').slice(0, 40))
  } catch (e) { /* cross-origin frame — nothing to collect */ }
}

var found = {}
var fetched = 0
var failed = []

for (var i = 0; i < scripts.length && i < 60; i++) {
  try {
    var res = await fetch(scripts[i].src, { credentials: 'omit' })
    if (!res.ok) { failed.push(res.status + ' ' + scripts[i].src.slice(-40)); continue }
    var text = await res.text()
    fetched++
    var m = text.match(pattern)
    if (m) {
      for (var j = 0; j < m.length; j++) found[m[j]] = (found[m[j]] || 0) + 1
    }
  } catch (e) {
    failed.push(String((e && e.message) || e).slice(0, 40))
  }
}

var all = Object.keys(found).sort()

// Grouped by what they are for, which is the question actually being asked.
// A name that matches nothing still appears in `everything`, so a wrong guess
// about the naming here cannot hide an operation.
var buckets = {
  posting: /Shares|Sharebox|Contentcreation/i,
  feedUpdates: /FeedDashUpdate|FeedDashProfileUpdate/i,
  socialActions: /SocialDash|Reaction|Comment/i,
  analytics: /Analytic|Insight|Impression|CreatorDash/i,
  invitations: /Invitation|Invite|Connect|Relationship|MyNetwork/i,
  profile: /IdentityDashProfile/i,
}

var grouped = {}
for (var key in buckets) {
  grouped[key] = all.filter(function (id) { return buckets[key].test(id) })
}

return {
  href: location.href,
  scriptsSeen: scripts.length,
  scriptHosts: hosts,
  scriptsFetched: fetched,
  failures: failed.slice(0, 6),
  totalQueryIds: all.length,
  grouped: grouped,
  everything: all,
}

// re-save 1787490509

// resave 1787533501
