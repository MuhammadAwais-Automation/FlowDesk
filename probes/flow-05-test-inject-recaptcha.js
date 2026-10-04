// @target flow.google.com
//
// Probe: Test creating policy, injecting script, and getting token

var RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'

return new Promise(function(resolve) {
  try {
    var tt = window.trustedTypes
    var policy = window.__flowRecaptchaPolicy
    if (!policy && tt && tt.createPolicy) {
      try {
        policy = tt.createPolicy('flowdesk-loader', {
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
    script.async = true
    document.head.appendChild(script)

    var elapsed = 0
    var interval = setInterval(function() {
      elapsed += 150
      if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.ready === 'function') {
        clearInterval(interval)
        window.grecaptcha.enterprise.ready(function() {
          window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: 'IMAGE_GENERATION' })
            .then(function(token) {
              resolve({
                ok: true,
                elapsed: elapsed,
                tokenLength: token.length,
                tokenPrefix: token.slice(0, 30)
              })
            })
            .catch(function(err) {
              resolve({ ok: false, error: 'execute error: ' + String(err) })
            })
        })
      } else if (elapsed > 10000) {
        clearInterval(interval)
        resolve({
          ok: false,
          elapsed: elapsed,
          error: 'Timed out waiting for grecaptcha.enterprise',
          hasGrecaptcha: Boolean(window.grecaptcha)
        })
      }
    }, 150)
  } catch (e) {
    resolve({ ok: false, error: 'catch: ' + String(e) })
  }
})
