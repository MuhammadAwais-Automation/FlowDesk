import { app, session, WebContentsView, BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'path'
import { isOAuthPopup } from './oauthRouting'
import { routeLink } from './linkRouting'
import { prepareGooglePopup, wantsGoogleChooser } from './googleSignInChooser'
import { WHATSAPP_BRIDGE_SRC } from './whatsapp/whatsappInject'
import { startLinkedInRealtimeWatch } from './linkedin/linkedinRealtimeWatch'
import { startCdpRecorder } from './discovery/cdpRecorder'
import { CHATGPT_CAPTURE_SRC, CLAUDE_CAPTURE_SRC, GEMINI_CAPTURE_SRC, GROK_CAPTURE_SRC, PERPLEXITY_CAPTURE_SRC, QWEN_CAPTURE_SRC, DEEPSEEK_CAPTURE_SRC } from './captureInject'

const WEBVIEW_PRELOAD = join(__dirname, '../preload/webviewPreload.js')

/**
 * Discovery-only: the user reported that a Google sign-in popup (previously
 * a small in-app child window) now opens in the OS default browser instead,
 * where the login cannot complete (the session that needs the resulting
 * cookie lives in the app, not the system browser). `isOAuthPopup`/`routeLink`
 * look correct on inspection — this logs every routing DECISION, not a
 * guess about which one is wrong, so the real failing case can be read off
 * a live repro instead of assumed.
 */
function logLinkRoutingDecision(via: 'window-open' | 'will-navigate', from: string, target: string, decision: string) {
  if (app.isPackaged) return
  try {
    const fs: typeof import('node:fs') = require('node:fs')
    const outFile = join(app.getAppPath(), 'probes', 'out', '_link-routing-debug.log')
    fs.mkdirSync(join(app.getAppPath(), 'probes', 'out'), { recursive: true })
    fs.appendFileSync(outFile, `[${via}] from=${from}\n  target=${target}\n  decision=${decision}\n\n`)
  } catch { /* discovery aid only */ }
}

/**
 * Sites the CDP discovery recorder attaches to. Development-only in effect —
 * it costs a debugger attachment on that view, which conflicts with opening
 * DevTools there, so a host stays listed only while it is being studied.
 */
/**
 * Records which URLs the CDP recorder was offered and which it took. Writes to
 * the same file cdpRecorder.ts uses, so one file answers "was it even asked?"
 * and "did it attach?" together.
 */
function logCdpDecision(url: string, matchedHost: string | undefined, packaged: boolean) {
  if (packaged) return
  try {
    const fs: typeof import('node:fs') = require('node:fs')
    const dir = join(app.getAppPath(), 'probes', 'out')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(join(dir, '_cdp-attach.log'), `${new Date().toISOString()} dom-ready ${url} -> ${matchedHost ?? 'NO HOST MATCH'}
`)
  } catch { /* discovery aid only */ }
}

const CDP_RECORDER_HOSTS = ['linkedin.com', 'facebook.com', 'flow.google.com', 'labs.google', 'reddit.com', 'tiktok.com', 'chatgpt.com', 'pinterest.com']

/**
 * Extra hosts to capture ALONGSIDE a matched tab host, for sites whose real
 * API lives on a different domain than the page itself. Google Flow's page
 * is labs.google, but the actual generation calls go to
 * aisandbox-pa.googleapis.com — a single-host urlMatch silently dropped
 * every one of them, indistinguishable from "never happened" until checked
 * directly against the page's own Resource Timing API.
 */
const CDP_RECORDER_EXTRA_HOSTS: Record<string, string[]> = {
  // googleusercontent is where Flow's media actually lives: a download in the
  // UI fetches from there, so without it a download is invisible to the
  // recorder in exactly the way aisandbox once was -- indistinguishable from
  // "the user did not do it".
  'flow.google.com': ['aisandbox-pa.googleapis.com', 'labs.google', 'googleusercontent.com', 'flow-content.google'],
  'labs.google': ['aisandbox-pa.googleapis.com', 'flow-content.google'],
  'reddit.com': ['gql.reddit.com', 'gateway.reddit.com', 'oauth.reddit.com', 'redditstatic.com'],
  'tiktok.com': ['www.tiktok.com', 'm.tiktok.com', 'byteoversea.com', 'ibytedtos.com', 'tiktokcdn.com', 'tiktokv.com'],
}


// PoC: per-provider fetch-tee capture, matched by hostname.
const CAPTURE_RULES: { match: (url: string) => boolean; src: string }[] = [
  { match: url => url.includes('chatgpt.com'), src: CHATGPT_CAPTURE_SRC },
  { match: url => url.includes('claude.ai'), src: CLAUDE_CAPTURE_SRC },
  { match: url => url.includes('gemini.google.com'), src: GEMINI_CAPTURE_SRC },
  { match: url => url.includes('grok.com'), src: GROK_CAPTURE_SRC },
  { match: url => url.includes('perplexity.ai'), src: PERPLEXITY_CAPTURE_SRC },
  { match: url => url.includes('chat.qwen.ai'), src: QWEN_CAPTURE_SRC },
  { match: url => url.includes('chat.deepseek.com'), src: DEEPSEEK_CAPTURE_SRC },
  // Not a tee like the rules above: WhatsApp's wire is encrypted binary, so
  // this reads the page's own decrypted store instead. See whatsappInject.ts
  // for what the three discovery passes established.
  { match: url => url.includes('web.whatsapp.com'), src: WHATSAPP_BRIDGE_SRC },
]

/**
 * Resolves the isolated session partition for an AI provider or worker tool.
 * Ensures consistent persist:<provider> partition isolation across all providers.
 */
export function getProviderPartition(provider: string): string {
  const clean = provider.startsWith('persist:') ? provider.slice(8) : provider
  return `persist:${clean}`
}

const viewCache = new Map<string, WebContentsView>()
// Universal Chat's / the Agent orchestrator's per-provider worker
// windows — see ensureBackgroundView() for why each provider gets its own
// dedicated BrowserWindow rather than sharing viewCache/mainWindow at all.
const backgroundWindows = new Map<string, BrowserWindow>()
// First-load promise per background window, present only while loading.
const backgroundReady = new Map<string, Promise<{ webContents: WebContents }>>()
/**
 * Pages that lay a view out themselves (Social, Workspace) record their
 * insets here, keyed by tab id.
 *
 * Without this, setCustomBounds was a one-shot: the main window's own resize
 * handler re-ran updateBounds() on every resize and re-imposed the AI Browser
 * layout (84px top bar, 230px tool dock) on whatever view happened to be
 * active. A Social view would jump out from under its platform rail the first
 * time the window was resized. Insets rather than absolute bounds because the
 * whole point is to survive a size change — the gaps are what stay constant,
 * not the rectangle.
 */
const customInsets = new Map<string, { left: number; top: number; right: number; bottom: number }>()
let activeTabId: string | null = null
let mainWindow: BrowserWindow | null = null

let NAV_WIDTH = 172       // left sidebar — updated via view:setNavWidth IPC
const TOP_HEIGHT = 84    // AIBrowser: 40px session tabs + 44px header
let TOOL_DOCK_W = 230    // right sidebar (ToolDock) — updated via view:setDockWidth IPC

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win
  win.on('resize', () => {
    if (activeTabId) {
      const view = viewCache.get(activeTabId)
      if (view) updateBounds(view)
    }
  })
}

export function setNavWidth(w: number) {
  NAV_WIDTH = w
  // Re-apply bounds immediately so the active WebContentsView resizes with the sidebar
  if (activeTabId) {
    const view = viewCache.get(activeTabId)
    if (view) updateBounds(view)
  }
}

export function setToolDockWidth(w: number) {
  TOOL_DOCK_W = w
  if (activeTabId) {
    const view = viewCache.get(activeTabId)
    if (view) updateBounds(view)
  }
}

function updateBounds(view: WebContentsView) {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()

  const insets = activeTabId ? customInsets.get(activeTabId) : undefined
  if (insets) {
    view.setBounds({
      x: insets.left,
      y: insets.top,
      width: Math.max(bounds.width - insets.left - insets.right, 100),
      height: Math.max(bounds.height - insets.top - insets.bottom, 100),
    })
    return
  }

  view.setBounds({
    x: NAV_WIDTH,
    y: TOP_HEIGHT,
    width: Math.max(bounds.width - NAV_WIDTH - TOOL_DOCK_W, 100),
    height: Math.max(bounds.height - TOP_HEIGHT, 100),
  })
}

/**
 * WhatsApp Web hard-blocks any browser it doesn't recognise: loaded as-is it
 * renders "WhatsApp works with Google Chrome 100+" instead of the app,
 * because Electron's default UA carries both a FlowDesk and an Electron
 * token. That check is client-side JS reading navigator.userAgent, so
 * rewriting the User-Agent *request header* (via webRequest) would not have
 * helped at all — webContents.setUserAgent is the right lever because it
 * changes both the header and what the page's own JS sees.
 *
 * Built by stripping those two tokens out of Electron's own UA rather than
 * hardcoding a Chrome version string: the underlying Chromium really is
 * there, so what remains stays truthful about it and keeps tracking whatever
 * Chromium an Electron upgrade brings — instead of freezing a version number
 * that goes stale silently and eventually trips the same block again.
 */
function chromeUserAgentFor(webContents: WebContents): string {
  return webContents.getUserAgent()
    .replace(/\s?Electron\/[^\s]+/g, '')
    .replace(/\s?FlowDesk\/[^\s]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Sites that treat the Electron/FlowDesk UA tokens as a bot. TikTok answers
 * profile video lists, hashtag lists and related videos with an empty 200
 * (header tt_orcas_res: 1) and its own profile page shows "Something went
 * wrong" under that UA, while search still works (live, 2026-09-28).
 */
function needsChromeUserAgent(url: string): boolean {
  return url.includes('web.whatsapp.com') || /^https:\/\/([a-z]+\.)?tiktok\.com\//.test(url) || url.includes('linkedin.com')
}

/**
 * Shared view-creation logic — used by both showView() (visible AI Browser /
 * other tabs) and ensureBackgroundView() (Universal Chat's
 * invisible per-provider worker tabs). Wires capture-injection and
 * OAuth/external-link handling identically either way; the only difference
 * is whether the caller ever attaches it to the window's contentView.
 */
/**
 * Chromium never writes a cookie without an expiry ("session cookie") to disk,
 * flush or no flush: it dies with the process. Reddit keeps its login in one,
 * so every FlowDesk restart signed Reddit out — the 30s flushAllCookies timer
 * could not help, the cookie is not eligible to be stored at all.
 *
 * For the social partitions, where staying signed in is the whole point, each
 * session cookie is re-set with a 30-day expiry the moment a site writes it.
 * The re-set cookie is no longer a session cookie, so this cannot loop.
 */
/**
 * Where the Social page last opened Reddit. The page puts Reddit in the chosen
 * Google account's partition (tab social-reddit-<email>), not "social-reddit",
 * so a background tool using the fixed name was reading a different, signed-out
 * profile — which looked exactly like "Reddit logs out on every restart".
 * Remembered on disk so the right profile is used before the page is opened.
 */
export interface RememberedView { tabId: string; partition: string }

function rememberFile(): string {
  return join(app.getPath('userData'), 'social-views.json')
}

export function rememberedView(platform: string): RememberedView | null {
  try {
    const all = JSON.parse(require('node:fs').readFileSync(rememberFile(), 'utf8')) as Record<string, RememberedView>
    const v = all[platform]
    return v && typeof v.tabId === 'string' && typeof v.partition === 'string' ? v : null
  } catch {
    return null
  }
}

function rememberView(url: string, tabId: string, partition: string): void {
  if (!url.includes('reddit.com') || !tabId.startsWith('social-reddit')) return
  try {
    const fs: typeof import('node:fs') = require('node:fs')
    let all: Record<string, RememberedView> = {}
    try { all = JSON.parse(fs.readFileSync(rememberFile(), 'utf8')) } catch { /* first write */ }
    if (all.reddit?.tabId === tabId && all.reddit?.partition === partition) return
    all.reddit = { tabId, partition }
    fs.writeFileSync(rememberFile(), JSON.stringify(all, null, 2))
  } catch { /* best effort — the fixed default still works for a fresh install */ }
}

const SESSION_COOKIE_TTL_S = 30 * 24 * 60 * 60
const persistingPartitions = new Set<string>()

export function persistSessionCookies(partition: string): void {
  if (!partition.startsWith('social-') || persistingPartitions.has(partition)) return
  persistingPartitions.add(partition)
  const ses = session.fromPartition(`persist:${partition}`)
  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed || !cookie.session || !cookie.domain) return
    const host = cookie.domain.replace(/^\./, '')
    void ses.cookies.set({
      url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      // A host-only cookie must stay host-only: passing domain would widen it.
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: Math.floor(Date.now() / 1000) + SESSION_COOKIE_TTL_S,
    }).catch(() => { /* a cookie Chromium refuses to re-set stays a session cookie */ })
  })
}

function createView(tabId: string, partition: string, url: string): { view: WebContentsView; created: boolean } {
  const existing = viewCache.get(tabId)
  if (existing) return { view: existing, created: false }

  // Prevent Chromium SQLite database and GPU cache locks: if an offscreen
  // background window already exists for this tabId, close it before opening
  // the interactive UI view on the same partition.
  destroyBackgroundWindow(tabId)

  persistSessionCookies(partition)
  rememberView(url, tabId, partition)
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      preload: WEBVIEW_PRELOAD,
      // Allow Chromium to throttle hidden/inactive views so navigating away from
      // AI Browser tabs doesn't keep 5-10 tabs spinning CPU/GPU in the background.
      backgroundThrottling: true,
    }
  })
  viewCache.set(tabId, view)


  // PoC: capture the streamed response as it arrives, live.
  //
  // Failures here used to be swallowed by a bare `.catch(() => {})`, which
  // made "the rule never matched" and "the rule matched but the script threw"
  // look identical from outside: nothing installed, nothing said why. That
  // cost a whole discovery session on LinkedIn. Injection is best-effort by
  // design — a provider page changing shape must not break the tab — but it
  // must be *audible*.
  view.webContents.on('dom-ready', () => {
    const currentUrl = view.webContents.getURL()

    // Discovery recorder, attached below the renderer rather than inside the
    // page. Page-level fetch/XHR hooks cannot see a Web Worker's traffic —
    // and a LinkedIn session that browsed messaging and sent a message
    // produced 201 captured calls with no messaging request among them, which
    // is only explicable if that work happens off the main thread. CDP sees
    // it regardless of which thread issued it.
    // Production feature, not discovery: taps LinkedIn's realtime message
    // channel. A page hook was tried first and could not see the connection at
    // all — see linkedinRealtimeWatch.ts for the evidence.
    if (currentUrl.includes('linkedin.com')) {
      startLinkedInRealtimeWatch(view.webContents, event => {
        mainWindow?.webContents.send('linkedin:event', event)
      })
    }

    // Discovery only. Writes captures containing real message text and contact
    // names, so it never runs in a packaged build.
    const cdpHost = app.isPackaged ? undefined : CDP_RECORDER_HOSTS.find(host => currentUrl.includes(host))
    // Every dom-ready, matched or not. Without this a view that never triggers
    // the recorder is indistinguishable from one where the recorder attached
    // and saw nothing -- the exact ambiguity that stalled the Google Flow
    // project-list capture, with the page provably open on screen.
    logCdpDecision(currentUrl, cdpHost, app.isPackaged)
    if (cdpHost) {
      startCdpRecorder({
        webContents: view.webContents,
        urlMatch: [cdpHost, ...(CDP_RECORDER_EXTRA_HOSTS[cdpHost] ?? [])],
        outFile: join(app.getAppPath(), 'probes', 'out', `_network-${cdpHost.replace(/\W+/g, '-')}.json`),
        onAttach: info => console.log(`[cdp] ${cdpHost}: ${info}`),
      })
    }

    const rule = CAPTURE_RULES.find(r => r.match(currentUrl))
    if (!rule) return
    view.webContents.executeJavaScript(rule.src)
      .then(() => console.log(`[capture] injected into ${currentUrl}`))
      .catch(error => console.log(`[capture] injection FAILED for ${currentUrl}:`, error?.message ?? error))
  })

  // ── External link / popup handling ────────────────────────
  //
  // This used to end with loadURL(openUrl) on the view itself, which meant a
  // link tapped inside WhatsApp navigated the WhatsApp view away from WhatsApp
  // — and the Social page has no tab strip to get back with. Links that leave
  // the hosted app now go to the user's own browser, where they have tabs and
  // a back button. See linkRouting.ts.
  const popupWindowOptions = {
    width: 500,
    height: 660,
    webPreferences: {
      session: view.webContents.session,
      nodeIntegration: false,
      contextIsolation: true,
    },
  }

  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    const decision = routeLink(openUrl, view.webContents.getURL())
    logLinkRoutingDecision('window-open', view.webContents.getURL(), openUrl, decision)
    switch (decision) {
      case 'oauth-popup':
        // A social view's Google popup opens hidden: prepareGooglePopup first
        // offers the Accounts-page Google accounts, then shows it.
        return { action: 'allow', overrideBrowserWindowOptions: wantsGoogleChooser(partition, openUrl) ? { ...popupWindowOptions, show: false } : popupWindowOptions }
      case 'in-app':
        view.webContents.loadURL(openUrl)
        return { action: 'deny' }
      default:
        shell.openExternal(openUrl)
        return { action: 'deny' }
    }
  })
  view.webContents.on('did-create-window', (child, { url: openUrl }) => {
    if (wantsGoogleChooser(partition, openUrl)) void prepareGooglePopup(child, openUrl, BrowserWindow.getFocusedWindow())
  })

  // window.open is only half of it: an ordinary target="_self" link never
  // reaches the handler above and would navigate the view just the same.
  //
  // This does not fire for webContents.loadURL, so the like and comment tools
  // can still drive the view to a post permalink and back.
  view.webContents.on('will-navigate', (event, targetUrl) => {
    const decision = routeLink(targetUrl, view.webContents.getURL())
    logLinkRoutingDecision('will-navigate', view.webContents.getURL(), targetUrl, decision)
    if (decision !== 'external') return
    event.preventDefault()
    void shell.openExternal(targetUrl)
  })

  // Must be set before the first loadURL: which page WhatsApp serves is
  // decided by the UA on that very navigation, so setting it afterwards
  // would still show the block screen until a manual reload.
  if (needsChromeUserAgent(url)) {
    view.webContents.setUserAgent(chromeUserAgentFor(view.webContents))
  }

  view.webContents.loadURL(url)
  return { view, created: true }
}

function silenceView(view: WebContentsView) {
  try {
    if (!view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(true)
      view.webContents.executeJavaScript(`
        try {
          document.querySelectorAll('video, audio').forEach(el => {
            if (!el.paused) el.pause()
          })
        } catch {}
      `).catch(() => {})
    }
  } catch {}
}

function restoreViewAudio(view: WebContentsView) {
  try {
    if (!view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(false)
    }
  } catch {}
}

export function showView(tabId: string, partition: string, url: string) {
  if (!mainWindow) return

  // Silence and detach current active view without destroying it
  if (activeTabId && activeTabId !== tabId) {
    const current = viewCache.get(activeTabId)
    if (current) {
      silenceView(current)
      try { mainWindow.contentView.removeChildView(current) } catch {}
    }
  }

  const { view } = createView(tabId, partition, url)

  activeTabId = tabId
  try { mainWindow.contentView.addChildView(view) } catch {}
  updateBounds(view)
  restoreViewAudio(view)
}

/**
 * Universal Chat's / the Agent orchestrator's per-provider worker windows:
 * invisible to the user, but real enough to drive with CDP input.
 *
 * Getting this right took ruling out three cheaper arrangements, each of
 * which broke a different half of the problem:
 *
 *  - Never attaching the view to any window at all leaves it with a
 *    0x0 layout no matter what setBounds() says. Claude's composer
 *    measured 0px wide, and its UI doesn't render a Send button at that
 *    width, so a message could be typed but never submitted.
 *  - Attaching it but parking it far off-screen (x:-3000) has the same
 *    effect — outside the window's canvas there is no real layout.
 *  - Attaching it on-screen and calling setVisible(false) fixes layout but
 *    breaks input: CDP's Input.dispatchKeyEvent goes through the
 *    RenderWidgetHost pipeline, which a hidden widget never services, so
 *    not one typed character arrived. (Input.insertText does still land,
 *    but only in the DOM — ProseMirror ignores it, so it's no use here.)
 *
 * What satisfies both is a real, shown window that the user simply cannot
 * see: full size, but fully transparent, click-through, and kept out of the
 * taskbar and the focus order.
 *
 * A FOURTH thing had to be ruled out too, once the Agent orchestrator
 * started sending several providers at once: putting every provider's view
 * as a sibling child of ONE shared hidden host window. Confirmed via real
 * terminal logs — firing CDP-typed input at several sibling
 * WebContentsViews concurrently made the typing silently fail ("typed text
 * did not land") on every one but whichever went first, while the exact
 * same calls made one at a time always landed. This matches a documented
 * Electron bug (WebContentsView children of one window steal each other's
 * focus on load) — so each provider now gets its OWN independent hidden
 * BrowserWindow instead of sharing one host, which gives each its own
 * real window-level focus and lets true concurrent typing actually work.
 */
function createHiddenWindow(partition: string): BrowserWindow {
  persistSessionCookies(partition)
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,       // will call showInactive() below
    opacity: 0,        // ...but completely invisible
    skipTaskbar: true,
    focusable: true,   // allows Chromium to process popup grabs without freezing
    frame: false,
    transparent: true,
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      preload: WEBVIEW_PRELOAD,
      backgroundThrottling: false,
    }
  })
  win.showInactive()
  win.setIgnoreMouseEvents(true) // clicks pass through to whatever's underneath
  return win
}

/**
 * Tears down a background worker window and forgets it, so the next
 * ensureBackgroundView() for this tabId builds a fresh one. Used when the UI
 * opens the same tabId (two Chromium instances on one partition lock its
 * SQLite stores) and when the worker's renderer crashes or hangs.
 */
function destroyBackgroundWindow(tabId: string) {
  const win = backgroundWindows.get(tabId)
  backgroundWindows.delete(tabId)
  backgroundReady.delete(tabId)
  if (win && !win.isDestroyed()) win.destroy()
}

export function ensureBackgroundView(tabId: string, partition: string, url: string): Promise<{ webContents: WebContents }> {
  // If the view is already open in the interactive UI, reuse its webContents directly
  // rather than spawning a second Chromium instance on the exact same partition (which locks SQLite).
  const uiView = viewCache.get(tabId)
  if (uiView && !uiView.webContents.isDestroyed()) {
    return Promise.resolve(uiView)
  }

  // A second caller arriving while the first load is still in flight must wait
  // for the same load. Handing it the window straight away ran its script
  // against a half-loaded page: Reddit threw "Script failed to execute" and
  // LinkedIn's /voyager/api/me answered 401 before the session was attached.
  const existing = backgroundWindows.get(tabId)
  if (existing && !existing.isDestroyed()) {
    return backgroundReady.get(tabId) ?? Promise.resolve(existing)
  }

  const win = createHiddenWindow(partition)
  backgroundWindows.set(tabId, win)
  win.on('closed', () => {
    // Only forget this window's own entries: 'closed' can arrive after a
    // replacement window for the same tabId was already registered.
    if (backgroundWindows.get(tabId) !== win) return
    backgroundWindows.delete(tabId)
    backgroundReady.delete(tabId)
  })

  // A crashed or hung renderer leaves a window that still looks alive in the
  // map, so every later tool call would reuse a dead page. Drop it instead and
  // let the next ensureBackgroundView() recreate it.
  const recover = (reason: string) => {
    if (backgroundWindows.get(tabId) !== win) return
    console.warn(`[bg:${tabId}] worker window ${reason}; destroying so the next call recreates it`)
    destroyBackgroundWindow(tabId)
  }
  win.webContents.on('render-process-gone', (_e, details) => recover(`renderer gone (${details.reason})`))
  win.on('unresponsive', () => recover('unresponsive'))

  // Forward this background window's own console.log calls to our
  // terminal — there's no visible DevTools to check on an invisible
  // window, and this is how injectPrompt's diagnostic logging (submit
  // method used, button found or not) actually becomes observable.
  win.webContents.on('console-message', (_e, _level, message) => {
    if (tabId.includes('tiktok')) {
      // Filter noisy telemetry, ads tracking SDKs, and normal website client errors
      if (
        message === 'Error' ||
        message === '.' ||
        message.startsWith('Error') ||
        message.includes('AppContext') ||
        message.includes('sibylSdk') ||
        message.includes('slardar') ||
        message.includes('deprecatedStyle') ||
        message.includes('ttap_vmok') ||
        message.includes('useMessageApi') ||
        message.includes('cookie_banner') ||
        message.includes('powerPreference') ||
        message.includes('Reflect is already polyfilled') ||
        message.includes('loadableReady') ||
        message.includes('filter merge event') ||
        message.includes('Electron Security Warning') ||
        message.includes('Close_button') ||
        message.includes('preloaded using link preload but not used') ||
        message.includes('was preloaded using link preload') ||
        message.includes('Upload.')
      ) {
        return
      }
    }
    console.log(`[bg:${tabId}]`, message)
  })

  // PoC: capture the streamed response as it arrives, live.
  win.webContents.on('dom-ready', () => {
    const currentUrl = win.webContents.getURL()

    // Same discovery recorder as createView(). Without it, anything the MCP
    // tools do headless was invisible to the harness: TikTok keeps its own
    // reference to fetch, so a page-level hook saw none of its signed search
    // calls, and there was no visible view to record from instead.
    const cdpHost = app.isPackaged ? undefined : CDP_RECORDER_HOSTS.find(host => currentUrl.includes(host))
    if (cdpHost) {
      startCdpRecorder({
        webContents: win.webContents,
        urlMatch: [cdpHost, ...(CDP_RECORDER_EXTRA_HOSTS[cdpHost] ?? [])],
        outFile: join(app.getAppPath(), 'probes', 'out', `_network-bg-${cdpHost.replace(/\W+/g, '-')}.json`),
        onAttach: info => console.log(`[cdp] bg ${cdpHost}: ${info}`),
      })
    }

    // Image workers (chatgptImages.ts) read results over the API; the SSE
    // capture would only download every image a second time.
    const rule = tabId.startsWith('cgimg-') ? undefined : CAPTURE_RULES.find(r => r.match(currentUrl))
    if (rule) win.webContents.executeJavaScript(rule.src).catch(() => {})
  })

  // Same OAuth/external-link handling as createView() — a background
  // provider tab can still hit an OAuth popup or an external link.
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (isOAuthPopup(openUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 660,
          webPreferences: {
            session: win.webContents.session,
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      }
    }
    // A background provider window is not something the user is looking at, so
    // navigating it to a link would strand the worker on a page it cannot use.
    if (routeLink(openUrl, win.webContents.getURL()) === 'external') {
      void shell.openExternal(openUrl)
      return { action: 'deny' }
    }
    win.webContents.loadURL(openUrl)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (routeLink(targetUrl, win.webContents.getURL()) !== 'external') return
    event.preventDefault()
    void shell.openExternal(targetUrl)
  })

  if (needsChromeUserAgent(url)) {
    win.webContents.setUserAgent(chromeUserAgentFor(win.webContents))
  }

  win.loadURL(url)

  const ready = new Promise<{ webContents: WebContents }>((resolve, reject) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (backgroundReady.get(tabId) === ready) backgroundReady.delete(tabId)
      // Destroyed before it ever loaded (crash, hang, or the UI took over the
      // tabId): handing callers a dead webContents only defers the failure.
      if (win.isDestroyed()) reject(new Error(`Background window for ${tabId} closed before it finished loading`))
      else resolve(win)
    }
    const timer = setTimeout(done, 15000) // don't hang forever on a slow/broken load
    win.webContents.once('did-finish-load', done)
    win.once('closed', done)
  })
  backgroundReady.set(tabId, ready)
  return ready
}

export function hideView(specificTabId?: string) {
  if (!mainWindow) return
  if (specificTabId) {
    const view = viewCache.get(specificTabId)
    if (view) {
      silenceView(view)
      try { mainWindow.contentView.removeChildView(view) } catch {}
    }
    if (activeTabId === specificTabId) {
      activeTabId = null
    }
    return
  }

  // Remove and silence all VISIBLE child views — ensures no stale view stays on top of
  // React UI or keeps playing audio/video in background. Background worker windows aren't in mainWindow's contentView
  // at all anymore (each is its own independent BrowserWindow), so there's
  // nothing to skip here.
  for (const [, view] of viewCache) {
    silenceView(view)
    try { mainWindow.contentView.removeChildView(view) } catch {}
  }
  // Reset activeTabId so setCustomBounds / updateBounds calls made after
  // hideView (e.g. from ResizeObserver callbacks) become no-ops
  activeTabId = null
}

export function closeTabView(tabId: string) {
  customInsets.delete(tabId)
  const view = viewCache.get(tabId)
  if (view) {
    silenceView(view)
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.stop()
        view.webContents.loadURL('about:blank').catch(() => {})
      }
    } catch {}
    try { mainWindow?.contentView.removeChildView(view) } catch {}
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {}
    viewCache.delete(tabId)
  }
  destroyBackgroundWindow(tabId)
  if (activeTabId === tabId) activeTabId = null
}

export function destroyAllViews() {
  for (const [, view] of viewCache) {
    silenceView(view)
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.stop()
        view.webContents.loadURL('about:blank').catch(() => {})
      }
      mainWindow?.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {}
  }
  viewCache.clear()
  for (const [, win] of backgroundWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  backgroundWindows.clear()
  backgroundReady.clear()
  activeTabId = null
}

export interface PrewarmTarget {
  tabId: string
  partition: string
  url: string
}

/**
 * Opens background worker windows at startup so agent/MCP tools find a
 * logged-in page already loaded instead of paying the first-load cost (or
 * failing because nobody opened the platform in the UI). Uses the exact
 * tabId/partition the platform modules pass to ensureBackgroundView(), so their
 * later calls reuse these windows. A partition with no cookies has never been
 * logged in, so it is skipped rather than spawning a login page nobody sees.
 * Staggered so several heavy web apps don't start loading in the same instant.
 */
export async function prewarmBackgroundViews(targets: PrewarmTarget[], staggerMs = 3000): Promise<void> {
  let first = true
  for (const target of targets) {
    try {
      if (viewCache.has(target.tabId) || backgroundWindows.has(target.tabId)) continue
      const cookies = await session.fromPartition(`persist:${target.partition}`).cookies.get({})
      if (cookies.length === 0) {
        console.log(`[prewarm] ${target.tabId}: no session cookies, skipping`)
        continue
      }
      if (!first) await new Promise(resolve => setTimeout(resolve, staggerMs))
      first = false
      // The UI may have opened this tab during the stagger delay.
      if (viewCache.has(target.tabId)) continue
      console.log(`[prewarm] ${target.tabId}: opening background view`)
      ensureBackgroundView(target.tabId, target.partition, target.url)
        .catch(err => console.warn(`[prewarm] ${target.tabId} failed:`, err?.message ?? err))
    } catch (err) {
      console.warn(`[prewarm] ${target.tabId} failed:`, (err as Error)?.message ?? err)
    }
  }
}

/** The live WhatsApp view, if one is open — main process send/lookup path. */
/**
 * The first live view whose URL contains `match`.
 *
 * Deliberately generic rather than one hardcoded lookup per platform: the
 * discovery probe runner (electron/discovery/probeRunner.ts) needs to reach
 * whatever site is being reverse-engineered next, and a per-platform copy of
 * this loop would mean editing sessions.ts every time.
 */
export function findViewByUrl(match: string): WebContentsView | null {
  for (const view of viewCache.values()) {
    try {
      if (view.webContents.getURL().includes(match)) return view
    } catch { /* destroyed */ }
  }
  return null
}

/** Every live view URL, for error messages that have to say what IS open. */
export function listViewUrls(): string[] {
  const urls: string[] = []
  for (const view of viewCache.values()) {
    try { urls.push(view.webContents.getURL()) } catch { /* destroyed */ }
  }
  return urls
}

export function getWhatsAppView(): { webContents: WebContents } | null {
  return findAnyViewByUrl('web.whatsapp.com')
}

export function getActiveView(): WebContentsView | null {
  if (!activeTabId) return null
  return viewCache.get(activeTabId) ?? null
}

/** Look up a view/background window by explicit tabId — works even when hidden */
export function getViewById(tabId: string): { webContents: WebContents } | null {
  return viewCache.get(tabId) ?? backgroundWindows.get(tabId) ?? null
}

/**
 * Resolves capture IPC back to the tab/window that produced it. Provider name
 * alone is not a safe correlation key: Agent and Universal Chat can both use
 * the same provider concurrently. The main process uses this boundary to
 * attach capture events to the exact Universal Chat request that owns it.
 */
export function getTabIdForWebContents(webContentsId: number): string | null {
  for (const [tabId, view] of viewCache) {
    if (view.webContents.id === webContentsId) return tabId
  }
  for (const [tabId, win] of backgroundWindows) {
    if (!win.isDestroyed() && win.webContents.id === webContentsId) return tabId
  }
  return null
}

/**
 * The hidden background window an ask_<tool> browser-worker call actually
 * drives, by tool name alone — bypassing the "visible tab first" order
 * `findAnyViewByUrl` uses.
 *
 * Needed for discovery probes specifically: a generic URL-substring probe
 * target (e.g. "chatgpt.com") can attach to whatever visible AI Browser tab
 * happens to be open on that site instead of the actual hidden worker tab
 * browserWorkerQueue.ts is driving — confirmed by a real probe run that
 * watched a tab where nothing was happening for 200s straight while a real
 * ask_chatgpt call was genuinely in progress elsewhere. tabIds are
 * `agent-<partition>-<tool>` (see browserWorkerQueue.ts), one per
 * account/tool pair, so this returns the first live match for the tool
 * regardless of which account it belongs to.
 */
export function findWorkerViewByTool(tool: string): { webContents: WebContents } | null {
  const suffix = `-${tool}`
  for (const [tabId, win] of backgroundWindows) {
    if (tabId.startsWith('agent-') && tabId.endsWith(suffix) && !win.isDestroyed()) return win
  }
  return null
}

export function setCustomBounds(x: number, y: number, w: number, h: number) {
  if (!mainWindow || !activeTabId) return
  const view = viewCache.get(activeTabId)
  if (!view) return

  // Remember the gaps, not the rectangle, so a later resize can reproduce this
  // layout instead of falling back to the AI Browser one.
  const bounds = mainWindow.getContentBounds()
  customInsets.set(activeTabId, {
    left: x,
    top: y,
    right: Math.max(bounds.width - (x + w), 0),
    bottom: Math.max(bounds.height - (y + h), 0),
  })

  view.setBounds({ x, y, width: w, height: h })
}

export function goBack() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view?.webContents.canGoBack()) view.webContents.goBack()
}

export function goForward() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view?.webContents.canGoForward()) view.webContents.goForward()
}

export function reloadActive() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  view?.webContents.reload()
}

export function navigateActive(url: string) {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view) view.webContents.loadURL(url)
}

/**
 * Like findViewByUrl, but also searches the hidden background worker windows
 * (the `universalchat-<tool>` windows browserWorkerQueue.ts drives).
 *
 * Discovery needs this: the provider session that actually generates an
 * image is a background window, which findViewByUrl cannot see at all — so a
 * probe aimed at "chatgpt.com" would silently resolve to nothing, or worse,
 * to a *different* visible tab logged into a different account.
 */
export function findAnyViewByUrl(match: string): { webContents: WebContents } | null {
  const visible = findViewByUrl(match)
  if (visible) return visible
  for (const win of backgroundWindows.values()) {
    try {
      if (!win.isDestroyed() && win.webContents.getURL().includes(match)) return win
    } catch { /* destroyed */ }
  }
  return null
}

/**
 * Writes every open view's cookies to disk. Chromium batches cookie writes, so
 * a session a site rotated minutes ago (Reddit refreshes its login this way)
 * can exist only in memory — and a dev restart kills the process without a
 * clean shutdown, which is one way a platform comes back signed out.
 */
export async function flushAllCookies(): Promise<void> {
  const sessions = new Set<Electron.Session>()
  for (const view of viewCache.values()) {
    try { if (!view.webContents.isDestroyed()) sessions.add(view.webContents.session) } catch { /* gone */ }
  }
  for (const win of backgroundWindows.values()) {
    try { if (!win.isDestroyed()) sessions.add(win.webContents.session) } catch { /* gone */ }
  }
  await Promise.all([...sessions].map(s => s.cookies.flushStore().catch(() => {})))
}
