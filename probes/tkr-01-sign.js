// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
const out = {}
out.href = location.href
out.fetchNative = /\[native code\]/.test(Function.prototype.toString.call(window.fetch))
async function tryF(f, p) { try { const r = await f(p, { credentials: 'include', headers: { Accept: 'application/json' } }); const t = await r.text(); return { st: r.status, len: t.length, head: t.slice(0, 120) } } catch (e) { return { err: String(e) } } }
out.searchHere = await tryF(window.fetch.bind(window), '/api/search/general/full/?keyword=ai%20tools&offset=0&count=5')
out.detailHere = await tryF(window.fetch.bind(window), '/api/user/detail/?uniqueId=alphapaws6')
// iframe fallback
const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;opacity:0'
fr.src = '/search?q=ai'; document.body.appendChild(fr)
const t0 = Date.now(); let nat = true
while (Date.now() - t0 < 25000) { await new Promise(r => setTimeout(r, 500)); try { const w = fr.contentWindow; if (w && w.fetch && !/\[native code\]/.test(Function.prototype.toString.call(w.fetch))) { nat = false; break } } catch (e) { out.frErr = String(e); break } }
out.iframeMs = Date.now() - t0; out.iframePatched = !nat
if (!nat) {
  const f = fr.contentWindow.fetch.bind(fr.contentWindow)
  out.search = await tryF(f, '/api/search/general/full/?keyword=ai%20tools&offset=0&count=5')
  out.detail = await tryF(f, '/api/user/detail/?uniqueId=alphapaws6')
  let sec = ''
  try { sec = JSON.parse((await (await f('/api/user/detail/?uniqueId=alphapaws6')).text())).userInfo.user.secUid } catch (e) { out.secErr = String(e) }
  out.sec = !!sec
  out.itemList = await tryF(f, '/api/post/item_list/?secUid=' + encodeURIComponent(sec) + '&count=10&cursor=0')
}
fr.remove()
return out
