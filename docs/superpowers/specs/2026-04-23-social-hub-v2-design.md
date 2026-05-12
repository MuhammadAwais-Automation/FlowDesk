# Social Hub v2 — Design Spec
**Date:** 2026-04-23
**Status:** Approved (Approach B selected)

---

## Overview

Transform Social Hub from 3-fixed-frame layout into a multi-app dock system with 12 configurable social apps, native-like mobile emulation, and bug fixes. Max 3 frames visible side-by-side; right sidebar dock controls which are open.

---

## 1. Architecture

### High-level
- Right-side **Dock**: 12 app icons, click to toggle open/close
- **Canvas**: max 3 frames visible simultaneously (1/2/3 layout)
- **State**: `openFrames: string[]` — LRU queue (length ≤ 3)
- **Preload**: injected script spoofs navigator/screen for native mobile feel
- **CSS overrides**: platform-specific hide rules for install banners

### New file structure
```
electron/
  socialHub.ts          # existing, refactored
  socialPreload.ts      # NEW — preload injected into social views
src/
  config/
    socialApps.ts       # NEW — 12 app definitions
  pages/
    SocialHub.tsx       # refactored — dock + canvas
  components/
    social/
      AppDock.tsx       # NEW — right sidebar icons
      FrameCanvas.tsx   # NEW — dynamic 1/2/3 frame layout
      PlatformCard.tsx  # NEW — single app frame card
  store/
    useSocialStore.ts   # NEW — openFrames + activeFrame
```

---

## 2. Phase 1 — Mobile Emulation (Preload Script)

### New file: `electron/socialPreload.ts`

Runs BEFORE page load. Overrides:

```typescript
// navigator.maxTouchPoints
Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })

// navigator.platform
Object.defineProperty(navigator, 'platform', { value: 'iPhone', configurable: true })

// window.ontouchstart
Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true })

// matchMedia patches
const origMatchMedia = window.matchMedia.bind(window)
window.matchMedia = (q: string) => {
  if (q.includes('hover: none') || q.includes('pointer: coarse')) {
    return { matches: true, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false} } as MediaQueryList
  }
  if (q.includes('hover: hover') || q.includes('pointer: fine')) {
    return { matches: false, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false} } as MediaQueryList
  }
  return origMatchMedia(q)
}

// DOMContentLoaded — CSS injection
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = `
    /* Facebook "Get iOS app" banner */
    [data-testid*="app_install"],
    a[href*="apps.facebook.com"],
    div[role="banner"]:has(a[href*="apps.facebook.com"]) { display: none !important; }

    /* Instagram "install app" popup & app-promo banners */
    div[role="dialog"]:has([aria-label*="app"i]),
    div[class*="AppInstallBanner"] { display: none !important; }
  `
  document.head.appendChild(style)
})
```

### Integration in `socialHub.ts`

```typescript
view = new WebContentsView({
  webPreferences: {
    session: session.fromPartition(`persist:${partition}`),
    preload: join(__dirname, '../preload/socialPreload.js'),  // NEW
    nodeIntegration: false,
    contextIsolation: true,
    // Ensure preload can override DOM before scripts run
  }
})
```

### Vite config update
`electron.vite.config.ts`: add `socialPreload.ts` to preload entries.

---

## 3. Phase 2 — Bug Fixes

### 3.1 Race condition fix (`SocialHub.tsx`)
**Problem:** `syncBounds()` runs BEFORE `calcFrameSize` setState flushes → first bounds call uses initial 390×844 size.

**Fix:** Use `useLayoutEffect` + synchronous initial size in useState initializer:
```typescript
const [frameSize, setFrameSize] = useState(() => calcInitialSize())
```

### 3.2 `did-fail-load` handler (`socialHub.ts`)
Emit event to renderer via IPC; renderer shows retry overlay on that frame.

### 3.3 `viewWidths` Map cleanup
Add `destroySocialView(id)` export; on view destroy, `viewWidths.delete(id)` and `socialCache.delete(id)`.

### 3.4 External links in system browser
```typescript
view.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url)
  return { action: 'deny' }
})
```

### 3.5 activeFrame persistence
Moved to Phase 3 — will be part of `useSocialStore` creation (§ 4.2).

---

## 4. Phase 3 — Dock + Canvas UI

### 4.1 App config — `src/config/socialApps.ts`

```typescript
export interface SocialApp {
  id: string
  name: string
  url: string
  color: string
  icon: string  // lucide icon name or custom SVG path
  injectSelector?: string  // for Global Composer text injection
}

export const SOCIAL_APPS: SocialApp[] = [
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/',       color: '#E1306C', icon: 'Instagram', injectSelector: 'div[contenteditable="true"]' },
  { id: 'facebook',  name: 'Facebook',  url: 'https://www.facebook.com/',        color: '#1877F2', icon: 'Facebook',  injectSelector: 'div[contenteditable="true"][role="textbox"]' },
  { id: 'twitter',   name: 'Twitter',   url: 'https://twitter.com/',             color: '#000000', icon: 'Twitter',   injectSelector: 'div[data-testid="tweetTextarea_0"]' },
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
```

### 4.2 Zustand store — `src/store/useSocialStore.ts`

```typescript
interface SocialState {
  openFrames:  string[]        // app ids in LRU order, max 3
  activeFrame: string | null   // currently selected for composer injection
  openApp:    (id: string) => void   // add to openFrames; if full, evict oldest
  closeApp:   (id: string) => void
  toggleApp:  (id: string) => void   // open if closed, close if open
  setActive:  (id: string | null) => void
}
```

Persistence: save `openFrames` + `activeFrame` to localStorage on change.

### 4.3 Layout rules (`FrameCanvas.tsx`)

```
openFrames.length === 0  → empty state "Click an app icon to open"
openFrames.length === 1  → single frame centered, max-w 420px
openFrames.length === 2  → 2 frames side-by-side, centered
openFrames.length === 3  → 3 frames side-by-side (current layout)
```

Each frame auto-sizes via updated `calcFrameSize`:
- `availW` divided by `openFrames.length` (not fixed 3)
- Cap per-frame width at `PHONE_W = 390` so single frame doesn't stretch absurdly wide
- Height scale calculated the same as current implementation

### 4.4 Dock — `AppDock.tsx`

Right sidebar, fixed width 56px:
- 12 icon buttons (Lucide), 40×40px each, 8px gap
- Active (open) state: accent ring + small colored dot
- Hover: tooltip with app name
- Click: `toggleApp(id)`

### 4.5 Platform card — `PlatformCard.tsx`

Same as current card design (flat, 14px radius, header bar). Added:
- Close (X) button in header — calls `closeApp(id)`
- Header shows "Active" badge when `activeFrame === id`

---

## 5. Out of Scope
- Drag-to-reorder dock icons
- Custom app URLs (user adding their own apps)
- Push notifications
- Camera features
- Instagram Story upload (rotation lock likely remains despite spoofing)
- Fullscreen mode for a single frame

---

## 6. Files Changed

**New:**
- `electron/socialPreload.ts`
- `src/config/socialApps.ts`
- `src/store/useSocialStore.ts`
- `src/components/social/AppDock.tsx`
- `src/components/social/FrameCanvas.tsx`
- `src/components/social/PlatformCard.tsx`

**Modified:**
- `electron/socialHub.ts` — preload path, destroySocialView, did-fail-load, shell.openExternal
- `electron/preload.ts` — add `socialDestroyView`, `onSocialLoadFail` listener
- `electron/main.ts` — `social:destroy` IPC handler, emit `social:load-fail` events
- `electron.vite.config.ts` — add preload entry
- `src/pages/SocialHub.tsx` — simplified wrapper around AppDock + FrameCanvas + Composer

---

## 7. Execution Order

Phase 1 → Phase 2 → Phase 3 (sequential, each independently shippable).

Phase 1 alone already improves current 3-frame UI (hides banners, better mobile emulation).
Phase 2 hardens existing code.
Phase 3 delivers the multi-app dock architecture.
