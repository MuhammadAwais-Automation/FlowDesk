// @target linkedin.com
//
// Navigation only. Nothing is created, changed or deleted.
//
// The queryId sweep (li-36) reads whatever bundles the CURRENT page loaded, and
// the feed does not load the analytics client — so analytics ids were absent
// there, which is not evidence they do not exist. Loading the analytics page
// makes both its bundle and its real requests available: the sweep can be rerun
// against it, and the CDP recorder captures the calls it makes on load.
//
// Returns before navigating so the result survives the context teardown.
var TARGET = 'https://www.linkedin.com/analytics/creator/content/'
setTimeout(function () { location.href = TARGET }, 50)
return { navigatingTo: TARGET, from: location.href }
