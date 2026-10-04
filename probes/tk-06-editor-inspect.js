// @target tiktok.com
/**
 * tk-06-editor-inspect.js
 *
 * Probe 6: Inspect TikTok Studio Editor after video file injection.
 * Finds Caption input, Title, Cover options, Privacy, Allow Comments, Duet, Stitch, and Post button.
 */

try {
  // 1. Text & Headings on page
  const bodyText = document.body ? document.body.innerText.slice(0, 800) : ''

  // 2. Caption editor / ContentEditable
  const captionFields = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, .DraftEditor-root, [data-e2e*="caption"], [class*="caption"], [class*="editor"]')).map(el => ({
    tag: el.tagName,
    className: el.className,
    role: el.getAttribute('role'),
    placeholder: el.getAttribute('placeholder'),
    text: el.innerText ? el.innerText.slice(0, 100) : '',
    aria: el.getAttribute('aria-label')
  }))

  // 3. Switches / Checkboxes (Comments, Duet, Stitch)
  const switches = Array.from(document.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"]')).map(s => {
    let label = ''
    let p = s.parentElement
    for (let i = 0; i < 4 && p; i++) {
      if (p.innerText && p.innerText.length > 2) {
        label = p.innerText.replace(/\n/g, ' ').trim()
        break
      }
      p = p.parentElement
    }
    return {
      id: s.id,
      checked: s.checked || s.getAttribute('aria-checked') === 'true',
      aria: s.getAttribute('aria-label'),
      label: label.slice(0, 60)
    }
  })

  // 4. Buttons (Post, Schedule, Discard, Cancel)
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
    text: b.innerText ? b.innerText.trim() : '',
    aria: b.getAttribute('aria-label'),
    className: b.className,
    disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    dataE2E: b.getAttribute('data-e2e')
  })).filter(b => b.text || b.aria)

  // 5. Video player / preview
  const videos = Array.from(document.querySelectorAll('video')).map(v => ({
    src: v.src,
    currentSrc: v.currentSrc,
    duration: v.duration
  }))

  // 6. Progress / upload status
  const progressText = Array.from(document.querySelectorAll('[class*="progress"], [class*="status"], [class*="uploading"], [class*="success"]')).map(el => el.innerText.trim()).filter(Boolean)

  return {
    url: window.location.href,
    title: document.title,
    bodySnippet: bodyText,
    captionFieldsCount: captionFields.length,
    captionFields,
    switchesCount: switches.length,
    switches,
    buttonsCount: buttons.length,
    buttons: buttons.filter(b => {
      const t = (b.text || b.aria || '').toLowerCase()
      return t.includes('post') || t.includes('manage') || t.includes('discard') || t.includes('select') || t.includes('upload')
    }),
    videos,
    progressText: progressText.slice(0, 10)
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
