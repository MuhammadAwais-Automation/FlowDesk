// @target flow.google.com
//
// Probe: Check script nonces and CSP on flow.google.com

var scripts = Array.from(document.querySelectorAll('script'))
var nonces = scripts.map(function(s) { return s.nonce }).filter(Boolean)
var metaCsp = Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).map(function(m) {
  return m.content
})

return {
  nonces: nonces,
  metaCsp: metaCsp,
  sampleScripts: scripts.map(function(s) {
    return {
      src: (s.src || '').slice(0, 120),
      nonce: s.nonce,
      id: s.id
    }
  })
}
