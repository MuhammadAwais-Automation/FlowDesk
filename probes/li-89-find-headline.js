// @target linkedin.com
// @timeout 30000

return await (async function () {
  const allElements = Array.from(document.querySelectorAll('*')).filter(el => {
    return el.children.length === 0 && (el.innerText === '--' || el.getAttribute('contenteditable') === 'true')
  }).map(el => ({
    tag: el.tagName,
    contenteditable: el.getAttribute('contenteditable'),
    className: el.className,
    parentTag: el.parentElement?.tagName,
    parentClass: el.parentElement?.className,
    parentHtml: el.parentElement?.outerHTML?.slice(0, 300)
  }))

  return { allElements }
})()
