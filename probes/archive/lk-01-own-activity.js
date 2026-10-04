// @target linkedin.com
// @goto https://www.linkedin.com/in/me/recent-activity/all/
// @timeout 40000
await new Promise(r => setTimeout(r, 6000))
const html = document.documentElement.innerHTML
const ids = [...new Set((html.match(/urn:li:activity:(\d{15,})/g) || []))].slice(0, 10)
return { url: location.href, ids }
