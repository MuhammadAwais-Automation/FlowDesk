// @target tab:social-pinterest
// @timeout 30000
// Read-only GET via XMLHttpRequest (not fetch): does the page add x-pinterest-platform-bid itself?
const html = document.documentElement.innerHTML
const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
const q = new URLSearchParams({ source_url: '/business/hub/', data: JSON.stringify({ options: { url: '/v3/users/me/', data: { fields: 'user.id', probe55: 'xhr' } }, context: {} }), _: String(Date.now()) })
const status = await new Promise(res => {
  const x = new XMLHttpRequest()
  x.open('GET', '/resource/ApiResource/get/?' + q)
  x.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
  x.setRequestHeader('X-App-Version', appVersion)
  x.onload = () => res(x.status); x.onerror = () => res(0)
  x.send()
})
const patched = { fetch: String(window.fetch).includes('[native code]') ? 'native' : 'patched', xhrOpen: String(XMLHttpRequest.prototype.open).includes('[native code]') ? 'native' : 'patched', xhrSet: String(XMLHttpRequest.prototype.setRequestHeader).includes('[native code]') ? 'native' : 'patched', xhrSend: String(XMLHttpRequest.prototype.send).includes('[native code]') ? 'native' : 'patched' }
return { status, patched }
