// @target linkedin.com
// @goto https://www.linkedin.com/analytics/creator/content/
// @timeout 40000
await new Promise(r => setTimeout(r, 9000))
const out = { url: location.href, top: [], frames: [] }
const pick = list => list.map(e => e.name).filter(n => !/\.(js|css|png|jpg|svg|woff2?|gif)(\?|$)/i.test(n) && !/static\.licdn|media\.licdn|li\/track|sensorCollect|tscp/i.test(n))
out.top = pick(performance.getEntriesByType('resource'))
for (const f of document.querySelectorAll('iframe')) {
  try { out.frames.push({ src: f.src, res: pick(f.contentWindow.performance.getEntriesByType('resource')) }) } catch (e) { out.frames.push({ src: f.src, err: String(e) }) }
}
out.textHasImpr = /impression/i.test(document.body.innerText)
return out
