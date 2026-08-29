// @target example.com
//
// ⚠ WRITE PROBE — DELETE THIS FILE THE MOMENT IT HAS RUN.
//
// The harness runs a probe whenever its file is SAVED. A write probe left on
// disk fires again on the next Ctrl+S, with no edit and no warning. That is not
// hypothetical; it is why this warning is the first thing in the file.
//
// Before running this, answer three questions in the header below:
//   1. What exactly will change, on whose account?
//   2. How does it get undone?
//   3. What would prove it did NOT happen, if it did not?
//
// WHAT THIS CHANGES:  <fill in — be specific about who sees it>
// HOW IT IS UNDONE:   <fill in — or say "cannot be undone" and reconsider>
// PROOF OF FAILURE:   <fill in — the value that differs if this did nothing>

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)   // adapt to the site
  return m ? m[1] : null
}

async function api(url, options) {
  options = options || {}
  var headers = {
    'csrf-token': csrf(),
    // Copy these from the capture. The accept header in particular decides the
    // shape of the response on some APIs.
    'accept': 'application/json',
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json; charset=UTF-8'
  var r = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: headers,
    body: options.body,
  })
  var text = await r.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) {}
  return { status: r.status, json: json, text: json ? null : text.slice(0, 300) }
}

var steps = []

// ── Prefer a reversible test vehicle ───────────────────────────────
//
// Before testing a destructive or public action on something real, look for a
// state that is safe to create and remove: a draft, an action already in the
// state you would create, or a deliberately wrong argument that should make a
// guard refuse. Verify the guard fires BEFORE verifying the action works.

var created = await api('/api/thing', {
  method: 'POST',
  body: JSON.stringify({ /* the captured payload shape, copied exactly */ }),
})
steps.push({ step: 'create', status: created.status })

// ── Success is what the server said ────────────────────────────────
//
// A 200 is the request being accepted, not the thing existing. Require the
// identifier the response carries; without it, this failed.
var id = null
try { id = created.json && created.json.data && created.json.data.value && created.json.data.value.id } catch (e) {}

if (created.status !== 200 || !id) {
  return {
    ok: false,
    error: 'not confirmed (HTTP ' + created.status + ')',
    // The site's own error code says far more than the status. "already exists"
    // and "quota spent" are different problems that HTTP 400 flattens into one.
    code: (created.json && created.json.data && created.json.data.code) || null,
    detail: created.text,
    steps: steps,
  }
}

// ── Clean up whatever this made ────────────────────────────────────
var removed = await api('/api/thing/' + encodeURIComponent(id), { method: 'DELETE' })
steps.push({ step: 'delete', status: removed.status })

// ── Verify by reading back, not by trusting the status ─────────────
await new Promise(function (r) { setTimeout(r, 1200) })
var check = await api('/api/thing/' + encodeURIComponent(id))

return {
  ok: check.status !== 200,
  id: id,
  steps: steps,
  stillPresent: check.status === 200,
  // If cleanup failed, say so loudly — something was left on a real account.
  summary: check.status === 200
    ? 'CREATED BUT NOT REMOVED — it is still on the account and must be deleted by hand'
    : 'created and removed cleanly',
}

// REMINDER: delete this file now.
