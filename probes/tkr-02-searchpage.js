// @target tiktok.com
// @goto https://www.tiktok.com/search?q=openai
// @timeout 60000
const out = {}
await new Promise(r => setTimeout(r, 3000))
async function tryF(p) { try { const r = await fetch(p, { credentials: 'include', headers: { Accept: 'application/json' } }); const t = await r.text(); return { st: r.status, len: t.length, url: r.url.slice(0, 60) + '...' + (r.url.match(/X-Gnarly/) ? 'SIGNED' : 'unsigned'), head: t.slice(0, 100) } } catch (e) { return { err: String(e) } } }
out.search = await tryF('/api/search/general/full/?keyword=ai%20tools&offset=0&count=5')
out.detail = await tryF('/api/user/detail/?uniqueId=alphapaws6')
out.itemDetail = await tryF('/api/item/detail/?itemId=7655178209813597472')
out.xhr = await new Promise(res => { const x = new XMLHttpRequest(); x.open('GET', '/api/user/detail/?uniqueId=alphapaws6'); x.onload = () => res({ st: x.status, len: x.responseText.length, url: x.responseURL.slice(-60) }); x.onerror = () => res({ err: 1 }); x.send() })
return out
