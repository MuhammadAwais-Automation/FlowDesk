// @target chatgpt.com
// What does the RENDERED page actually hold for a generated image?
// If the API path stays 401, the <img> the user can see is the ground truth —
// this reports its real src shape so we know whether it is fetchable.

function short(s, n) { return String(s == null ? '' : s).slice(0, n || 300) }

const imgs = Array.from(document.querySelectorAll('img'))
  .map(function (el) {
    return {
      src: short(el.currentSrc || el.src, 400),
      alt: short(el.alt, 80),
      w: el.naturalWidth, h: el.naturalHeight,
    }
  })
  .filter(function (i) { return i.w > 200 && i.h > 200 })

const out = { href: location.href, bigImages: imgs }

// Can the page itself re-fetch one of those srcs? (same test the agent would do)
if (imgs.length) {
  const src = imgs[imgs.length - 1].src
  try {
    const r = await fetch(src, { credentials: 'include' })
    const ct = r.headers.get('content-type') || ''
    let info
    if (ct.indexOf('image/') === 0) {
      const b = await r.blob()
      info = '[IMAGE BLOB ' + b.size + ' bytes type=' + b.type + ']'
    } else {
      info = short(await r.text().catch(function () { return '' }), 300)
    }
    out.refetch = { src: short(src, 200), status: r.status, contentType: ct, info }
  } catch (e) { out.refetch = { src: short(src, 200), error: String(e) } }

  // And can it be read to a data URL via canvas? (works even when fetch is blocked)
  try {
    const el = document.querySelectorAll('img')[document.querySelectorAll('img').length - 1]
    const c = document.createElement('canvas')
    c.width = el.naturalWidth; c.height = el.naturalHeight
    c.getContext('2d').drawImage(el, 0, 0)
    const d = c.toDataURL('image/png')
    out.canvas = { ok: true, dataUrlLength: d.length, prefix: d.slice(0, 40) }
  } catch (e) { out.canvas = { ok: false, error: String(e) } }
}

return out
