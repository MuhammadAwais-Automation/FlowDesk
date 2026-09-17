// @target flow.google.com
//
// READ-ONLY. Nothing is created, changed or deleted.
//
// Question: the captured project-list request carries four values that did not
// come from the URL — `at`, `f.sid`, `bl` and the rpcid. The rpcid (UpteDb) is
// in the capture, but the other three are per-session and must come from the
// page itself. This asks WHERE, so the bridge reads them instead of hardcoding
// values that expire.
//
// Captured for reference (2026-09-17):
//   at=AIQ-s5hbYVwUantY78CX2J0tO-4c:1789653174680
//   f.sid=-8944230479885007359
//   bl=boq_labs-ai-sandbox-frontend_20260915.10_p0

var wiz = window.WIZ_global_data || null

// Report which key holds each captured value rather than assuming the usual
// names: a wrong-but-plausible key would fail only at request time, and look
// like an auth problem rather than a lookup problem.
function keysHolding(object, predicate) {
  if (!object) return []
  var found = []
  for (var key in object) {
    try {
      var value = object[key]
      if (typeof value === 'string' && predicate(value)) found.push({ key: key, sample: value.slice(0, 40) })
    } catch (e) { /* getter threw */ }
  }
  return found
}

return {
  url: location.href,
  hasWizGlobalData: Boolean(wiz),
  wizKeyCount: wiz ? Object.keys(wiz).length : 0,

  // The xsrf-ish token. In boq apps this is conventionally SNlM0e, but report
  // by shape so the answer does not depend on that convention holding.
  tokenLooking: keysHolding(wiz, function (v) { return v.indexOf('AIQ-') === 0 || /^[\w-]{20,}:\d{10,}$/.test(v) }),

  // The build label that goes in `bl=`.
  buildLooking: keysHolding(wiz, function (v) { return v.indexOf('boq_') === 0 }),

  // f.sid is a signed 64-bit-looking integer, often exposed as FdrFJe.
  sidLooking: keysHolding(wiz, function (v) { return /^-?\d{15,}$/.test(v) }),

  // Fallbacks in case the page does not expose them on WIZ_global_data at all.
  htmlHasSNlM0e: document.documentElement.innerHTML.indexOf('SNlM0e') !== -1,
  htmlHasBoqLabel: (document.documentElement.innerHTML.match(/boq_labs-ai-sandbox-frontend_[\w.]+/) || [null])[0],
}
