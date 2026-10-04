// @target chatgpt.com
// Drives a real image-generation prompt itself (independent of the agent's
// own dispatch path) and samples the DOM every 3s for up to ~150s, so we can
// see EXACTLY what changes on the page while ChatGPT is still working versus
// stuck — the composer's send/stop button, any "generating" placeholder,
// and when the real <img> actually lands. Nothing here is guessed; every
// finding gets written back to the spec/plan as a confirmed fact.

function snapshot() {
  const submitBtn = document.querySelector('#composer-submit-button')
    || document.querySelector('[data-testid="send-button"]')
    || document.querySelector('[data-testid="stop-button"]')
    || document.querySelector('button[aria-label*="Stop" i]')
    || document.querySelector('button[aria-label*="Send" i]')

  const turns = Array.from(document.querySelectorAll('[data-message-author-role]'))
  const lastTurn = turns[turns.length - 1]
  const lastRole = lastTurn ? lastTurn.getAttribute('data-message-author-role') : null
  const lastHtmlLen = lastTurn ? lastTurn.innerHTML.length : 0
  const hasImg = lastTurn ? !!lastTurn.querySelector('img') : false
  const imgSrcs = lastTurn ? Array.from(lastTurn.querySelectorAll('img')).map(function (i) { return i.src.slice(0, 80) }) : []

  // Broad net for any "still working" visual cue: skeleton/shimmer/pulse
  // classes, aria-busy, progressbars, or plain text mentioning generation.
  const busyEls = document.querySelectorAll('[aria-busy="true"]').length
  const pulseEls = document.querySelectorAll('[class*="pulse" i], [class*="skeleton" i], [class*="shimmer" i]').length
  const progressEls = document.querySelectorAll('[role="progressbar"]').length
  const bodyText = document.body.innerText || ''
  const mentionsGenerating = /generating|creating.{0,15}image|working on it/i.test(bodyText.slice(-4000))

  return {
    t: Date.now(),
    submitBtn: submitBtn ? {
      tag: submitBtn.tagName,
      id: submitBtn.id || null,
      testid: submitBtn.getAttribute('data-testid'),
      ariaLabel: submitBtn.getAttribute('aria-label'),
      disabled: submitBtn.disabled === true,
      innerHTMLSnippet: submitBtn.innerHTML.slice(0, 200),
    } : null,
    lastTurnRole: lastRole,
    lastTurnHtmlLen: lastHtmlLen,
    lastTurnHasImg: hasImg,
    lastTurnImgSrcs: imgSrcs,
    busyEls: busyEls,
    pulseEls: pulseEls,
    progressEls: progressEls,
    mentionsGenerating: mentionsGenerating,
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

const timeline = []
timeline.push(Object.assign({ label: 'before-submit' }, snapshot()))

// Submit the prompt exactly like a real user: focus the composer, set its
// text, then dispatch a native Enter keydown (React's controlled input
// needs the native value-setter + input event, not a bare .value=).
const editor = document.querySelector('#prompt-textarea')
if (!editor) { return { error: 'no #prompt-textarea found — is chatgpt.com open and logged in?', timeline: timeline } }

const promptText = 'Generate an image of a cute 3D robot mascot, white and blue metallic body, glowing eyes, waving, studio background, square format.'
editor.focus()
const setter = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText')
if (editor.isContentEditable) {
  document.execCommand('insertText', false, promptText)
} else if (setter && setter.set) {
  setter.set.call(editor, promptText)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}
await sleep(300)
editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))

timeline.push(Object.assign({ label: 'just-after-submit' }, snapshot()))

const deadline = Date.now() + 150000
while (Date.now() < deadline) {
  await sleep(3000)
  const s = snapshot()
  timeline.push(Object.assign({ label: 't+' + Math.round((Date.now() - timeline[0].t) / 1000) + 's' }, s))
  // Stop early once a real image lands and stays for one more sample.
  if (s.lastTurnHasImg && timeline.length > 2 && timeline[timeline.length - 2].lastTurnHasImg) break
}

return { promptSent: promptText, timeline: timeline }
