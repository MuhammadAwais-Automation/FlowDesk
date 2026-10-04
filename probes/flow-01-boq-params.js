// @target flow.google.com
//
// Probe: Test recaptcha enterprise injection WITH nonce and TrustedScriptURL

var RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'

var nonceEl = document.querySelector('script[nonce]')
var nonce = nonceEl ? (nonceEl.nonce || nonceEl.getAttribute('nonce')) : ''

var tt = window.trustedTypes
var policy = window.__flowRecaptchaPolicy
if (!policy && tt && tt.createPolicy) {
  try {
    policy = tt.createPolicy('flowdesk-loader-nonce-async', {
      createScriptURL: function(url) { return url }
    })
    window.__flowRecaptchaPolicy = policy
  } catch (e) {
    policy = window.__flowRecaptchaPolicy
  }
}

var scriptUrl = 'https://www.google.com/recaptcha/enterprise.js?render=' + RECAPTCHA_SITE_KEY
var trustedUrl = policy ? policy.createScriptURL(scriptUrl) : scriptUrl

var script = document.createElement('script')
script.src = trustedUrl
if (nonce) script.nonce = nonce
script.async = true
document.head.appendChild(script)

// Wait up to 10 seconds for grecaptcha.enterprise
var start = Date.now()
while (Date.now() - start < 10000) {
  if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.ready === 'function') {
    break
  }
  await new Promise(function(r) { setTimeout(r, 100) })
}

if (!window.grecaptcha || !window.grecaptcha.enterprise) {
  return { ok: false, error: 'Timed out waiting for grecaptcha.enterprise', hasGrecaptcha: Boolean(window.grecaptcha), nonce: nonce }
}

var token = await new Promise(function(resolve, reject) {
  window.grecaptcha.enterprise.ready(function() {
    window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: 'IMAGE_GENERATION' })
      .then(resolve)
      .catch(reject)
  })
})

return {
  ok: true,
  nonce: nonce,
  tokenLength: token.length,
  tokenSample: token.slice(0, 40)
}
