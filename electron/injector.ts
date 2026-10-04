import { WebContents, clipboard } from 'electron'

export type AITool = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'perplexity' | 'deepseek'

const SELECTORS: Record<AITool, string> = {
  // The composer lost its #prompt-textarea id (live page, 2026-09-28): it is
  // now a bare ProseMirror div labelled "Ask ChatGPT". The old id stays first
  // for any page still serving it.
  chatgpt: '#prompt-textarea, div.ProseMirror[contenteditable="true"]',
  // Specifically the composer, not just any contenteditable: once the page
  // has a real viewport it renders its sidebar too, and a bare
  // [contenteditable="true"] can then resolve to a different element than
  // the one that was typed into — which showed up as the composer reading
  // back empty even on sends that actually succeeded.
  claude: '[data-testid="chat-input"]',
  // Confirmed via a real DOM dump: Gemini's composer is a Quill.js editor
  // (`div.ql-editor`), not a textarea — the old `.input-area textarea`
  // selector never matched anything. Quill also renders a second, unrelated
  // `.ql-editor.ql-clipboard` element (its internal paste-staging node,
  // parked off-screen by Quill itself) — `.textarea` is the class Gemini's
  // own wrapper adds only to the real composer, so it's what disambiguates
  // the two.
  gemini: '.ql-editor.textarea',
  // Grok's composer is a Tiptap/ProseMirror editor (confirmed from a real
  // page: `div.tiptap.ProseMirror[aria-label="Ask Grok anything"]`), not a
  // textarea. The old `textarea[placeholder]` guess matched an unrelated
  // textarea elsewhere on the page, which is why text typed "into" it came
  // out scrambled and the selector stopped matching at all once the page
  // navigated into a conversation.
  grok: '.tiptap.ProseMirror',
  // Confirmed from a real page: a bare contenteditable div, carrying no
  // aria-label, id or test id to anchor to — and the only one on the page.
  // (The previous `textarea[placeholder]` guess matched nothing here at all.)
  perplexity: 'div[contenteditable="true"]',
  deepseek: 'textarea#chat-input, textarea[placeholder*="DeepSeek"]',
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Reads the composer's current text, whatever kind of element it is. */
function readComposerSrc(selector: string): string {
  return `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      return el.value !== undefined ? el.value : (el.textContent || '')
    })()
  `
}

/**
 * Runs `fn` with the CDP debugger attached, leaving the attachment exactly
 * as it was found (DevTools being open already counts as attached, and
 * double-attaching throws).
 */
async function withDebugger<T>(webContents: WebContents, fn: () => Promise<T>): Promise<T> {
  const wasAttached = webContents.debugger.isAttached()
  if (!wasAttached) webContents.debugger.attach('1.3')
  try {
    // Real key events dispatched via Input.dispatchKeyEvent route through
    // Chromium's actual render-widget input pipeline, which normally
    // requires the target to be "the" focused page. FlowDesk's background
    // worker windows are deliberately `focusable: false` (never allowed to
    // steal real OS focus from the main window) — confirmed via real
    // terminal logs: firing dispatchKeyEvent at several such non-OS-focused
    // windows concurrently made typing silently fail ("typed text did not
    // land") on every one but whichever happened to hold actual focus.
    // Emulation.setFocusEmulationEnabled tells the renderer to treat the
    // page as focused regardless of real OS focus state, letting each
    // window's dispatched key events land independently and concurrently.
    await webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    return await fn()
  } finally {
    if (!wasAttached) {
      try { webContents.debugger.detach() } catch { /* already gone */ }
    }
  }
}

/**
 * Types into a provider's composer over the Chrome DevTools Protocol.
 *
 * Why CDP rather than webContents.sendInputEvent(): Universal Chat's worker
 * tabs are deliberately parked off-screen and are never the focused view,
 * and Electron documents that "the BrowserWindow containing the contents
 * needs to be focused for sendInputEvent() to work". Every synthetic-input
 * approach that depends on focus was tried against Claude and failed —
 * textContent assignment, execCommand with an explicit Selection, and full
 * keyDown/char/keyUp sequences all left the composer empty (or DOM-only,
 * with ProseMirror's own model never updating and the Send button never
 * appearing).
 *
 * CDP's Input domain doesn't take that path. `Input.insertText` exists to
 * "emulate text insertion that doesn't originate from keyboard presses,
 * such as an emoji keyboard or an IME" — it's delivered straight into the
 * renderer's input pipeline, producing the real beforeinput/input events
 * that ProseMirror, Quill and Lexical all key off, with no window-focus
 * requirement. It's the same mechanism Playwright and Puppeteer use, and
 * the same "go underneath the app's own layer" approach the network
 * capture already relies on.
 */
export async function injectPromptCDP(webContents: WebContents, text: string, tool: AITool, submit: boolean): Promise<boolean> {
  const selector = SELECTORS[tool]

  // Wait for the composer to exist, then focus it — Input.insertText goes
  // to whatever is focused, so this is what aims it at the right element.
  const found = await webContents.executeJavaScript(`
    (function() {
      return new Promise((resolve) => {
        const deadline = Date.now() + 8000
        function attempt() {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (el) {
            el.focus()
            const r = el.getBoundingClientRect()
            resolve({ focused: document.activeElement === el, w: Math.round(r.width), h: Math.round(r.height) })
            return
          }
          if (Date.now() > deadline) { resolve(null); return }
          setTimeout(attempt, 250)
        }
        attempt()
      })
    })()
  `) as { focused: boolean; w: number; h: number } | null

  if (!found || !found.focused) {
    console.log(`[FlowDesk inject:cdp][${tool}] composer not found / not focusable (selector: ${selector})`)
    await probeProvider(webContents)
    return false
  }
  console.log(`[FlowDesk inject:cdp][${tool}] composer focused, size=${found.w}x${found.h}`)

  return withDebugger(webContents, async () => {
    // Clear whatever is already in the composer first — a previous failed
    // send leaves its text sitting there, and typing would otherwise append
    // to it and ship both messages as one. Done as real key events for the
    // same reason the typing below is: clearing via JS wouldn't reach the
    // editor's own model.
    const mod = process.platform === 'darwin' ? 8 : 2
    const selectAll = { windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: mod }
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...selectAll })
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...selectAll })
    const del = { windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...del })
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...del })

    // 1-Shot Instant Fast Paste (replacing per-character CDP loop)
    let pasteSucceeded = false
    let prevClipboard: string | null = null

    try {
      try {
        prevClipboard = clipboard.readText()
      } catch {
        // clipboard access might throw in sandboxed environments
      }

      clipboard.writeText(text)

      const ctrlV = {
        windowsVirtualKeyCode: 86,
        nativeVirtualKeyCode: 86,
        key: 'v',
        code: 'KeyV',
        modifiers: mod,
      }
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...ctrlV })
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...ctrlV })
      pasteSucceeded = true
    } catch (err) {
      console.log(`[FlowDesk inject:cdp][${tool}] clipboard paste dispatch error:`, err)
    }

    // Confirm the text actually reached the editor rather than assuming it.
    let landed = ''
    for (let i = 0; i < 5; i++) {
      landed = (await webContents.executeJavaScript(readComposerSrc(selector))) ?? ''
      if (landed.trim().length > 0) break
      await sleep(50)
    }

    // Robust Fallback: if clipboard paste did not land, use Input.insertText + synthetic input events
    if (!landed.trim()) {
      console.log(`[FlowDesk inject:cdp][${tool}] clipboard paste did not register in composer, attempting Input.insertText fallback`)
      try {
        await webContents.debugger.sendCommand('Input.insertText', { text })
        await webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)})
            if (el) {
              el.dispatchEvent(new Event('input', { bubbles: true }))
              el.dispatchEvent(new Event('change', { bubbles: true }))
            }
          })()
        `)
      } catch (err) {
        console.log(`[FlowDesk inject:cdp][${tool}] Input.insertText fallback error:`, err)
      }

      for (let i = 0; i < 20; i++) {
        landed = (await webContents.executeJavaScript(readComposerSrc(selector))) ?? ''
        if (landed.trim().length > 0) break
        await sleep(100)
      }
    }

    // Restore previous clipboard content if we modified it
    if (pasteSucceeded && prevClipboard !== null && prevClipboard !== text) {
      try {
        clipboard.writeText(prevClipboard)
      } catch {}
    }

    if (!landed.trim()) {
      console.log(`[FlowDesk inject:cdp][${tool}] prompt text did not land in composer`)
      return false
    }
    console.log(`[FlowDesk inject:cdp][${tool}] prompt text landed (chars=${landed.length}): ${JSON.stringify(landed.slice(0, 60))}`)

    if (!submit) return true

    // Clicking the real Send button is the more dependable submit: a plain
    // .click() on a <button> works fine even in a background tab (Gemini
    // has been submitting that way all along), whereas Enter has to be
    // interpreted by the editor's own keymap. It's also only now reachable
    // — the button stays unrendered until the editor's model actually holds
    // text, which is exactly what insertText above just achieved.
    // Poll for it: the editor needs a render cycle after its model updates
    // before the button exists, so a single scan immediately after
    // insertText lands is too early and finds nothing.
    let clickedLabel: string | null = null
    for (let i = 0; i < 20; i++) {
      clickedLabel = (await webContents.executeJavaScript(`
        (function() {
          const composer = document.querySelector(${JSON.stringify(selector)})
          if (!composer) return null

          function isSend(b) {
            if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false
            const label = (b.getAttribute('aria-label') || '').trim().toLowerCase()
            // Deliberately exact-ish rather than a substring test: a loose
            // .includes('send') matched a sidebar history entry whose title
            // merely contained the word "send", and clicked that instead of
            // the composer's own send control.
            return label === 'send message' || label === 'send' || label === 'submit'
          }

          // Search outward from the composer, nearest scope first, so the
          // button found is always the one belonging to this composer
          // rather than something with a similar label elsewhere on screen.
          let scope = composer
          for (let depth = 0; depth < 8 && scope.parentElement; depth++) {
            scope = scope.parentElement
            const btn = Array.from(scope.querySelectorAll('button, [role="button"]')).find(isSend)
            if (btn) {
              btn.click()
              return btn.getAttribute('aria-label') || 'send'
            }
          }
          return null
        })()
      `)) as string | null
      if (clickedLabel) break
      await sleep(100)
    }

    if (clickedLabel) {
      console.log(`[FlowDesk inject:cdp][${tool}] submitted via button "${clickedLabel}"`)
    } else {
      console.log(`[FlowDesk inject:cdp][${tool}] no send button found, falling back to Enter`)
      // Nothing matched "send" while the composer demonstrably holds text —
      // dump the page's real controls so the actual submit affordance can
      // be identified instead of guessed at.
      await probeProvider(webContents)
      const enter = { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter })
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...enter })
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...enter })
    }

    // The composer emptying is the one provider-agnostic signal that a
    // submit actually went through. Reporting success without checking it
    // is what previously let a silently-failed send look like a success,
    // stranding the UI waiting for a reply that was never coming.
    for (let i = 0; i < 30; i++) {
      const now = (await webContents.executeJavaScript(readComposerSrc(selector))) ?? ''
      if (!now.trim()) return true
      await sleep(100)
    }

    console.log(`[FlowDesk inject:cdp][${tool}] composer still holds text after Enter — submit did not take`)
    return false
  })
}

/**
 * `submit` defaults to false to preserve the existing AI Browser "Inject
 * Prompt" UX, where a human is watching the tab and presses Enter/Send
 * themselves after reviewing the filled-in text. Universal Chat has no one
 * watching its background tabs, so it passes submit=true to also simulate
 * an Enter keypress after filling — these apps all submit on Enter
 * (without Shift) same as FlowDesk's own chat input does.
 */
export async function injectPrompt(webContents: WebContents, text: string, tool: AITool, submit = false): Promise<boolean> {
  // Providers migrated to the CDP path. It drives the page the way a person
  // does — real key events, then the real Send button — and verifies both
  // that the text landed and that the composer emptied afterwards, so a
  // failed send reports as failed instead of silently stranding the caller.
  if (tool === 'claude' || tool === 'gemini' || tool === 'grok' || tool === 'perplexity' || tool === 'chatgpt') {
    const cdpOk = await injectPromptCDP(webContents, text, tool, submit)
    if (cdpOk) return true
    console.log(`[FlowDesk inject] CDP injection not completed for ${tool}, attempting DOM injection fallback`)
  }

  const selector = SELECTORS[tool]
  const escapedText = JSON.stringify(text)
  const escapedSelector = JSON.stringify(selector)
  const escapedSubmit = JSON.stringify(submit)

  return webContents.executeJavaScript(`
    (function() {
      function fill(el) {
        el.focus()
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(el, ${escapedText})
          el.dispatchEvent(new Event('input', { bubbles: true }))
        } else {
          // Rich-text editors (Claude's chat box included) track their own
          // internal document model and listen for native beforeinput/input
          // events, driven off the live window Selection/Range — directly
          // mutating textContent edits the DOM but never reaches that model
          // (confirmed: DOM showed "<p>hello</p>" yet the Send button never
          // appeared, even with execCommand). focus() alone doesn't always
          // place a caret/selection inside a contenteditable that's never
          // been clicked, so the editor's beforeinput handler has no target
          // range to act on. Explicitly place a collapsed selection inside
          // the element first so execCommand('insertText') operates within
          // a real editor-visible caret, same as an actual click+type would.
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          document.execCommand('selectAll', false, null)
          document.execCommand('delete', false, null)
          document.execCommand('insertText', false, ${escapedText})
        }
      }

      function pressEnter(el) {
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
        el.dispatchEvent(new KeyboardEvent('keydown', opts))
        el.dispatchEvent(new KeyboardEvent('keyup', opts))
      }

      // Confirmed on a real capture: Enter-to-submit works on ChatGPT but
      // does nothing at all on Claude (no network call ever fires) — each
      // app's input handling is its own thing, don't assume one generalizes.
      // Clicking the actual Send button is closer to a real user action and
      // is the more universal mechanism; fall back to Enter only if no such
      // button can be found.
      //
      // Also confirmed on a real capture (Gemini, two messages sent back to
      // back): right after a reply finishes streaming, the Send button can
      // still be showing "Stop response" for a moment before the app swaps
      // it back — a message sent in that instant found no Send button,
      // silently fell back to Enter, and got no response at all (Enter
      // isn't a submit in that transient state either). Retry the button
      // scan for a few seconds before giving up and falling back to Enter,
      // instead of gambling on Enter after a single failed scan.
      function trySubmit(el, resolve) {
        const deadline = Date.now() + 4000
        function attempt() {
          const candidates = Array.from(document.querySelectorAll('button'))
          const sendBtn = candidates.find(function (b) {
            if (b.disabled) return false
            const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase()
            return label.includes('send')
          })
          if (sendBtn) {
            sendBtn.click()
            resolve(true)
            return
          }
          if (Date.now() > deadline) {
            console.log('[FlowDesk inject] no send-labelled button appeared within 4s, falling back to Enter keypress')
            pressEnter(el)
            resolve(true)
            return
          }
          setTimeout(attempt, 200)
        }
        attempt()
      }

      // A freshly-created background tab may still be rendering its input
      // box when this runs — retry briefly instead of failing on the
      // first querySelector miss.
      return new Promise((resolve) => {
        const deadline = Date.now() + 8000
        function attempt() {
          const el = document.querySelector(${escapedSelector})
          if (el) {
            fill(el)
            if (${escapedSubmit}) {
              // Small delay so the app's own input-state update (button
              // enable, char count, etc.) settles before we submit. resolve()
              // now happens inside trySubmit itself, once a real submission
              // (button click or Enter fallback) actually happened — not
              // optimistically right after calling it.
              setTimeout(() => { trySubmit(el, resolve) }, 150)
            } else {
              resolve(true)
            }
            return
          }
          if (Date.now() > deadline) {
            // Diagnostic: the configured selector never matched anything in
            // 8s — dump every plausible input candidate on the page so the
            // real selector can be read off directly instead of guessed.
            console.log('[FlowDesk inject] selector ' + ${escapedSelector} + ' never matched, dumping candidates:')
            const inputCandidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]'))
            console.log('[FlowDesk inject] ' + inputCandidates.length + ' textarea/contenteditable/text-input element(s) on page')
            inputCandidates.forEach(function (node, i) {
              const rr = node.getBoundingClientRect()
              console.log('[FlowDesk inject] input-candidate[' + i + '] tag=' + node.tagName + ' class="' + (node.className || '').toString().slice(0, 100) + '" aria-label="' + node.getAttribute('aria-label') + '" data-testid=' + node.getAttribute('data-testid') + ' rect=' + JSON.stringify({ left: rr.left, top: rr.top, width: rr.width, height: rr.height }))
            })
            resolve(false)
            return
          }
          setTimeout(attempt, 250)
        }
        attempt()
      })
    })()
  `)
}

/**
 * Diagnostic dump of a provider page's composer and toolbar controls.
 *
 * Not called during normal sends — the noise it produced on every message
 * drowned out the events that mattered. Call it from the main process when
 * onboarding a new provider or when an existing one's selectors break: it
 * reports what's actually on the page (every candidate input, and every
 * button with its label / disabled / visible state) so the correct
 * selectors can be read off a real page instead of guessed. Guessing is
 * exactly how the Gemini selector came to be `.input-area textarea`, which
 * matched nothing at all.
 */
export async function probeProvider(webContents: WebContents): Promise<void> {
  const dump = await webContents.executeJavaScript(`
    (function() {
      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')).map(function (n) {
        const r = n.getBoundingClientRect()
        return {
          tag: n.tagName,
          id: n.id || null,
          cls: (n.className || '').toString().slice(0, 120),
          ariaLabel: n.getAttribute('aria-label'),
          testId: n.getAttribute('data-testid') || n.getAttribute('data-test-id'),
          placeholder: n.getAttribute('placeholder') || n.getAttribute('data-placeholder'),
          visible: n.offsetParent !== null,
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
        }
      })
      // Not just <button>: a submit affordance can equally be a div with
      // role="button", an <input type=submit>, or an anchor — scanning only
      // <button> is how Claude's submit control managed to look nonexistent.
      const clickables = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a[href="#"]'))
        .filter(function (n) { return n.offsetParent !== null })
        .map(function (n) {
          return {
            tag: n.tagName,
            role: n.getAttribute('role'),
            ariaLabel: n.getAttribute('aria-label'),
            testId: n.getAttribute('data-testid') || n.getAttribute('data-test-id'),
            text: (n.textContent || '').trim().slice(0, 30),
            type: n.getAttribute('type'),
            disabled: n.disabled === true || n.getAttribute('aria-disabled') === 'true',
          }
        })

      // The composer's own toolbar, in full — whatever submits the message
      // lives here, and reading its real markup beats guessing at labels.
      let toolbar = null
      const composer = document.querySelector('[contenteditable="true"], textarea')
      if (composer) {
        let a = composer
        for (let i = 0; i < 6 && a.parentElement; i++) a = a.parentElement
        toolbar = (a.outerHTML || '').slice(0, 12000)
      }

      return { url: location.href, inputs: inputs, clickables: clickables, toolbar: toolbar }
    })()
  `)
  console.log('[FlowDesk probe]', JSON.stringify(dump, null, 2))
}

export async function getSelectedText(webContents: WebContents): Promise<string> {
  try {
    return await webContents.executeJavaScript(`window.getSelection()?.toString() ?? ''`)
  } catch {
    return ''
  }
}

export async function getLatestAssistantText(webContents: WebContents, tool: AITool): Promise<string> {
  const escapedTool = JSON.stringify(tool)

  try {
    return await webContents.executeJavaScript(`
      (function() {
        const tool = ${escapedTool}
        const selectors = {
          chatgpt: [
            '[data-message-author-role="assistant"]',
            'article[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])',
            '[data-testid*="assistant"]'
          ],
          claude: [
            '[data-is-streaming="false"]',
            '[data-testid*="message"]',
            '.font-claude-message',
            '.prose'
          ],
          gemini: [
            'message-content',
            '.model-response-text',
            '[data-response-index]',
            '.markdown'
          ],
          grok: [
            '[data-testid*="assistant"]',
            '[data-testid*="message"]',
            '.response-content',
            '.prose'
          ],
          perplexity: [
            '[data-testid*="assistant"]',
            '.prose',
            'article'
          ],
          deepseek: [
            '.ds-markdown',
            '[data-testid*="assistant"]',
            '.prose',
            '.chat-message'
          ]
        }

        function clean(text) {
          return String(text || '')
            .replace(/\\u00a0/g, ' ')
            .replace(/[ \\t]+/g, ' ')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim()
        }

        function visible(el) {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }

        function textFrom(selectorsForTool) {
          for (const selector of selectorsForTool) {
            const nodes = Array.from(document.querySelectorAll(selector)).filter(visible)
            const texts = nodes.map(node => clean(node.innerText || node.textContent)).filter(text => text.length > 20)
            if (texts.length > 0) return texts[texts.length - 1]
          }
          return ''
        }

        const providerText = textFrom(selectors[tool] || [])
        if (providerText) return providerText

        const genericSelectors = [
          '[data-message-author-role="assistant"]',
          '[data-testid*="assistant"]',
          '[data-testid*="message"]',
          'article',
          '.prose',
          'main p'
        ]

        return textFrom(genericSelectors)
      })()
    `)
  } catch {
    return ''
  }
}
