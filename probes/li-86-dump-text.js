// @target linkedin.com
// @timeout 30000

return await (async function () {
  return {
    url: window.location.href,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 2000)
  }
})()
