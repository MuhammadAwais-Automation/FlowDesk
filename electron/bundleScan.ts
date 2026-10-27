/**
 * Looks for a tool's request identifiers (batchexecute rpc ids, GraphQL
 * queryIds / doc_ids, resource names) inside the JavaScript a site's page has
 * already loaded. A changed bundle or a missing id is the earliest sign that a
 * tool is about to break, and it costs no API call: only the same static
 * script files the page itself loads are read again, through the account's own
 * session (cache first).
 */
import type { WebContents } from 'electron'

export interface NeedleHit { needle: string; found: boolean; scripts: string[] }
export interface BundleScanResult {
  page: string
  scripts: number
  bytes: number
  skipped: number
  /** Build/version markers seen in script URLs or the page (e.g. Google's boq build label). */
  versions: string[]
  needles: NeedleHit[]
}

const MAX_SCRIPTS = 400
const MAX_BYTES = 80 * 1024 * 1024

/** The script URLs the page has loaded (resource timing + <script src>), http(s) only, de-duplicated. */
const scriptUrlsScript = `(function () {
  var urls = performance.getEntriesByType('resource').filter(function (e) { return e.initiatorType === 'script' || /\\.js(\\?|$)/.test(e.name) }).map(function (e) { return e.name })
  Array.from(document.scripts).forEach(function (s) { if (s.src) urls.push(s.src) })
  var inline = Array.from(document.scripts).filter(function (s) { return !s.src }).map(function (s) { return s.textContent || '' }).join('\\n')
  return { page: location.origin + location.pathname, urls: Array.from(new Set(urls)).filter(function (u) { return /^https?:/.test(u) }), inline: inline.slice(0, 5000000) }
})()`

const BOQ = /boq[-_][a-z0-9-]+?_\d{8}\.\d{2}_p\d/gi

/** Version markers: Google boq build labels in the page or script URLs. */
export function versionMarkers(urls: readonly string[], text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(BOQ)) out.add(m[0])
  for (const u of urls) for (const m of u.matchAll(BOQ)) out.add(m[0])
  return [...out].slice(0, 10)
}

export function shortName(url: string): string {
  try { const u = new URL(url); return `${u.host}${u.pathname}`.slice(-90) } catch { return url.slice(-90) }
}

/**
 * API endpoints written into a site's JavaScript: quoted paths under /api,
 * /graphql, /ajax, /v1… and full URLs on the page's own site, plus GraphQL
 * operation names. What site_investigate reports when a tool breaks — the
 * calls the site's own code makes now, found without clicking anything.
 */
const ENDPOINT = /["'`]((?:https?:\/\/[\w.-]+)?(?:\/[\w.-]+){0,4}?\/(?:api|graphql|ajax|_next\/data|v\d+|rest|services?|internal|gql)(?:[/.?][\w\-./{}:$=&]*)?)["'`]/g
const OPERATION = /\b(?:query|mutation)\s+([A-Z][A-Za-z0-9_]{2,60})\s*[({]/g

export function endpointsIn(text: string, pageHost: string, limit = 80): { endpoints: string[]; operations: string[] } {
  const site = pageHost.split('.').slice(-2).join('.')
  const endpoints = new Set<string>()
  for (const m of text.matchAll(ENDPOINT)) {
    const raw = m[1]
    if (raw.length < 5 || raw.length > 160 || /\.(js|css|png|svg|jpg|woff2?)$/i.test(raw)) continue
    if (/^https?:/i.test(raw)) {
      try { if (!new URL(raw).hostname.endsWith(site)) continue } catch { continue }
    }
    endpoints.add(raw)
    if (endpoints.size >= limit) break
  }
  const operations = new Set<string>()
  for (const m of text.matchAll(OPERATION)) { operations.add(m[1]); if (operations.size >= limit) break }
  return { endpoints: [...endpoints].sort(), operations: [...operations].sort() }
}

/** Reads the page's scripts like scanBundles and lists the endpoints they call. */
export async function scanEndpoints(wc: WebContents, limit = 80): Promise<{ page: string; scripts: number; endpoints: string[]; operations: string[] }> {
  const { page, urls, inline } = await wc.executeJavaScript(scriptUrlsScript) as { page: string; urls: string[]; inline: string }
  let text = inline
  for (const url of urls.slice(0, 120)) {
    if (text.length > 30 * 1024 * 1024) break
    try {
      const res = await wc.session.fetch(url, { cache: 'force-cache' } as RequestInit)
      if (res.ok) text += '\n' + await res.text()
    } catch { /* one script fewer */ }
  }
  let host = ''
  try { host = new URL(page).hostname } catch { /* about:blank */ }
  return { page, scripts: urls.length, ...endpointsIn(text, host, limit) }
}

export async function scanBundles(wc: WebContents, needles: readonly string[]): Promise<BundleScanResult> {
  const { page, urls, inline } = await wc.executeJavaScript(scriptUrlsScript) as { page: string; urls: string[]; inline: string }
  const hits = new Map(needles.map(n => [n, [] as string[]]))
  const check = (name: string, body: string) => { for (const n of needles) if (body.includes(n)) hits.get(n)!.push(name) }
  check('(inline scripts)', inline)
  let bytes = inline.length
  let skipped = 0
  let versionText = inline
  for (const url of urls.slice(0, MAX_SCRIPTS)) {
    if (bytes > MAX_BYTES) { skipped++; continue }
    try {
      const res = await wc.session.fetch(url, { cache: 'force-cache' } as RequestInit)
      if (!res.ok) { skipped++; continue }
      const body = await res.text()
      bytes += body.length
      check(shortName(url), body)
      if (versionText.length < 2_000_000) versionText += body.slice(0, 20000)
    } catch { skipped++ }
  }
  skipped += Math.max(0, urls.length - MAX_SCRIPTS)
  return {
    page, scripts: urls.length, bytes, skipped,
    versions: versionMarkers(urls, versionText),
    needles: needles.map(n => ({ needle: n, found: hits.get(n)!.length > 0, scripts: hits.get(n)!.slice(0, 3) })),
  }
}
