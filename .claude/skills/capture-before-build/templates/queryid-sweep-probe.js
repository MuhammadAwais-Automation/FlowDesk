// @target example.com
//
// READ-ONLY. Fetches scripts the page has already loaded and reads identifiers
// out of them. No API is called; nothing is created, changed or deleted.
//
// What this is for: answering "does an operation for X exist at all?" without
// performing X. Sites that use GraphQL identify operations by a build hash, and
// the client bundle contains every hash it can use — including for features
// nobody has touched this session.
//
// On the project this came from, a capture had surfaced 34 identifiers (only
// the ones that happened to run). This sweep found 937. That difference is what
// separates "there is no API for deleting a post" from "here is the operation,
// go capture one delete to learn its arguments".
//
// The identifiers alone are NOT enough to call anything — the variables shape
// still has to come from a real capture. What they tell you is what exists,
// which is what decides whether something is worth pursuing.

// Adapt this to the site. Most GraphQL clients use <namespace>.<hex hash>.
var PATTERN = /(?:voyager|liveVideo)[A-Za-z]+\.[0-9a-f]{32}/g

// ── Where the scripts actually are ─────────────────────────────────
//
// Two things that made a first version of this return zero:
//
//   1. The visible app may run inside an IFRAME. Scanning only the top document
//      found no scripts at all on a page that was plainly running JavaScript.
//   2. The bundle is usually served from a CDN on a DIFFERENT origin. Restricting
//      to same-origin excludes exactly the files worth reading.
//
// So: collect from every frame that can be read, and fetch cross-origin too —
// reporting per-failure rather than assuming either way.
var scripts = []
var hosts = {}

function collectFrom(doc) {
  try {
    var tags = doc.querySelectorAll('script[src]')
    for (var i = 0; i < tags.length; i++) {
      var src = tags[i].src
      if (!src) continue
      try { hosts[new URL(src).host] = (hosts[new URL(src).host] || 0) + 1 } catch (e) {}
      scripts.push(src)
    }
  } catch (e) { /* cross-origin frame — nothing to collect */ }
}

collectFrom(document)
var frames = document.querySelectorAll('iframe')
for (var i = 0; i < frames.length; i++) {
  try { if (frames[i].contentDocument) collectFrom(frames[i].contentDocument) } catch (e) {}
}

var found = {}
var fetched = 0
var failed = []

for (var i = 0; i < scripts.length && i < 60; i++) {
  try {
    // credentials omitted: these are public static assets, and sending cookies
    // to a CDN achieves nothing except putting them somewhere they need not be.
    var res = await fetch(scripts[i], { credentials: 'omit' })
    if (!res.ok) { failed.push(res.status + ' ' + scripts[i].slice(-40)); continue }
    var text = await res.text()
    fetched++
    var matches = text.match(PATTERN)
    if (matches) {
      for (var j = 0; j < matches.length; j++) found[matches[j]] = true
    }
  } catch (e) {
    failed.push(String((e && e.message) || e).slice(0, 40))
  }
}

var all = Object.keys(found).sort()

// Grouped by what you are actually asking about. Anything unmatched still
// appears in `everything`, so a wrong guess about naming cannot hide an
// operation — which would be the one failure mode that matters here.
var buckets = {
  creating: /create|share|post|compose|upload/i,
  deleting: /delete|remove|withdraw|archive/i,
  social: /comment|reaction|like|follow/i,
  network: /invit|connect|relationship|network/i,
  analytics: /analytic|insight|impression|metric/i,
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
  totalFound: all.length,
  grouped: grouped,
  everything: all,
}

// Note: this reads whatever bundles the CURRENT page loaded. A feature's client
// is often only loaded on its own page, so an empty bucket here is not evidence
// the operation does not exist — navigate to that part of the app and re-run
// before concluding anything.
