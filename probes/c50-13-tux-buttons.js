// @target tiktok.com
// @timeout 30000

const out = {}

const videoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Videos')
if (videoBtn) {
  out.videoBtnFound = true
  const parent = videoBtn.parentElement?.parentElement || videoBtn.parentElement
  out.parentTag = parent?.tagName
  out.siblingButtons = Array.from(parent?.querySelectorAll('button, div[role="button"]') || []).map(b => ({
    text: b.textContent?.trim(),
    ariaLabel: b.getAttribute('aria-label'),
    className: b.className?.slice ? b.className.slice(0, 40) : ''
  }))
} else {
  out.videoBtnFound = false
}

// Find ANY element on the page that has an icon or svg that looks like a filter/sliders
const allSvgs = Array.from(document.querySelectorAll('svg')).map(svg => {
  const p = svg.parentElement
  return {
    parentTag: p?.tagName,
    parentText: p?.textContent?.trim().slice(0, 30),
    parentE2e: p?.getAttribute('data-e2e'),
    ariaLabel: svg.getAttribute('aria-label') || p?.getAttribute('aria-label')
  }
}).filter(s => s.parentText || s.ariaLabel || s.parentE2e)

out.svgs = allSvgs.slice(0, 20)

return out
