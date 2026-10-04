/**
 * Autonomous Discovery Toolkit — client-side runtime injected into web views.
 *
 * Provides high-level action primitives for autonomous reverse-engineering
 * without fragile manual DOM hacking:
 * - Smart typing (native input setter + Draft.js / Lexical execCommand support)
 * - Synthetic clicking (pointer & mouse event chains)
 * - Switch / checkbox toggling
 * - Virtual file injection (DataTransfer + File + Blob)
 * - Action-level network capture (temporary fetch/XHR hook with guaranteed teardown)
 * - DOM waiting and polling
 * - Host-injected file descriptors (probe.files)
 */

export interface HostInjectedFile {
  name: string
  type: string
  size: number
  base64: string
}

export const PROBE_TOOLKIT_SCRIPT = `
(function () {
  if (window.__fdProbeToolkitInstalled) return
  window.__fdProbeToolkitInstalled = true

  var probe = {
    files: {},

    sleep: function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms) })
    },

    waitFor: async function (selectorOrFn, opts) {
      opts = opts || {}
      var timeoutMs = opts.timeoutMs || 15000
      var intervalMs = opts.intervalMs || 100
      var start = Date.now()

      while (Date.now() - start < timeoutMs) {
        try {
          if (typeof selectorOrFn === 'function') {
            var res = await selectorOrFn()
            if (res) return res
          } else {
            var el = document.querySelector(selectorOrFn)
            if (el) {
              if (opts.visible) {
                var rect = el.getBoundingClientRect()
                var style = window.getComputedStyle(el)
                if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none') {
                  return el
                }
              } else {
                return el
              }
            }
          }
        } catch (e) {}
        await probe.sleep(intervalMs)
      }
      var targetDesc = typeof selectorOrFn === 'function' ? 'condition function' : '"' + selectorOrFn + '"'
      throw new Error('waitFor timed out after ' + timeoutMs + 'ms waiting for ' + targetDesc)
    },

    query: function (selector) {
      return document.querySelector(selector)
    },

    queryAll: function (selector) {
      return Array.from(document.querySelectorAll(selector))
    },

    resolveElement: function (target) {
      if (typeof target === 'string') {
        var el = document.querySelector(target)
        if (!el) throw new Error('Element not found for selector: ' + target)
        return el
      }
      if (target && target.nodeType === 1) return target
      throw new Error('Invalid target: expected selector string or DOM Element')
    },

    click: async function (target, opts) {
      opts = opts || {}
      var el = probe.resolveElement(target)

      try {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
      } catch (e) {}

      try {
        if (typeof el.focus === 'function') el.focus()
      } catch (e) {}

      var rect = el.getBoundingClientRect()
      var cx = rect.left + rect.width / 2
      var cy = rect.top + rect.height / 2

      var eventOpts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: cx,
        clientY: cy,
      }

      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerdown', eventOpts))
      }
      el.dispatchEvent(new MouseEvent('mousedown', eventOpts))

      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerup', eventOpts))
      }
      el.dispatchEvent(new MouseEvent('mouseup', eventOpts))
      el.dispatchEvent(new MouseEvent('click', eventOpts))

      if (opts.dblClick) {
        el.dispatchEvent(new MouseEvent('dblclick', eventOpts))
      }

      if (opts.waitAfterMs) {
        await probe.sleep(opts.waitAfterMs)
      }
      return el
    },

    type: async function (target, text, opts) {
      opts = opts || {}
      var el = probe.resolveElement(target)

      try {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
      } catch (e) {}

      try {
        if (typeof el.focus === 'function') el.focus()
      } catch (e) {}

      var isInputOrTextarea = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      var isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.closest('[contenteditable="true"]')

      if (isInputOrTextarea) {
        var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

        if (opts.clear !== false) {
          if (setter) setter.call(el, '')
          else el.value = ''
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }

        if (setter) setter.call(el, text)
        else el.value = text

        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (isContentEditable) {
        var editRoot = el.isContentEditable ? el : el.closest('[contenteditable="true"]') || el
        try { editRoot.focus() } catch (e) {}

        var sel = window.getSelection()
        var range = document.createRange()
        range.selectNodeContents(editRoot)
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range)
        }

        if (opts.clear !== false) {
          try {
            document.execCommand('delete', false, null)
          } catch (e) {}
        }

        var success = false
        try {
          success = document.execCommand('insertText', false, text)
        } catch (e) {}

        if (!success) {
          // Fallback if execCommand was disabled
          editRoot.textContent = text
        }

        editRoot.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        editRoot.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      } else {
        // Generic fallback
        el.textContent = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }

      if (opts.waitAfterMs) {
        await probe.sleep(opts.waitAfterMs)
      }
      return el
    },

    setSwitch: async function (target, checked, opts) {
      opts = opts || {}
      var el = probe.resolveElement(target)

      var currentlyChecked = false
      if ('checked' in el) {
        currentlyChecked = Boolean(el.checked)
      } else if (el.hasAttribute('aria-checked')) {
        currentlyChecked = el.getAttribute('aria-checked') === 'true'
      } else if (el.hasAttribute('data-state')) {
        currentlyChecked = el.getAttribute('data-state') === 'checked'
      }

      if (currentlyChecked !== checked) {
        await probe.click(el, opts)
        return { element: el, changed: true, checked: checked }
      }
      return { element: el, changed: false, checked: currentlyChecked }
    },

    injectFile: async function (target, fileData) {
      if (!fileData || !fileData.base64) {
        throw new Error('probe.injectFile requires fileData with base64 string')
      }

      var el = probe.resolveElement(target)
      var input = el instanceof HTMLInputElement && el.type === 'file' ? el : el.querySelector('input[type="file"]')
      if (!input) {
        throw new Error('No input[type="file"] found on or inside target')
      }

      var byteChars = atob(fileData.base64)
      var byteNumbers = new Uint8Array(byteChars.length)
      for (var i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i)
      }

      var mimeType = fileData.mimeType || fileData.type || 'application/octet-stream'
      var filename = fileData.filename || fileData.name || 'upload'
      var blob = new Blob([byteNumbers], { type: mimeType })
      var file = new File([blob], filename, { type: mimeType, lastModified: Date.now() })

      var dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))

      return {
        injected: true,
        filename: filename,
        size: byteNumbers.length,
        mimeType: mimeType,
      }
    },

    captureNetwork: async function (actionFn, opts) {
      opts = opts || {}
      var captured = []
      var origFetch = window.fetch
      var origXhrOpen = XMLHttpRequest.prototype.open
      var origXhrSend = XMLHttpRequest.prototype.send

      // Hook Fetch
      window.fetch = async function () {
        var args = Array.prototype.slice.call(arguments)
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || String(args[0])
        var init = args[1] || {}
        var method = (init.method || (args[0] && args[0].method) || 'GET').toUpperCase()
        var startTime = Date.now()

        var reqEntry = {
          type: 'fetch',
          url: url,
          method: method,
          requestHeaders: init.headers || {},
          postData: init.body ? String(init.body).slice(0, 4000) : undefined,
          startedAt: startTime,
        }

        try {
          var response = await origFetch.apply(this, args)
          var clone = response.clone()
          reqEntry.status = response.status
          reqEntry.durationMs = Date.now() - startTime
          try {
            var text = await clone.text()
            reqEntry.responseBody = text.slice(0, 10000)
            try { reqEntry.responseJson = JSON.parse(text) } catch (e) {}
          } catch (e) {
            reqEntry.responseError = String(e)
          }
          captured.push(reqEntry)
          return response
        } catch (err) {
          reqEntry.error = String(err)
          reqEntry.durationMs = Date.now() - startTime
          captured.push(reqEntry)
          throw err
        }
      }

      // Hook XHR
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__fdReq = {
          type: 'xhr',
          method: String(method).toUpperCase(),
          url: String(url),
          startedAt: Date.now(),
        }
        return origXhrOpen.apply(this, arguments)
      }

      XMLHttpRequest.prototype.send = function (body) {
        var self = this
        if (self.__fdReq) {
          if (body) self.__fdReq.postData = String(body).slice(0, 4000)
          self.addEventListener('loadend', function () {
            self.__fdReq.status = self.status
            self.__fdReq.durationMs = Date.now() - self.__fdReq.startedAt
            try {
              if (self.responseText) {
                self.__fdReq.responseBody = self.responseText.slice(0, 10000)
                try { self.__fdReq.responseJson = JSON.parse(self.responseText) } catch (e) {}
              }
            } catch (e) {}
            captured.push(self.__fdReq)
          })
        }
        return origXhrSend.apply(this, arguments)
      }

      try {
        var actionResult = await actionFn()
        if (opts.waitAfterMs) {
          await probe.sleep(opts.waitAfterMs)
        }
        return { ok: true, result: actionResult, requests: captured }
      } finally {
        window.fetch = origFetch
        XMLHttpRequest.prototype.open = origXhrOpen
        XMLHttpRequest.prototype.send = origXhrSend
      }
    },

    info: function () {
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
      }
    },
  }

  window.probe = probe
})()
`
