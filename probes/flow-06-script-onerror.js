// @target flow.google.com
//
// Probe: Check script onload and onerror events

var RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'

return new Promise(function(resolve) {
  try {
    var tt = window.trustedTypes
    var policy = window.__flowRecaptchaPolicy
    if (!policy && tt && tt.createPolicy) {
      try {
        policy = tt.createPolicy('flowdesk-loader-2', {
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
    script.onload = function() {
      resolve({ event: 'onload', hasGrecaptcha: Boolean(window.grecaptcha) })
    }
    script.onerror = function(e) {
      resolve({ event: 'onerror', error: String(e) })
    }
    document.head.appendChild(script)

    setTimeout(function() {
      resolve({ event: 'timeout', hasGrecaptcha: Boolean(window.grecaptcha) })
    }, 4000)
  } catch (err) {
    resolve({ event: 'throw', error: String(err) })
  }
})
