// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/edit/intro
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2000))

  // Find the save button
  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')

  // Intercept fetch & XHR to see exact request sent when Save is clicked
  let requests = []
  const origFetch = window.fetch
  window.fetch = async function (url, opts = {}) {
    const u = String(url)
    if (u.includes('voyager') || u.includes('graphql') || u.includes('identity')) {
      requests.push({
        url: u,
        method: opts.method || 'GET',
        body: opts.body ? String(opts.body).slice(0, 1000) : null
      })
    }
    return origFetch.apply(this, arguments)
  }

  return {
    saveBtnFound: !!saveBtn,
    saveBtnDisabled: saveBtn?.disabled,
    currentHeadline: document.querySelector('.tiptap.ProseMirror')?.innerText?.trim()
  }
})()
