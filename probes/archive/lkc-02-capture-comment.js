// @target linkedin.com
// @goto https://www.linkedin.com/feed/update/urn:li:activity:7497263203417169921/
// @timeout 60000
const seen = []
const of = window.fetch
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url
  const res = await of.apply(this, arguments)
  if (/rsc-action|comment/i.test(url) && init && init.method === 'POST') {
    let text = ''; try { text = await res.clone().text() } catch (e) {}
    seen.push({ url, headers: init.headers, body: init.body, status: res.status, resp: text.slice(0, 1500) })
  }
  return res
}
await probe.waitFor('[contenteditable="true"][role="textbox"]', { timeoutMs: 20000 })
const box = document.querySelector('[contenteditable="true"][role="textbox"]')
box.focus()
document.execCommand('insertText', false, 'FlowDesk API test comment (will be deleted)')
await new Promise(r => setTimeout(r, 1500))
const buttons = [...document.querySelectorAll('button')].filter(b => /^(comment|post)$/i.test(b.innerText.trim()))
const labels = buttons.map(b => b.innerText.trim() + '|' + (b.getAttribute('aria-label') || '') + '|' + b.disabled)
const boxText = box.innerText; const btn = buttons.filter(b => !b.disabled).pop()
if (btn) btn.click()
await new Promise(r => setTimeout(r, 5000))
window.fetch = of
return { labels, boxText, clicked: !!btn, seen: seen.filter(s => !/app-config|fetchFeedUpdateActionPrompt/.test(s.url)) }
