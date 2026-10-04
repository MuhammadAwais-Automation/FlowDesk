// @target tiktok.com
/**
 * tk-04-upload.js
 *
 * Probe 4: TikTok Studio Upload Deep Inspection (including iframes)
 */

try {
  const currentUrl = window.location.href

  // 1. Check iframes (TikTok Studio frequently embeds the upload interface in an iframe)
  const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
    src: f.src,
    name: f.name,
    id: f.id,
    className: f.className
  }))

  // 2. All text on page to see what screen is showing
  const bodyText = document.body ? document.body.innerText.slice(0, 500) : ''

  // 3. Inspect main document for file inputs & buttons
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(inp => ({
    id: inp.id,
    name: inp.name,
    accept: inp.accept,
    multiple: inp.multiple
  }))

  const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
    text: b.innerText ? b.innerText.trim() : '',
    aria: b.getAttribute('aria-label')
  })).filter(b => b.text || b.aria)

  // 4. Inspect iframe contents if same-origin or accessible
  const iframeDetails = []
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document)
      if (doc) {
        const inp = Array.from(doc.querySelectorAll('input[type="file"]')).map(i => ({
          accept: i.accept,
          name: i.name,
          id: i.id
        }))
        const btns = Array.from(doc.querySelectorAll('button, [role="button"]')).map(b => b.innerText.trim()).filter(Boolean)
        iframeDetails.push({
          src: f.src,
          accessible: true,
          fileInputs: inp,
          buttons: btns.slice(0, 10),
          textSnippet: doc.body ? doc.body.innerText.slice(0, 200) : ''
        })
      } else {
        iframeDetails.push({ src: f.src, accessible: false })
      }
    } catch (e) {
      iframeDetails.push({ src: f.src, accessible: false, error: String(e) })
    }
  }

  return {
    url: currentUrl,
    title: document.title,
    bodySnippet: bodyText,
    iframesCount: iframes.length,
    iframes,
    iframeDetails,
    mainFileInputs: fileInputs,
    mainButtons: allButtons.slice(0, 20)
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
