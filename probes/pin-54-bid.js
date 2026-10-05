// @target tab:social-pinterest
// @timeout 30000
// Read-only: where does the page keep the x-pinterest-platform-bid value? Locations + 6-char prefixes only.
const hits = []
const looks = v => typeof v === 'string' && /^[A-Za-z0-9+/=]{40,120}$/.test(v)
for (const [n, s] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
  for (let i = 0; i < s.length; i++) { const k = s.key(i); const v = s.getItem(k); if (looks(v)) hits.push(n + ':' + k + '=' + v.slice(0, 6)); else if (v && /bid/i.test(k)) hits.push(n + ':' + k + ' (len ' + v.length + ') ' + v.slice(0, 6)) }
}
for (const c of document.cookie.split('; ')) { const [k, v] = c.split('='); if (looks(decodeURIComponent(v || '')) || /bid/i.test(k)) hits.push('cookie:' + k + '=' + (v || '').slice(0, 6)) }
const m = document.documentElement.innerHTML.match(/"([A-Za-z_]*[Bb]id[A-Za-z_]*)"\s*:\s*"([A-Za-z0-9+/=]{40,120})"/g) || []
for (const x of m.slice(0, 10)) hits.push('html:' + x.slice(0, 40))
return { hits }
