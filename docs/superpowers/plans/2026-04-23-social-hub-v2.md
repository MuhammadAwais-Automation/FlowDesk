# Social Hub v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Social Hub with mobile emulation preload, bug fixes, and a 12-app dock system (max 3 side-by-side frames, right sidebar icons, LRU eviction).

**Architecture:** Three phases executed sequentially — Phase 1 adds preload-based mobile emulation to existing 3-frame UI; Phase 2 fixes current-code bugs; Phase 3 replaces the 3-frame layout with a dock + canvas composed from 12 configurable apps.

**Tech Stack:** Electron 41 (WebContentsView, preload scripts, IPC), React 18, TypeScript, Zustand 4, Tailwind CSS, Lucide icons, electron-vite, `document.execCommand`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `electron/socialPreload.ts` | Create | Injected into every social WebContentsView — spoofs navigator, patches matchMedia, hides install banners |
| `electron.vite.config.ts` | Modify | Add second preload build entry for socialPreload |
| `electron/socialHub.ts` | Modify | Wire preload path, add destroySocialView, did-fail-load handler, shell.openExternal for popups |
| `electron/main.ts` | Modify | Add `social:destroy` IPC; emit `social:load-fail` events; accept selector in inject |
| `electron/preload.ts` | Modify | Add `socialDestroy`, `onSocialLoadFail`/`offSocialLoadFail`, update `socialInjectText` signature |
| `src/config/socialApps.ts` | Create | 12-app config (id, name, url, color, icon, injectSelector) |
| `src/store/useSocialStore.ts` | Create | Zustand: openFrames (LRU, max 3), activeFrame, persistence |
| `src/components/social/AppDock.tsx` | Create | Right sidebar, 12 icon buttons, toggle open/close |
| `src/components/social/PlatformCard.tsx` | Create | Single app frame card with header + close button |
| `src/components/social/FrameCanvas.tsx` | Create | 0/1/2/3 frame layouts, hosts the cards, bounds sync |
| `src/pages/SocialHub.tsx` | Rewrite | Thin composer over AppDock + FrameCanvas + Global Composer |

---

# PHASE 1 — Mobile Emulation Foundation

## Task 1: Create the social preload script

**Files:**
- Create: `electron/socialPreload.ts`

- [ ] **Step 1: Write the preload script**

```typescript
// electron/socialPreload.ts
// Injected into every social WebContentsView BEFORE page scripts run.
// Spoofs navigator / screen / matchMedia to convince mobile websites
// this is a real iPhone, and hides install-app banners via CSS.

try {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
  Object.defineProperty(navigator, 'platform',       { value: 'iPhone', configurable: true })
  Object.defineProperty(navigator, 'vendor',         { value: 'Apple Computer, Inc.', configurable: true })
} catch {}

try {
  Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true, writable: true })
} catch {}

// Patch matchMedia so (hover: none) / (pointer: coarse) report true
try {
  const orig = window.matchMedia.bind(window)
  const fake = (matches: boolean, media: string): MediaQueryList => ({
    matches, media, onchange: null,
    addListener()    {}, removeListener()    {},
    addEventListener(){}, removeEventListener(){},
    dispatchEvent() { return false },
  } as unknown as MediaQueryList)

  window.matchMedia = (q: string): MediaQueryList => {
    if (q.includes('hover: none')      || q.includes('pointer: coarse')) return fake(true,  q)
    if (q.includes('hover: hover')     || q.includes('pointer: fine'))   return fake(false, q)
    return orig(q)
  }
} catch {}

// Inject CSS to hide common install-app banners & promos after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    const style = document.createElement('style')
    style.setAttribute('data-flowdesk', 'hide-install-banners')
    style.textContent = `
      /* Facebook: "Get Facebook for iOS and browse faster" */
      a[href*="apps.facebook.com"],
      a[href*="itunes.apple.com/app/facebook"],
      div[role="banner"]:has(a[href*="apps.facebook.com"]),
      [data-testid*="app_install"i],
      [aria-label*="get facebook"i] { display: none !important; }

      /* Instagram: install / open-in-app banners & promos */
      div[class*="AppInstallBanner"],
      [aria-label*="install app"i],
      [data-testid="app_install_banner"] { display: none !important; }

      /* Twitter / X: "Don't miss what's happening" bottom sheet */
      div[data-testid="BottomBar"] { display: none !important; }
    `
    document.head.appendChild(style)
  } catch {}
})
```

- [ ] **Step 2: Commit**

```bash
git add electron/socialPreload.ts
git commit -m "feat(social): add preload for mobile emulation + banner hiding"
```

---

## Task 2: Build the social preload via electron-vite

**Files:**
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: Add second preload entry**

Replace the `preload:` block in `electron.vite.config.ts`:

```typescript
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload:       resolve('electron/preload.ts'),
          socialPreload: resolve('electron/socialPreload.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
```

- [ ] **Step 2: Build and verify output**

```bash
npm run build
```

Expected: `out/preload/preload.js` AND `out/preload/socialPreload.js` both exist.

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts
git commit -m "build: add socialPreload entry"
```

---

## Task 3: Wire preload path into social WebContentsViews

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Add `join` import and set preload path**

At top of `electron/socialHub.ts`, add:

```typescript
import { join } from 'path'
```

Then update the `new WebContentsView(...)` call inside `showSocialView`:

```typescript
    view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        preload: join(__dirname, '../preload/socialPreload.js'),
        nodeIntegration: false,
        contextIsolation: false,
      }
    })
```

**Important:** `contextIsolation` changed from `true` to `false`. The preload needs to override `navigator` and `window` properties directly — with context isolation on, overrides run in an isolated world and don't affect the page scripts. Social sites don't interact with Electron APIs so this is safe.

- [ ] **Step 2: Run the dev build and verify**

```bash
npm run dev
```

In the app, open Social Hub. Right-click a frame → Inspect (if dev tools enabled). In console:
```js
navigator.maxTouchPoints   // → 5
navigator.platform          // → "iPhone"
window.matchMedia('(pointer: coarse)').matches   // → true
```

Also: Facebook's "Get Facebook for iOS" banner should NOT appear at the top of the Facebook frame.

- [ ] **Step 3: Commit**

```bash
git add electron/socialHub.ts
git commit -m "feat(social): inject socialPreload into WebContentsViews"
```

---

# PHASE 2 — Bug Fixes

## Task 4: Fix race condition — synchronous initial frame size

**Files:**
- Modify: `src/pages/SocialHub.tsx`

**Problem:** `useState({ w: 390, h: 844 })` plus `calcFrameSize()` in `useEffect` means the first `syncBounds()` call reads DOM sized 390×844 (not the calculated scale). First `setZoomFactor` call is wrong, causing a brief flash.

- [ ] **Step 1: Replace `frameSize` initialization with a synchronous initializer**

In `src/pages/SocialHub.tsx`, find:

```typescript
const [frameSize,    setFrameSize]    = useState({ w: PHONE_W, h: PHONE_H })
```

Replace with:

```typescript
const [frameSize, setFrameSize] = useState(() => {
  const navW       = Number(localStorage.getItem('navWidth') || '172')
  const COMPOSER_H = 82
  const V_PADDING  = 48
  const H_PADDING  = 80
  const GAP        = 40

  const availH = window.innerHeight - COMPOSER_H - V_PADDING
  const availW = (window.innerWidth - navW - H_PADDING - GAP * 2) / 3

  const scale = Math.min(1, availH / PHONE_H, availW / PHONE_W)
  return { w: Math.round(PHONE_W * scale), h: Math.round(PHONE_H * scale) }
})
```

Now the initial render uses the correctly scaled frame size, so the first `syncBounds()` call sends correct bounds + zoom factor.

- [ ] **Step 2: Verify visually**

Run `npm run dev`. Open Social Hub. The frames should appear at the right size on the very first render — no flash of oversized frames.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SocialHub.tsx
git commit -m "fix(social): compute initial frame size synchronously to avoid zoom flash"
```

---

## Task 5: Add `did-fail-load` handler and destroySocialView

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Add load-fail callback and destroy export**

At top of `electron/socialHub.ts`, add this after `let mainWindow`:

```typescript
type LoadFailHandler = (id: string, errorDescription: string) => void
let loadFailHandler: LoadFailHandler | null = null

export function setSocialLoadFailHandler(handler: LoadFailHandler) {
  loadFailHandler = handler
}
```

Inside `showSocialView`, right after the existing `did-finish-load` handler, add:

```typescript
    view.webContents.on('did-fail-load', (_e, _code, description, validatedURL) => {
      // Ignore sub-resource failures; only react to main-frame failures
      if (validatedURL && loadFailHandler) loadFailHandler(id, description || 'Load failed')
    })
```

At the bottom of the file, add `destroySocialView`:

```typescript
export function destroySocialView(id: string) {
  if (!mainWindow) return
  const view = socialCache.get(id)
  if (!view) return
  try { mainWindow.contentView.removeChildView(view) } catch {}
  try { view.webContents.close() } catch {}
  socialCache.delete(id)
  viewWidths.delete(id)
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/socialHub.ts
git commit -m "feat(social): add did-fail-load handler and destroySocialView"
```

---

## Task 6: External links open in system browser

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Import shell and update setWindowOpenHandler**

At top of `electron/socialHub.ts`, update the electron import:

```typescript
import { session, WebContentsView, BrowserWindow, shell } from 'electron'
```

Replace the existing `setWindowOpenHandler` in `showSocialView`:

```typescript
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      shell.openExternal(openUrl).catch(() => {})
      return { action: 'deny' }
    })
```

- [ ] **Step 2: Verify**

Run `npm run dev`. In a social frame, click a link that would normally open in a new tab (e.g. an external website link on Twitter). It should open in the user's default browser, not replace the current frame content.

- [ ] **Step 3: Commit**

```bash
git add electron/socialHub.ts
git commit -m "feat(social): route popup links to system browser via shell.openExternal"
```

---

## Task 7: Wire destroy + load-fail IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Update socialHub import in `electron/main.ts`**

Find:
```typescript
import { setSocialMainWindow, showSocialView, hideAllSocialViews, setSocialBounds, injectSocialText } from './socialHub'
```

Replace with:
```typescript
import {
  setSocialMainWindow, showSocialView, hideAllSocialViews, setSocialBounds,
  injectSocialText, destroySocialView, setSocialLoadFailHandler,
} from './socialHub'
```

- [ ] **Step 2: Register load-fail handler after window is created**

In `electron/main.ts`, find the `createWindow()` function. Right after `setSocialMainWindow(mainWindow)` (or wherever social main window is set), add:

```typescript
  setSocialLoadFailHandler((id, description) => {
    mainWindow?.webContents.send('social:load-fail', { id, description })
  })
```

If `setSocialMainWindow` isn't called from inside `createWindow`, find where `mainWindow` is created and add the handler call right after the window is available.

- [ ] **Step 3: Add `social:destroy` IPC handler**

In `electron/main.ts`, find the existing social IPC block (around the line with `ipcMain.handle('social:inject', ...)`). Add one line after `social:inject`:

```typescript
ipcMain.handle('social:destroy', (_e, id: string) => destroySocialView(id))
```

- [ ] **Step 4: Expose to renderer in `electron/preload.ts`**

In `electron/preload.ts`, find the Social Hub section. After `socialInjectText`, add:

```typescript
  socialDestroy:        (id: string) => ipcRenderer.invoke('social:destroy', id),
  onSocialLoadFail:     (cb: (e: unknown, payload: { id: string; description: string }) => void) => ipcRenderer.on('social:load-fail', cb),
  offSocialLoadFail:    (cb: (e: unknown, payload: { id: string; description: string }) => void) => ipcRenderer.removeListener('social:load-fail', cb),
```

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(social): wire destroy IPC and load-fail events"
```

---

# PHASE 3 — Dock + Canvas UI

## Task 8: Create the social apps config

**Files:**
- Create: `src/config/socialApps.ts`

- [ ] **Step 1: Write the 12-app definition**

```typescript
// src/config/socialApps.ts
export interface SocialApp {
  id:              string
  name:            string
  url:             string
  color:           string
  icon:            string                 // lucide-react icon component name
  injectSelector?: string                 // selector for composer text injection
}

export const SOCIAL_APPS: SocialApp[] = [
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/',       color: '#E1306C', icon: 'Instagram',     injectSelector: 'div[contenteditable="true"]' },
  { id: 'facebook',  name: 'Facebook',  url: 'https://www.facebook.com/',        color: '#1877F2', icon: 'Facebook',      injectSelector: 'div[contenteditable="true"][role="textbox"]' },
  { id: 'twitter',   name: 'Twitter',   url: 'https://twitter.com/',             color: '#000000', icon: 'Twitter',       injectSelector: 'div[data-testid="tweetTextarea_0"]' },
  { id: 'threads',   name: 'Threads',   url: 'https://www.threads.net/',         color: '#000000', icon: 'AtSign' },
  { id: 'tiktok',    name: 'TikTok',    url: 'https://www.tiktok.com/',          color: '#000000', icon: 'Music' },
  { id: 'linkedin',  name: 'LinkedIn',  url: 'https://www.linkedin.com/',        color: '#0A66C2', icon: 'Linkedin' },
  { id: 'pinterest', name: 'Pinterest', url: 'https://www.pinterest.com/',       color: '#E60023', icon: 'Image' },
  { id: 'reddit',    name: 'Reddit',    url: 'https://www.reddit.com/',          color: '#FF4500', icon: 'MessageCircle' },
  { id: 'youtube',   name: 'YouTube',   url: 'https://m.youtube.com/',           color: '#FF0000', icon: 'Youtube' },
  { id: 'telegram',  name: 'Telegram',  url: 'https://web.telegram.org/',        color: '#26A5E4', icon: 'Send' },
  { id: 'discord',   name: 'Discord',   url: 'https://discord.com/channels/@me', color: '#5865F2', icon: 'MessageSquare' },
  { id: 'whatsapp',  name: 'WhatsApp',  url: 'https://web.whatsapp.com/',        color: '#25D366', icon: 'Phone' },
]

export function getApp(id: string): SocialApp | undefined {
  return SOCIAL_APPS.find(a => a.id === id)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/socialApps.ts
git commit -m "feat(social): add 12-app configuration"
```

---

## Task 9: Create the Zustand store

**Files:**
- Create: `src/store/useSocialStore.ts`

- [ ] **Step 1: Write the store with LRU + localStorage persistence**

```typescript
// src/store/useSocialStore.ts
import { create } from 'zustand'

const MAX_OPEN  = 3
const LS_KEY    = 'socialHubState'

interface PersistedState {
  openFrames:  string[]
  activeFrame: string | null
}

function loadFromStorage(): PersistedState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { openFrames: [], activeFrame: null }
    const parsed = JSON.parse(raw) as PersistedState
    const open = Array.isArray(parsed.openFrames) ? parsed.openFrames.slice(0, MAX_OPEN) : []
    const active = typeof parsed.activeFrame === 'string' && open.includes(parsed.activeFrame)
      ? parsed.activeFrame
      : open[0] ?? null
    return { openFrames: open, activeFrame: active }
  } catch {
    return { openFrames: [], activeFrame: null }
  }
}

function saveToStorage(s: PersistedState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}

interface SocialState extends PersistedState {
  openApp:   (id: string) => void
  closeApp:  (id: string) => void
  toggleApp: (id: string) => void
  setActive: (id: string | null) => void
}

export const useSocialStore = create<SocialState>((set, get) => ({
  ...loadFromStorage(),

  openApp: (id) => set(state => {
    if (state.openFrames.includes(id)) {
      // already open — just focus
      const next = { ...state, activeFrame: id }
      saveToStorage(next)
      return next
    }
    let open = [...state.openFrames, id]
    if (open.length > MAX_OPEN) open = open.slice(open.length - MAX_OPEN)  // drop oldest
    const next = { openFrames: open, activeFrame: id }
    saveToStorage(next)
    return next
  }),

  closeApp: (id) => set(state => {
    const open = state.openFrames.filter(x => x !== id)
    const active = state.activeFrame === id ? (open[open.length - 1] ?? null) : state.activeFrame
    const next = { openFrames: open, activeFrame: active }
    saveToStorage(next)
    return next
  }),

  toggleApp: (id) => {
    const { openFrames, openApp, closeApp } = get()
    if (openFrames.includes(id)) closeApp(id)
    else openApp(id)
  },

  setActive: (id) => set(state => {
    const next = { ...state, activeFrame: id }
    saveToStorage(next)
    return next
  }),
}))
```

- [ ] **Step 2: Commit**

```bash
git add src/store/useSocialStore.ts
git commit -m "feat(social): add zustand store with LRU + persistence"
```

---

## Task 10: Build the AppDock component

**Files:**
- Create: `src/components/social/AppDock.tsx`

- [ ] **Step 1: Write the dock component**

```tsx
// src/components/social/AppDock.tsx
import * as Icons from 'lucide-react'
import { SOCIAL_APPS, SocialApp } from '@/config/socialApps'
import { useSocialStore } from '@/store/useSocialStore'

export default function AppDock() {
  const openFrames  = useSocialStore(s => s.openFrames)
  const activeFrame = useSocialStore(s => s.activeFrame)
  const toggleApp   = useSocialStore(s => s.toggleApp)
  const setActive   = useSocialStore(s => s.setActive)

  return (
    <aside
      style={{
        width: '56px', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '12px 0', gap: '6px',
        borderLeft: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'auto',
      }}
    >
      {SOCIAL_APPS.map(app => {
        const isOpen   = openFrames.includes(app.id)
        const isActive = activeFrame === app.id
        return (
          <DockButton
            key={app.id}
            app={app}
            isOpen={isOpen}
            isActive={isActive}
            onClick={() => {
              if (isOpen) setActive(app.id)
              else        toggleApp(app.id)
            }}
            onDoubleClick={() => toggleApp(app.id)}
          />
        )
      })}
    </aside>
  )
}

interface DockButtonProps {
  app: SocialApp
  isOpen: boolean
  isActive: boolean
  onClick: () => void
  onDoubleClick: () => void
}

function DockButton({ app, isOpen, isActive, onClick, onDoubleClick }: DockButtonProps) {
  const Icon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>>)[app.icon] || Icons.Globe
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={`${app.name}${isOpen ? ' (double-click to close)' : ''}`}
      style={{
        width: '40px', height: '40px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '10px', border: 'none', cursor: 'pointer',
        background: isActive ? `${app.color}18` : (isOpen ? 'var(--surface-2)' : 'transparent'),
        outline: isActive ? `2px solid ${app.color}` : 'none',
        outlineOffset: '-2px',
        transition: 'background 0.15s, outline 0.15s',
        position: 'relative',
      }}
    >
      <Icon size={18} strokeWidth={1.8} color={isActive ? app.color : 'var(--text-2)'} />
      {isOpen && !isActive && (
        <span style={{
          position: 'absolute', bottom: '3px', right: '3px',
          width: '6px', height: '6px', borderRadius: '50%',
          background: app.color,
        }} />
      )}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/social/AppDock.tsx
git commit -m "feat(social): AppDock — right sidebar with 12 app icons"
```

---

## Task 11: Build the PlatformCard component

**Files:**
- Create: `src/components/social/PlatformCard.tsx`

- [ ] **Step 1: Write the card**

```tsx
// src/components/social/PlatformCard.tsx
import { forwardRef } from 'react'
import { X } from 'lucide-react'
import type { SocialApp } from '@/config/socialApps'

interface Props {
  app:      SocialApp
  width:    number
  height:   number
  isActive: boolean
  onClick:  () => void
  onClose:  () => void
}

export const HEADER_H = 44

const PlatformCard = forwardRef<HTMLDivElement, Props>(function PlatformCard(
  { app, width, height, isActive, onClick, onClose }, ref
) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        width: `${width}px`, height: `${height}px`,
        flexShrink: 0,
        borderRadius: '14px', overflow: 'hidden',
        border: isActive ? `1.5px solid ${app.color}` : '1.5px solid var(--border)',
        boxShadow: isActive
          ? `0 0 0 3px ${app.color}22, 0 8px 32px rgba(0,0,0,0.12)`
          : '0 4px 20px rgba(0,0,0,0.08)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        cursor: 'pointer', background: 'var(--surface)',
      }}
    >
      {/* Header */}
      <div style={{
        height: `${HEADER_H}px`, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '9px',
        padding: '0 10px 0 14px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-soft)',
      }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: app.color, flexShrink: 0,
        }} />
        <span style={{
          fontSize: '13px', fontWeight: 600,
          color: isActive ? app.color : 'var(--text)',
          transition: 'color 0.2s',
          fontFamily: 'var(--font-display, inherit)',
        }}>
          {app.name}
        </span>
        {isActive && (
          <span style={{
            marginLeft: 'auto', fontSize: '11px',
            color: app.color, opacity: 0.8, fontWeight: 500, marginRight: '4px',
          }}>
            Active
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          title="Close"
          style={{
            marginLeft: isActive ? '0' : 'auto',
            width: '24px', height: '24px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'transparent', cursor: 'pointer',
            borderRadius: '6px', color: 'var(--text-3)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--surface-2)'
            e.currentTarget.style.color = 'var(--danger)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-3)'
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* WebContentsView target */}
      <div ref={ref} style={{ flex: 1, background: '#fff' }} />
    </div>
  )
})

export default PlatformCard
```

- [ ] **Step 2: Commit**

```bash
git add src/components/social/PlatformCard.tsx
git commit -m "feat(social): PlatformCard with close button"
```

---

## Task 12: Build the FrameCanvas component

**Files:**
- Create: `src/components/social/FrameCanvas.tsx`

- [ ] **Step 1: Write the canvas that hosts 0/1/2/3 cards**

```tsx
// src/components/social/FrameCanvas.tsx
import { useEffect, useRef, useState, createRef } from 'react'
import { Sparkles } from 'lucide-react'
import PlatformCard, { HEADER_H } from './PlatformCard'
import { getApp } from '@/config/socialApps'
import { useSocialStore } from '@/store/useSocialStore'

const PHONE_W = 390
const PHONE_H = 844

export default function FrameCanvas() {
  const openFrames  = useSocialStore(s => s.openFrames)
  const activeFrame = useSocialStore(s => s.activeFrame)
  const setActive   = useSocialStore(s => s.setActive)
  const closeApp    = useSocialStore(s => s.closeApp)

  const navWidthRef    = useRef<number>(Number(localStorage.getItem('navWidth') || '172'))
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refs           = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map())

  const [frameSize, setFrameSize] = useState(() => calcSize(openFrames.length, navWidthRef.current))

  const api = window.electronAPI as any

  function calcFrameSize() {
    setFrameSize(calcSize(openFrames.length, navWidthRef.current))
  }

  // Ensure a ref exists for every open frame
  openFrames.forEach(id => {
    if (!refs.current.has(id)) refs.current.set(id, createRef<HTMLDivElement>())
  })

  // ── Mount / unmount / show / hide views when openFrames changes ──────────────
  useEffect(() => {
    // Show views for every open frame
    openFrames.forEach(id => {
      const app = getApp(id)
      if (!app) return
      api?.socialShow?.(id, `social-${id}`, app.url).catch(() => {})
    })

    // Sync bounds after layout
    syncBounds()

    // Destroy views that were removed from openFrames
    // (handled by explicit closeApp → we call socialDestroy in a separate effect below)

    // Window resize watchers
    const observer = new ResizeObserver(syncBoundsDebounced)
    refs.current.forEach(r => { if (r.current) observer.observe(r.current) })

    const onResize    = () => { calcFrameSize(); syncBoundsDebounced() }
    const onNavResize = (e: Event) => {
      navWidthRef.current = (e as CustomEvent).detail?.width ?? navWidthRef.current
      calcFrameSize(); syncBoundsDebounced()
    }

    window.addEventListener('resize',     onResize)
    window.addEventListener('nav-resize', onNavResize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize',     onResize)
      window.removeEventListener('nav-resize', onNavResize)
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current)
    }
  }, [openFrames])

  // Recompute size when count changes
  useEffect(() => { calcFrameSize(); syncBoundsDebounced() }, [openFrames.length])

  // Destroy views that are no longer open (detect removals)
  const prevOpenRef = useRef<string[]>([])
  useEffect(() => {
    const prev = prevOpenRef.current
    const removed = prev.filter(id => !openFrames.includes(id))
    removed.forEach(id => {
      api?.socialDestroy?.(id).catch(() => {})
      refs.current.delete(id)
    })
    prevOpenRef.current = openFrames
  }, [openFrames])

  // Hide all views on unmount (leaving Social Hub entirely)
  useEffect(() => {
    return () => { api?.socialHide?.().catch(() => {}) }
  }, [])

  function syncBoundsDebounced() {
    if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current)
    boundsTimerRef.current = setTimeout(syncBounds, 50)
  }

  function syncBounds() {
    if (!api?.socialSetBounds) return
    openFrames.forEach(id => {
      const r = refs.current.get(id)?.current
      if (!r) return
      const b = r.getBoundingClientRect()
      api.socialSetBounds(id, {
        x:      Math.round(b.left),
        y:      Math.round(b.top + HEADER_H),
        width:  Math.round(b.width),
        height: Math.round(b.height - HEADER_H),
      }).catch(() => {})
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (openFrames.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', gap: '12px',
      }}>
        <Sparkles size={32} strokeWidth={1.5} />
        <div style={{ fontSize: '13.5px' }}>Click an app icon on the right to open</div>
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: '24px', padding: '0 32px 20px', overflow: 'hidden',
    }}>
      {openFrames.map(id => {
        const app = getApp(id)
        if (!app) return null
        return (
          <PlatformCard
            key={id}
            ref={refs.current.get(id)!}
            app={app}
            width={frameSize.w}
            height={frameSize.h}
            isActive={activeFrame === id}
            onClick={() => setActive(id)}
            onClose={() => closeApp(id)}
          />
        )
      })}
    </div>
  )
}

function calcSize(count: number, navW: number) {
  if (count === 0) return { w: PHONE_W, h: PHONE_H }

  const COMPOSER_H = 82
  const V_PADDING  = 48
  const H_PADDING  = 80
  const GAP        = 24
  const DOCK_W     = 56

  const availH = window.innerHeight - COMPOSER_H - V_PADDING
  const availW = (window.innerWidth - navW - DOCK_W - H_PADDING - GAP * (count - 1)) / count

  const scaleW = availW / PHONE_W
  const scaleH = availH / PHONE_H
  const scale  = Math.min(1, scaleW, scaleH)

  return { w: Math.round(PHONE_W * scale), h: Math.round(PHONE_H * scale) }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/social/FrameCanvas.tsx
git commit -m "feat(social): FrameCanvas — 0/1/2/3 layout with bounds sync"
```

---

## Task 13: Update `injectSocialText` to accept selector

**Files:**
- Modify: `electron/socialHub.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

**Rationale:** With 12 apps the hardcoded `INJECT_SELECTORS` map must be replaced. Pass the selector from the renderer (which gets it from `SocialApp.injectSelector`).

- [ ] **Step 1: Update `injectSocialText` signature in `electron/socialHub.ts`**

Find and replace:
```typescript
const INJECT_SELECTORS: Record<string, string> = {
  'social-0': 'div[contenteditable="true"]',
  'social-1': 'div[contenteditable="true"][role="textbox"]',
  'social-2': 'div[data-testid="tweetTextarea_0"]',
}

export async function injectSocialText(id: string, text: string): Promise<void> {
  const view = socialCache.get(id)
  if (!view) return
  const selector = INJECT_SELECTORS[id]
  if (!selector) return

  await view.webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      return true;
    })()
  `)
}
```

With:
```typescript
export async function injectSocialText(id: string, text: string, selector: string): Promise<void> {
  const view = socialCache.get(id)
  if (!view || !selector) return

  await view.webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      return true;
    })()
  `)
}
```

- [ ] **Step 2: Update IPC in `electron/main.ts`**

Find:
```typescript
ipcMain.handle('social:inject', (_e, id: string, text: string) => injectSocialText(id, text))
```

Replace:
```typescript
ipcMain.handle('social:inject', (_e, id: string, text: string, selector: string) => injectSocialText(id, text, selector))
```

- [ ] **Step 3: Update preload binding in `electron/preload.ts`**

Find:
```typescript
  socialInjectText: (id: string, text: string) => ipcRenderer.invoke('social:inject', id, text),
```

Replace:
```typescript
  socialInjectText: (id: string, text: string, selector: string) => ipcRenderer.invoke('social:inject', id, text, selector),
```

- [ ] **Step 4: Commit**

```bash
git add electron/socialHub.ts electron/preload.ts electron/main.ts
git commit -m "refactor(social): pass injection selector from renderer"
```

---

## Task 14: Rewrite `SocialHub.tsx` to use the new components

**Files:**
- Modify: `src/pages/SocialHub.tsx` (full rewrite)

- [ ] **Step 1: Replace the file**

```tsx
// src/pages/SocialHub.tsx
import { useState, useEffect } from 'react'
import { ImagePlus, Send } from 'lucide-react'
import AppDock from '@/components/social/AppDock'
import FrameCanvas from '@/components/social/FrameCanvas'
import { useSocialStore } from '@/store/useSocialStore'
import { getApp } from '@/config/socialApps'

interface Props { isActive: boolean }

export default function SocialHub({ isActive }: Props) {
  const [composerText, setComposerText] = useState('')
  const activeFrame = useSocialStore(s => s.activeFrame)

  const api = window.electronAPI as any

  // Handle load-fail events (log for now; future: show inline retry overlay per frame)
  useEffect(() => {
    if (!api?.onSocialLoadFail) return
    const handler = (_e: unknown, payload: { id: string; description: string }) => {
      console.warn('[SocialHub] load fail', payload.id, payload.description)
    }
    api.onSocialLoadFail(handler)
    return () => { api.offSocialLoadFail?.(handler) }
  }, [])

  // Hide all views when page deactivates
  useEffect(() => {
    if (!isActive) api?.socialHide?.().catch(() => {})
  }, [isActive])

  async function handleSend() {
    if (!activeFrame || !composerText.trim() || !api?.socialInjectText) return
    const app = getApp(activeFrame)
    if (!app?.injectSelector) return
    await api.socialInjectText(activeFrame, composerText, app.injectSelector).catch(() => {})
    setComposerText('')
  }

  const activeApp  = activeFrame ? getApp(activeFrame) : null
  const canCompose = !!activeApp?.injectSelector
  const sendDisabled = !activeFrame || !canCompose || !composerText.trim()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: 'var(--bg)', overflow: 'hidden',
    }}>
      {/* Composer */}
      <div style={{ flexShrink: 0, padding: '14px 24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: '100%', maxWidth: '640px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '16px', padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}>
          {activeApp && (
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: activeApp.color,
            }} />
          )}
          <textarea
            placeholder={
              !activeApp        ? 'Open an app from the right, then compose...' :
              !canCompose       ? `${activeApp.name} does not support direct compose yet` :
                                  `Compose for ${activeApp.name}...`
            }
            value={composerText}
            onChange={e => setComposerText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: '13.5px', resize: 'none',
              fontFamily: 'inherit', lineHeight: '1.5',
            }}
          />
          <button
            style={{
              background: 'none', border: 'none', color: 'var(--text-3)',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              padding: '4px', borderRadius: '8px',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--surface-2)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.background = 'transparent' }}
          >
            <ImagePlus size={18} strokeWidth={1.6} />
          </button>
          <button
            onClick={handleSend}
            disabled={sendDisabled}
            title={
              !activeFrame ? 'Select an open app first' :
              !canCompose  ? 'Composer not supported for this app' :
                             'Send (Enter)'
            }
            style={{
              background: sendDisabled ? 'var(--surface-2)' : 'var(--accent)',
              border: 'none', color: sendDisabled ? 'var(--text-3)' : 'white',
              cursor: sendDisabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', borderRadius: '9px',
              transition: 'background 0.15s, transform 0.1s', flexShrink: 0,
            }}
            onMouseDown={e => { if (!sendDisabled) e.currentTarget.style.transform = 'scale(0.92)' }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Canvas + Dock */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <FrameCanvas />
        <AppDock />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove old references**

The `FRAMES` constant and old structure from the old SocialHub.tsx should be fully gone — it's been replaced by `SOCIAL_APPS` in `src/config/socialApps.ts`.

- [ ] **Step 3: Run full build and verify**

```bash
npm run build
```
Expected: No TypeScript errors.

```bash
npm run dev
```

In the app, navigate to Social Hub:
1. Initially: empty state "Click an app icon on the right to open"
2. Click Instagram icon: single large frame appears centered
3. Click Facebook icon: two frames side-by-side
4. Click Twitter icon: three frames (current-style layout)
5. Click LinkedIn icon: evicts Instagram (LRU), now 3 frames: Facebook, Twitter, LinkedIn
6. Double-click any active icon: closes that frame
7. Resize window: frames scale, content inside scales via zoom factor
8. Navigate away and back: openFrames persist from localStorage

- [ ] **Step 4: Commit**

```bash
git add src/pages/SocialHub.tsx
git commit -m "feat(social): rewrite SocialHub as dock + canvas composer"
```

---

## Task 15: Final verification checklist

- [ ] **Phase 1 checks:**
  - FB banner gone
  - `navigator.maxTouchPoints` returns 5 (check via DevTools if enabled)
  - No JavaScript errors in main/renderer processes

- [ ] **Phase 2 checks:**
  - No size flash on first Social Hub open
  - External links open in system browser, not inside frames
  - Closing an app (X or double-click dock) destroys the view (no lingering WebContentsView)

- [ ] **Phase 3 checks:**
  - Empty state displays when no apps open
  - 1 app = centered single frame
  - 2 apps = two side-by-side
  - 3 apps = three side-by-side
  - Clicking 4th icon: LRU evicts oldest open frame
  - Dock icon shows colored dot when open (not active)
  - Dock icon shows colored ring when active
  - Composer "Active" indicator matches activeFrame from store
  - `openFrames` + `activeFrame` persist across app restart (localStorage)
  - Zoom factor stays correct when resizing window
  - Composer injects text into active frame (Instagram/Facebook/Twitter selectors work; other apps show "does not support direct compose")

- [ ] **Regression checks:**
  - Other pages (Dashboard, AIBrowser, Accounts, etc.) still render normally
  - Navigation between Social Hub and other pages does not leave WebContentsViews floating on top
  - nav-resize still updates frame layout

---

## Notes for Executor

- **No automated tests in this codebase.** Use the verification steps above for manual validation.
- **Git repo not initialized.** Commit steps can be skipped if `git status` fails; all changes should still be implemented task-by-task with verification between each.
- **`contextIsolation: false` for social views** is intentional — this is required for the preload to mutate `navigator`. Social sites don't have access to `require()`/Node APIs because `nodeIntegration: false` remains.
- **Phases are sequential.** Do not start Phase 3 until Phase 1 and 2 are fully verified.
