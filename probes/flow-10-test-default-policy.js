// @target flow.google.com
//
// Probe: Test defining default policy for Trusted Types so recaptcha enterprise can load its release script!

var RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'

return new Promise(function(resolve) {
  try {
    var tt = window.trustedTypes
    var defaultPolicyCreated = false
    var defaultPolicyErr = null

    if (tt && tt.createPolicy && !tt.defaultPolicy) {
      try {
        tt.createPolicy('default', {
          createScriptURL: function(url) { return url },
          createScript: function(script) { return script }
        })
        defaultPolicyCreated = true
      } catch (e) {
        defaultPolicyErr = String(e)
      }
    }

    var nonceEl = document.querySelector('script[nonce]')
    var nonce = nonceEl ? (nonceEl.nonce || nonceEl.getAttribute('nonce')) : ''

    var scriptUrl = 'https://www.google.com/recaptcha/enterprise.js?render=' + RECAPTCHA_SITE_KEY

    var script = document.createElement('script')
    script.src = scriptUrl
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
                  defaultPolicyCreated: defaultPolicyCreated,
                  tokenLength: token.length,
                  tokenSample: token.slice(0, 40)
                })
              })
              .catch(function(err) {
                resolve({ ok: false, error: 'execute: ' + String(err), defaultPolicyCreated: defaultPolicyCreated })
              })
          })
        } else if (waited > 7000) {
          clearInterval(readyInterval)
          resolve({
            ok: false,
            error: 'grecaptcha.enterprise not ready after load',
            defaultPolicyCreated: defaultPolicyCreated,
            hasGrecaptcha: Boolean(window.grecaptcha),
            hasEnterprise: Boolean(window.grecaptcha && window.grecaptcha.enterprise)
          })
        }
      }, 100)
    }

    script.onerror = function(err) {
      resolve({ ok: false, error: 'script onerror', defaultPolicyCreated: defaultPolicyCreated, defaultPolicyErr: defaultPolicyErr })
    }

    document.head.appendChild(script)
  } catch (err) {
    resolve({ ok: false, error: 'catch: ' + String(err), defaultPolicyCreated: defaultPolicyCreated, defaultPolicyErr: defaultPolicyErr })
  }
})
