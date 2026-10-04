// @target flow.google.com
//
// Probe: Inspect trustedTypes, policies, and test reCAPTCHA loading

var tt = window.trustedTypes || null
var policies = []
var defaultPolicy = null
var createdPolicy = null
var error = null

if (tt) {
  defaultPolicy = Boolean(tt.defaultPolicy)
  // Check if we can create a policy or use an existing one
  try {
    var p = tt.createPolicy('flowdesk-recaptcha', {
      createScriptURL: function(url) { return url }
    })
    createdPolicy = Boolean(p)
  } catch (e) {
    error = String(e)
  }
}

return {
  url: location.href,
  hasTrustedTypes: Boolean(tt),
  defaultPolicy: defaultPolicy,
  createdPolicy: createdPolicy,
  error: error,
  hasGrecaptcha: Boolean(window.grecaptcha),
  hasGrecaptchaEnterprise: Boolean(window.grecaptcha && window.grecaptcha.enterprise),
  existingScripts: Array.from(document.querySelectorAll('script')).map(function(s) {
    return (s.src || '').slice(0, 100)
  }).filter(Boolean)
}
