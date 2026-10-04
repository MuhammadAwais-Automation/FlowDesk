// @target tiktok.com
// @goto https://www.tiktok.com/tiktokstudio/upload
// @file video ./out/tkw/tkw_test.mp4
// @timeout 150000

// Drives ONE private ("Only me") upload on the current account and records
// every fetch/XHR so the real write chain can be replayed as API calls.
const who = await fetch('/api/user/detail/?uniqueId=alphapaws6', { credentials: 'include' }).then(r => r.status).catch(() => 0)
const acct = (document.body.innerText.match(/@[\w.]+/) || [''])[0]
const cap = await probe.captureNetwork(async () => {
  await probe.waitFor('input[type="file"]', { timeoutMs: 30000 })
  await probe.injectFile('input[type="file"]', probe.files.video)
  await probe.waitFor('[contenteditable="true"]', { timeoutMs: 60000 })
  // wait until upload finished (Post button enabled)
  await probe.waitFor(() => {
    const b = document.querySelector('button[data-e2e="post_video_button"]')
    return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getAttribute('data-disabled') !== 'true'
  }, { timeoutMs: 90000 })
  await probe.type('[contenteditable="true"]', 'flowdesk tkw test private', { clear: true })
  await probe.sleep(800)
  // privacy: open the "Who can watch" select and choose Only me
  const txt = el => (el.innerText || '').trim()
  const sels = probe.queryAll('[role="combobox"], .Select__root button, [class*="select"] button, [class*="Select"]')
  const priv = sels.find(el => /everyone|friends|only me|followers/i.test(txt(el)))
  if (!priv) return { aborted: 'privacy control not found', sels: sels.map(txt).slice(0, 10) }
  await probe.click(priv, { waitAfterMs: 800 })
  const opt = probe.queryAll('[role="option"], li, [class*="option"]').find(el => /^only me$/i.test(txt(el)))
  if (!opt) return { aborted: 'Only me option not found' }
  await probe.click(opt, { waitAfterMs: 800 })
  if (!/only me/i.test(txt(priv))) return { aborted: 'privacy did not switch', now: txt(priv) }
  await probe.click('button[data-e2e="post_video_button"]', { waitAfterMs: 1500 })
  // confirm dialogs
  for (let i = 0; i < 20; i++) {
    const b = probe.queryAll('[role="dialog"] button, .TUXModal button').find(x => /post now|post anyway|continue/i.test(txt(x)))
    if (b) await probe.click(b)
    if (location.href.includes('/tiktokstudio/content')) break
    await probe.sleep(1000)
  }
  return { posted: true, url: location.href }
})
const slim = (cap.requests || []).filter(r => !/monitor|mcs|log|slardar|webcast|abtest|\.(js|css|png)/i.test(r.url)).map(r => ({
  m: r.method, url: r.url.slice(0, 400), status: r.status, h: r.requestHeaders,
  post: typeof r.postData === 'string' ? r.postData.slice(0, 1500) : r.postData ? '[binary]' : null,
  resp: (r.responseBody || '').slice(0, 1500),
}))
return { who, acct, result: cap.result, error: cap.error, n: slim.length, reqs: slim }
