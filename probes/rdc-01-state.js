// @target reddit.com
const me = await fetch('/api/me.json', { credentials: 'include' }).then(r => r.json()).catch(e => ({ err: String(e) }))
const about = await fetch('/user/me/about.json', { credentials: 'include' }).then(r => r.text()).catch(e => String(e))
return {
  url: location.href,
  meName: me && me.data && me.data.name,
  aboutSnippet: String(about).slice(0, 80),
  cookieNames: document.cookie.split(';').map(c => c.split('=')[0].trim()),
  loginButton: !!document.querySelector('a[href*="/login"]'),
  lsKeys: Object.keys(localStorage).filter(k => /token|session|auth|login/i.test(k)),
}
