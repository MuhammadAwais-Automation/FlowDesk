// @target linkedin.com
//
// Navigation only. Nothing is clicked, nothing is posted.
//
// Why this exists: FlowDesk's LinkedIn view has no address bar, so a permalink
// page cannot be opened by hand — and the like/comment tools restore the
// previous URL in their `finally` block, so by the time a probe runs the tab is
// already back on the feed. That is why li-24 kept reporting the feed.
//
// The navigation is deferred by a tick so this probe's own return value crosses
// the boundary before the execution context is torn down. Returning first and
// navigating after is the whole trick; doing it inline loses the result.

var TARGET = 'https://www.linkedin.com/feed/update/urn:li:activity:7497172606358437888/'

var before = location.href
setTimeout(function () { location.href = TARGET }, 50)

return { navigatingFrom: before, navigatingTo: TARGET, note: 'run li-24 once this has settled' }

// re-save 1787481918
