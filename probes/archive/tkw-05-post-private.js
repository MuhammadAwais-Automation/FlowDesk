// @target tiktok.com
// @timeout 90000
const txt = el => (el.innerText || '').trim()
const cap = await probe.captureNetwork(async () => {
  const label = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^who can see this post$/i.test(txt(e)))
  if (!label) return { aborted: 'label not found' }
  let sec = label; for (let i = 0; i < 5 && sec.parentElement && !/everyone|only me|friends/i.test(txt(sec).replace(/who can see this post/i, '')); i++) sec = sec.parentElement
  const cur = [...sec.querySelectorAll('*')].reverse().find(e => /^(everyone|friends|only me|followers)$/i.test(txt(e)))
  if (!cur) return { aborted: 'current value not found', sec: txt(sec).slice(0, 100) }
  const clickable = cur.closest('button,[role="combobox"],[role="button"],[tabindex]') || cur
  await probe.click(clickable, { waitAfterMs: 1200 })
  const opt = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^only me$/i.test(txt(e))).pop()
  if (!opt) return { aborted: 'Only me option not found after opening', options: [...document.querySelectorAll('[role="option"]')].map(txt) }
  await probe.click(opt.closest('[role="option"],li,button,[tabindex]') || opt, { waitAfterMs: 1200 })
  const now = txt(sec)
  if (!/only me/i.test(now)) return { aborted: 'privacy did not switch', now: now.slice(0, 120) }
  await probe.click('button[data-e2e="post_video_button"]', { waitAfterMs: 2000 })
  for (let i = 0; i < 20; i++) {
    const b = [...document.querySelectorAll('[role="dialog"] button, .TUXModal button')].find(x => /post now|post anyway|continue/i.test(txt(x)))
    if (b) await probe.click(b)
    if (location.href.includes('/tiktokstudio/content')) break
    await probe.sleep(1000)
  }
  return { posted: true, privacy: now.slice(0, 80), url: location.href }
})
const keep = (cap.requests || []).filter(r => /project|post|publish|commit|create|item|video/i.test(r.url) && !/monitor|slardar|\.(js|css|png)|blob:/i.test(r.url))
return { result: cap.result, error: cap.error, reqs: keep.map(r => ({ m: r.method, url: r.url.slice(0, 500), status: r.status, h: r.requestHeaders, post: typeof r.postData === 'string' ? r.postData.slice(0, 3000) : null, resp: (r.responseBody || '').slice(0, 1500) })) }
