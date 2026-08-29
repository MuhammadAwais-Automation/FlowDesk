// @target facebook.com
//
// READ-ONLY. Nothing is clicked, created, changed or deleted.
//
// First question: is this session signed in, and what does the page's own
// structure look like — same-origin iframes, GraphQL fingerprints (fb_dtsg,
// doc_id patterns), and whether data-view-name-style tagging exists here the
// way it did on LinkedIn. Nothing assumed from that project carries over
// automatically.

function textOf(doc) {
  try { return (doc.body && doc.body.innerText || '').replace(/\s+/g, ' ') } catch (e) { return '' }
}

var frames = document.querySelectorAll('iframe')
var frameInfo = []
for (var i = 0; i < frames.length; i++) {
  var f = frames[i]
  var readable = false
  try { readable = !!f.contentDocument } catch (e) {}
  frameInfo.push({ src: String(f.getAttribute('src') || '').slice(0, 80), readable: readable })
}

// fb_dtsg is Facebook's CSRF-equivalent token, usually present as a hidden
// input or in an inline script blob. Finding it (or not) decides whether a
// direct-fetch approach is even possible.
var dtsgInput = document.querySelector('input[name="fb_dtsg"]')
var bodyText = document.body.innerText || ''
var dtsgInScripts = /"token":"([^"]{10,60})"/.exec(document.documentElement.innerHTML || '')

var taggedCount = document.querySelectorAll('[data-testid]').length
var ariaLabelCount = document.querySelectorAll('[aria-label]').length

return {
  href: location.href,
  title: document.title,
  documentReadyState: document.readyState,
  loggedInGuess: !/log in|create new account/i.test(bodyText.slice(0, 500)),
  frameCount: frames.length,
  frames: frameInfo.slice(0, 8),
  fbDtsgInputPresent: !!dtsgInput,
  fbDtsgInputValue: dtsgInput ? dtsgInput.value.slice(0, 20) + '…' : null,
  dtsgTokenFoundInHtml: !!dtsgInScripts,
  dataTestIdCount: taggedCount,
  ariaLabelCount: ariaLabelCount,
  bodyTextPreview: bodyText.slice(0, 200),
}
