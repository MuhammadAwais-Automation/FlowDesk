// @target flow.google.com
//
// Probe: Test recaptcha script injection WITH nonce and TrustedScriptURL

var RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'

return new Promise(function(resolve) {
  try {
    var nonceEl = document.querySelector('script[nonce]')
    var nonce = nonceEl ? (nonceEl.nonce || nonceEl.getAttribute('nonce')) : ''

    var tt = window.trustedTypes
    var policy = window.__flowRecaptchaPolicy
    if (!policy && tt && tt.createPolicy) {
      try {
        policy = tt.createPolicy('flowdesk-loader-nonce-2', {
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

    script.onload = function() {
      var waited = 0
      var readyInterval = setInterval(function() {
        waited += 100
        if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.ready === 'function') {
          clearInterval(readyInterval)
          window.grecaptcha.enterprise.ready(function() {
            window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: 'IMAGE_GENERATION' })
              .then(function(token) {
                resolve({
                  ok: true,
                  nonce: nonce,
                  tokenLength: token.length,
                  tokenSample: token.slice(0, 40)
                })
              })
              .catch(function(err) {
                resolve({ ok: false, error: 'execute: ' + String(err) })
              })
          })
        } else if (waited > 5000) {
          clearInterval(readyInterval)
          resolve({ ok: false, error: 'grecaptcha.enterprise not ready after load' })
        }
      }, 100)
    }

    script.onerror = function(err) {
      resolve({ ok: false, error: 'onerror fired with nonce ' + nonce })
    }

    document.head.appendChild(script)
  } catch (err) {
    resolve({ ok: false, error: 'catch: ' + String(err) })
  }
})
