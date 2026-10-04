// @target linkedin.com
// @timeout 30000

return await (async function () {
  const allContainers = Array.from(document.querySelectorAll('div, section, main')).filter(el => {
    return el.innerText && el.innerText.includes('Edit intro') && el.innerText.includes('First name')
  }).map(el => ({
    tag: el.tagName,
    className: el.className,
    role: el.getAttribute('role'),
    id: el.id
  }))

  return {
    containersCount: allContainers.length,
    containers: allContainers.slice(0, 5)
  }
})()
