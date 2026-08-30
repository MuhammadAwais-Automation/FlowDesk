// @target worker:chatgpt
// Pure observer — types nothing, submits nothing. Watches the hidden
// worker window's DOM every 3s for up to 200s while the REAL agent's own
// ask_chatgpt call (already dispatched by the user) runs its course, so the
// submit-button state at genuine completion is a confirmed fact rather than
// a guess from a synthetic submission that may have errored.

function snapshot() {
  const submitBtn = document.querySelector('#composer-submit-button')
    || document.querySelector('[data-testid="send-button"]')
    || document.querySelector('[data-testid="stop-button"]')
    || document.querySelector('button[aria-label*="Stop" i]')
    || document.querySelector('button[aria-label*="Send" i]')

  const turns = Array.from(document.querySelectorAll('[data-message-author-role]'))
  const lastTurn = turns[turns.length - 1]
  const lastRole = lastTurn ? lastTurn.getAttribute('data-message-author-role') : null
  const hasImg = lastTurn ? !!lastTurn.querySelector('img') : false
  const imgSrcs = lastTurn ? Array.from(lastTurn.querySelectorAll('img')).map(function (i) { return i.src.slice(0, 90) }) : []

  return {
    turnCount: turns.length,
    submitBtn: submitBtn ? {
      testid: submitBtn.getAttribute('data-testid'),
      ariaLabel: submitBtn.getAttribute('aria-label'),
    } : null,
    lastTurnRole: lastRole,
    lastTurnHasImg: hasImg,
    lastTurnImgSrcs: imgSrcs,
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

const start = Date.now()
const timeline = [Object.assign({ label: 't+0s' }, snapshot())]

const deadline = start + 200000
while (Date.now() < deadline) {
  await sleep(3000)
  const s = snapshot()
  timeline.push(Object.assign({ label: 't+' + Math.round((Date.now() - start) / 1000) + 's' }, s))
  // Stop once an image has appeared and held for one more sample past that.
  if (s.lastTurnHasImg && timeline.length > 2 && timeline[timeline.length - 2].lastTurnHasImg) break
}

return { timeline: timeline }
