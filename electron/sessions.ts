import { app, session, WebContentsView, BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'path'
import { isOAuthPopup } from './oauthRouting'
import { routeLink } from './linkRouting'
import { WHATSAPP_BRIDGE_SRC } from './whatsappInject'
import { startLinkedInRealtimeWatch } from './linkedinRealtimeWatch'
import { startCdpRecorder } from './discovery/cdpRecorder'
import { CHATGPT_CAPTURE_SRC, CLAUDE_CAPTURE_SRC, GEMINI_CAPTURE_SRC, GROK_CAPTURE_SRC, PERPLEXITY_CAPTURE_SRC, QWEN_CAPTURE_SRC } from './captureInject'

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

const CDP_RECORDER_HOSTS = ['linkedin.com', 'facebook.com', 'flow.google.com', 'labs.google']

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
  'flow.google.com': ['aisandbox-pa.googleapis.com', 'labs.google', 'googleusercontent.com'],
  'labs.google': ['aisandbox-pa.googleapis.com'],
}

// PoC: per-provider fetch-tee capture, matched by hostname.
const CAPTURE_RULES: { match: (url: string) => boolean; src: string }[] = [
  { match: url => url.includes('chatgpt.com'), src: CHATGPT_CAPTURE_SRC },
  { match: url => url.includes('claude.ai'), src: CLAUDE_CAPTURE_SRC },
  { match: url => url.includes('gemini.google.com'), src: GEMINI_CAPTURE_SRC },
  { match: url => url.includes('grok.com'), src: GROK_CAPTURE_SRC },
  { match: url => url.includes('perplexity.ai'), src: PERPLEXITY_CAPTURE_SRC },
  { match: url => url.includes('chat.qwen.ai'), src: QWEN_CAPTURE_SRC },
  // Not a tee like the rules above: WhatsApp's wire is encrypted binary, so
  // this reads the page's own decrypted store instead. See whatsappInject.ts
  // for what the three discovery passes established.
  { match: url => url.includes('web.whatsapp.com'), src: WHATSAPP_BRIDGE_SRC },
]

const viewCache = new Map<string, WebContentsView>()
// Universal Chat's / the Agent orchestrator's per-provider worker
// windows — see ensureBackgroundView() for why each provider gets its own
// dedicated BrowserWindow rather than sharing viewCache/mainWindow at all.
const backgroundWindows = new Map<string, BrowserWindow>()
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
 * Shared view-creation logic — used by both showView() (visible AI Browser /
 * other tabs) and ensureBackgroundView() (Universal Chat's
 * invisible per-provider worker tabs). Wires capture-injection and
 * OAuth/external-link handling identically either way; the only difference
 * is whether the caller ever attaches it to the window's contentView.
 */
function createView(tabId: string, partition: string, url: string): { view: WebContentsView; created: boolean } {
  const existing = viewCache.get(tabId)
  if (existing) return { view: existing, created: false }

  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      preload: WEBVIEW_PRELOAD,
      // Universal Chat's worker tabs live permanently off-screen, which
      // Chromium treats as hidden — and per Electron's own source, a hidden
      // renderer gets throttled to the point where "input processing can
      // stall". That silently breaks agent work in a background
      // tab, so opt every view out of the throttling.
      backgroundThrottling: false,
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
        return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions }
      case 'in-app':
        view.webContents.loadURL(openUrl)
        return { action: 'deny' }
      default:
        shell.openExternal(openUrl)
        return { action: 'deny' }
    }
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
  if (url.includes('web.whatsapp.com')) {
    view.webContents.setUserAgent(chromeUserAgentFor(view.webContents))
  }

  view.webContents.loadURL(url)
  return { view, created: true }
}

export function showView(tabId: string, partition: string, url: string) {
  if (!mainWindow) return

  // Hide current active view without destroying it
  if (activeTabId && activeTabId !== tabId) {
    const current = viewCache.get(activeTabId)
    if (current) {
      try { mainWindow.contentView.removeChildView(current) } catch {}
    }
  }

  const { view } = createView(tabId, partition, url)

  activeTabId = tabId
  try { mainWindow.contentView.addChildView(view) } catch {}
  updateBounds(view)
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
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,        // must genuinely be shown — see above
    opacity: 0,        // ...but completely invisible
    skipTaskbar: true,
    focusable: false,  // never steals focus from the real window
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
  win.setIgnoreMouseEvents(true) // clicks pass through to whatever's underneath
  return win
}

export function ensureBackgroundView(tabId: string, partition: string, url: string): Promise<{ webContents: WebContents }> {
  const existing = backgroundWindows.get(tabId)
  if (existing) return Promise.resolve(existing)

  const win = createHiddenWindow(partition)
  backgroundWindows.set(tabId, win)

  // Forward this background window's own console.log calls to our
  // terminal — there's no visible DevTools to check on an invisible
  // window, and this is how injectPrompt's diagnostic logging (submit
  // method used, button found or not) actually becomes observable.
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[bg:${tabId}]`, message)
  })

  // PoC: capture the streamed response as it arrives, live.
  win.webContents.on('dom-ready', () => {
    const currentUrl = win.webContents.getURL()
    const rule = CAPTURE_RULES.find(r => r.match(currentUrl))
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

  win.loadURL(url)

  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(win), 15000) // don't hang forever on a slow/broken load
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve(win)
    })
  })
}

export function hideView() {
  if (!mainWindow) return
  // Remove all VISIBLE child views — ensures no stale view stays on top of
  // React UI. Background worker windows aren't in mainWindow's contentView
  // at all anymore (each is its own independent BrowserWindow), so there's
  // nothing to skip here.
  for (const [, view] of viewCache) {
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
    try { mainWindow?.contentView.removeChildView(view) } catch {}
    viewCache.delete(tabId)
  }
  const bgWin = backgroundWindows.get(tabId)
  if (bgWin) {
    if (!bgWin.isDestroyed()) bgWin.destroy()
    backgroundWindows.delete(tabId)
  }
  if (activeTabId === tabId) activeTabId = null
}

export function destroyAllViews() {
  for (const [, view] of viewCache) {
    try { mainWindow?.contentView.removeChildView(view) } catch {}
  }
  viewCache.clear()
  for (const [, win] of backgroundWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  backgroundWindows.clear()
  activeTabId = null
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

export function getWhatsAppView(): WebContentsView | null {
  return findViewByUrl('web.whatsapp.com')
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
