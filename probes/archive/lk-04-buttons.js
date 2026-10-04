// @target linkedin.com
// @timeout 20000
return { url: location.href, labels: [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || '') + ' | ' + (b.innerText || '').trim().slice(0, 30)).filter(s => /like|react|comment/i.test(s)).slice(0, 30) }
