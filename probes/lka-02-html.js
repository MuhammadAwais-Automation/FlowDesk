// @target linkedin.com
// @timeout 40000
const r = await fetch('https://www.linkedin.com/analytics/creator/content/', { credentials: 'include', headers: { accept: 'text/html' } })
const html = await r.text()
const ctx = []
const re = /mpression/g; let m; let n = 0
while ((m = re.exec(html)) && n < 12) { ctx.push(html.slice(Math.max(0, m.index - 300), m.index + 300)); n++ }
const qids = [...new Set(html.match(/voyager[A-Za-z]*Analytic[A-Za-z]*\.[0-9a-f]{32}/g) || [])]
const qids2 = [...new Set(html.match(/voyagerFeedDashCreatorExperienceDashboard\.[0-9a-f]{32}/g) || [])]
return { status: r.status, len: html.length, ctType: r.headers.get('content-type'), qids, qids2, ctx }
