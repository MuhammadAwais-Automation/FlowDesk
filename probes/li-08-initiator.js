// @target linkedin.com
// READ-ONLY. The watcher hooks window.fetch and never saw /realtime/connect.
// Either LinkedIn opened it before injection, or it is not a fetch at all.
// PerformanceResourceTiming.initiatorType answers that directly — the browser
// records how every request was started, whoever started it.
var entries = performance.getEntriesByType('resource')
var realtime = entries.filter(function (e) { return e.name.indexOf('/realtime/') !== -1 })
var streams = entries.filter(function (e) {
  return e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch' || e.initiatorType === 'other'
})

var counts = {}
entries.forEach(function (e) { counts[e.initiatorType] = (counts[e.initiatorType] || 0) + 1 })

return {
  href: location.href,
  totalResourceEntries: entries.length,
  initiatorTypeCounts: counts,
  realtimeEntries: realtime.map(function (e) {
    return {
      name: e.name.slice(0, 120),
      initiatorType: e.initiatorType,
      startTime: Math.round(e.startTime),
      duration: Math.round(e.duration),
      responseEnd: Math.round(e.responseEnd),
      transferSize: e.transferSize,
    }
  }),
  // When the watcher installed, relative to the page timeline. If the realtime
  // request starts before this, timing is the whole explanation.
  watcherInstalledAtPageTime: window.__fdLiRealtime
    ? Math.round(window.__fdLiRealtime.status().installedAt - performance.timeOrigin)
    : null,
  fetchIsWrapped: typeof window.fetch === 'function' && !/\[native code\]/.test(String(window.fetch)),
  xhrOpenIsNative: /\[native code\]/.test(String(XMLHttpRequest.prototype.open)),
  eventSourceIsNative: /\[native code\]/.test(String(window.EventSource)),
}
