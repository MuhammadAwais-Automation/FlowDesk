// @target flow.google.com
//
// READ-ONLY. Spends no credits, creates nothing.
//
// Question: the old flowGetCredits called a labs.google tRPC route that is now
// dead. In the 2026-09-17 capture, rpcid `nzlxg` was sent with an empty
// argument and answered [1050,1,2,2,null,1050] on a page that had just loaded.
// Is that the credit balance, and can it be called on demand?
//
// 1050 matching a plausible credit balance is suggestive, not proof — this
// replays the call and reports the raw numbers so the shape can be read rather
// than assumed. Naming the fields is a separate step that needs the balance to
// be known independently (e.g. read off the Flow UI) before any mapping is
// trusted.

var wiz = window.WIZ_global_data
if (!wiz || !wiz.SNlM0e) return { ok: false, error: 'no WIZ_global_data.SNlM0e on this page yet' }

async function callRpc(rpcId, argArray) {
  var body = new URLSearchParams()
  body.set('f.req', JSON.stringify([[[rpcId, JSON.stringify(argArray), null, 'generic']]]))
  body.set('at', wiz.SNlM0e)

  var query = new URLSearchParams()
  query.set('rpcids', rpcId)
  query.set('source-path', '/')
  if (wiz.cfb2h) query.set('bl', wiz.cfb2h)
  if (wiz.FdrFJe) query.set('f.sid', wiz.FdrFJe)
  query.set('hl', 'en-US')
  query.set('_reqid', String(Math.floor(Math.random() * 900000) + 100000))
  query.set('rt', 'c')

  var res = await fetch('/_/AiSandboxAngularFrontend/data/batchexecute?' + query.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
  })
  var text = await res.text()

  var payload = null
  var lines = text.split(String.fromCharCode(10))
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line.charAt(0) !== '[') continue
    var rows = null
    try { rows = JSON.parse(line) } catch (e) { continue }
    if (!Array.isArray(rows)) continue
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j]
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && typeof row[2] === 'string') {
        try { payload = JSON.parse(row[2]) } catch (e) {}
      }
    }
  }
  return { status: res.status, payload: payload, raw: payload === null ? text.slice(0, 200) : null }
}

return {
  // The suspected credits call.
  nzlxg: await callRpc('nzlxg', []),
  // Captured alongside it with argument [null,22]; unidentified. Read-only by
  // the same reasoning -- it answered [] on page load, so it returns state.
  NfrxTb: await callRpc('NfrxTb', [null, 22]),
}
