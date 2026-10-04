// @target linkedin.com
// @timeout 40000
const r = await fetch('https://www.linkedin.com/analytics/creator/content/', { credentials: 'include', headers: { accept: 'text/html' } })
const html = await r.text()
const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;|&#x27;|&#39;/g, ' ').replace(/\s+/g, ' ')
const i = body.search(/impression/i)
const r2 = await fetch('https://www.linkedin.com/analytics/creator/content/', { credentials: 'include', headers: { rsc: '1', accept: 'text/x-component' } })
const t2 = await r2.text()
return { text: body.slice(Math.max(0, i - 600), i + 1500), rsc: { status: r2.status, ct: r2.headers.get('content-type'), len: t2.length, head: t2.slice(0, 300) } }
