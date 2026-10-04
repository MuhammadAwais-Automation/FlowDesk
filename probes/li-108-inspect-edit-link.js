// @target linkedin.com
// @timeout 30000

return await (async function () {
  const el = Array.from(document.querySelectorAll('a, button')).find(x => {
    return x.getAttribute('aria-label') === 'Edit profile' || x.getAttribute('href')?.includes('/edit/intro')
  })

  return {
    found: !!el,
    tag: el?.tagName,
    href: el?.getAttribute('href'),
    outer: el?.outerHTML?.slice(0, 300),
    props: el ? Object.keys(el).filter(k => k.startsWith('__react')) : []
  }
})()
