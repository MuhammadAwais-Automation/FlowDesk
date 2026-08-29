// @target linkedin.com
//
// Navigation only. Nothing is typed, nothing is posted.
//
// li-32 tried three synthetic activation paths on the share box — full pointer
// sequence, Enter on the role="button", and the inner labelled div — and none
// opened the composer. That is the signature of a handler that only responds to
// trusted events, which page JavaScript cannot produce at all.
//
// Rather than reaching for CDP mouse input straight away, this tests the
// cheaper possibility: LinkedIn has long supported opening the composer from
// the URL. If that works, the tool needs no click, no coordinates and no
// dependence on where the box sits on screen — all three of which are things
// that break quietly when a layout changes.
//
// Returns before navigating so the result survives the context teardown.

var TARGET = 'https://www.linkedin.com/feed/?shareActive=true'
setTimeout(function () { location.href = TARGET }, 50)
return { navigatingTo: TARGET, from: location.href, note: 'run li-34 once this has settled' }
