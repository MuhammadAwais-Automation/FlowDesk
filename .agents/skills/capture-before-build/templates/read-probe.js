// @target example.com
//
// READ-ONLY. Nothing is clicked, created, changed or deleted.
//
// Start every investigation here. A read probe costs seconds and answers the
// question that would otherwise be answered by an assumption.
//
// Say at the top what question this probe is asking and why, so the next person
// (often you, later) does not have to reconstruct it from the code.

// ── Reading the DOM ────────────────────────────────────────────────
//
// Describe elements rather than dumping them. A full element does not survive
// the crossing back and a wall of markup is harder to read than six fields.
function describe(el) {
  var rect = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/[ ]+/g, ' ').trim().slice(0, 40),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    role: el.getAttribute('role'),
    // Only include framework attributes if you are checking whether they exist
    // on THIS page — that is usually the actual question.
    viewName: el.getAttribute('data-view-name'),
    rect: Math.round(rect.width) + 'x' + Math.round(rect.height),
  }
}

// Controls that might be the one you want. Filter to something plausible rather
// than returning every button on the page.
var candidates = []
var buttons = document.querySelectorAll('button, [role="button"], a[aria-label]')
for (var i = 0; i < buttons.length && candidates.length < 25; i++) {
  var haystack = (
    (buttons[i].innerText || '') + ' ' + (buttons[i].getAttribute('aria-label') || '')
  ).toLowerCase()
  if (/send|post|submit|connect|delete|reply/.test(haystack)) {
    var r = buttons[i].getBoundingClientRect()
    if (r.width > 4) candidates.push(describe(buttons[i]))
  }
}

// ── Reading an API ─────────────────────────────────────────────────
//
// GETs only in a read probe. If you are checking whether a route exists at all,
// use endpoint-guess-probe.js instead — it explains how to do that without
// triggering the thing.
function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)   // adapt to the site
  return m ? m[1] : null
}

async function api(url) {
  var r = await fetch(url, {
    credentials: 'include',
    headers: {
      'csrf-token': csrf(),
      // The accept header decides the SHAPE of the response on some APIs, not
      // just its encoding. Copy the one the site itself sends.
      'accept': 'application/json',
    },
  })
  var text = await r.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) { /* non-JSON is itself the answer */ }
  return { status: r.status, json: json, raw: text }
}

var me = await api('/api/me')

return {
  // Always report where this ran. A probe that silently ran on the wrong page
  // produces answers that look real and describe something else.
  href: location.href,
  onExpectedPage: location.pathname.indexOf('/expected/') === 0,

  candidates: candidates,
  meStatus: me.status,

  // Report counts and paths, not other people's names and messages — a probe
  // result is a file on disk.
  itemCount: (me.json && me.json.elements && me.json.elements.length) || null,
  topLevelKeys: me.json ? Object.keys(me.json).slice(0, 12) : null,
}
