# Social Hub — Design Spec
**Date:** 2026-04-23  
**Status:** Approved

---

## Overview

Fix the segmentation fault crash when switching to Social Hub, then implement the full premium phone-frame UI with a functional Global Composer that injects text into the active social frame.

---

## 1. Crash Fix (Root Cause)

`webContents.enableDeviceEmulation()` crashes Electron 41 when called on a `WebContentsView`'s webContents. This API is only officially supported on `BrowserWindow.webContents`. iOS User-Agent spoofing alone is sufficient to load mobile layouts on Instagram, Facebook, and Twitter.

**Fix:** Remove `enableDeviceEmulation()` call from `socialHub.ts`. All 7 lines of that block are deleted. Everything else in `showSocialView()` stays.

---

## 2. Backend — `electron/socialHub.ts`

### Changes
- Remove `enableDeviceEmulation` block entirely.
- Keep iOS UA: `Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ...`
- Keep `socialCache` Map for view reuse.
- Keep `showSocialView`, `hideAllSocialViews`, `setSocialBounds` — no structural changes.
- Add new export: `injectSocialText(id: string, text: string): Promise<void>`
  - Looks up view from `socialCache`.
  - Calls `view.webContents.executeJavaScript(...)` with a JS snippet that:
    1. Finds the compose element via selector
    2. Focuses it
    3. Uses `document.execCommand('insertText', false, text)` to insert text — this works for both `contenteditable` divs (Instagram, Facebook) and `textarea`-based inputs (Twitter). Do NOT use `.value =` on contenteditable divs; it won't trigger React state updates.
    4. If no element is found, the snippet returns `false` silently (user sees nothing happened — acceptable UX for MVP)
  - Known selectors per platform:
    - Instagram: `div[contenteditable="true"]`
    - Facebook: `div[contenteditable="true"][role="textbox"]`
    - Twitter/X: `div[data-testid="tweetTextarea_0"]`
  - Note: If the user hasn't opened a compose box on that platform, injection silently does nothing. Out of scope to add a warning for this.

### IPC Additions (`electron/main.ts`)
```
ipcMain.handle('social:inject', (_e, id: string, text: string) => injectSocialText(id, text))
```

### Preload Addition (`electron/preload.ts`)
```
socialInjectText: (id: string, text: string) => ipcRenderer.invoke('social:inject', id, text)
```

---

## 3. Frontend — `src/pages/SocialHub.tsx`

### Platforms (fixed)
```ts
const FRAMES = [
  { id: 'social-0', partition: 'social-hub-0', defaultUrl: 'https://www.instagram.com/', label: 'Instagram' },
  { id: 'social-1', partition: 'social-hub-1', defaultUrl: 'https://www.facebook.com/', label: 'Facebook' },
  { id: 'social-2', partition: 'social-hub-2', defaultUrl: 'https://twitter.com/',      label: 'Twitter'   },
]
```

### State
- `composerText: string` — composer textarea value
- `activeFrame: number | null` — index of currently active/focused frame (null = none)

### syncBounds — Debounce Fix
Wrap `syncBounds` in a 50ms debounce so rapid ResizeObserver + window resize events don't flood IPC.

```ts
let boundsTimer: ReturnType<typeof setTimeout> | null = null
function syncBoundsDebounced() {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(syncBounds, 50)
}
```

Use `syncBoundsDebounced` everywhere `syncBounds` was called from event listeners. Call `syncBounds` directly on `isActive` mount (immediate, one-time).

### Phone Frame Styling
Each frame wrapper:
- `width: 390px`, `height: 844px`, `borderRadius: 50px`
- `border: '10px solid #141415'`, `background: '#000'`
- Active: `boxShadow: '0 25px 80px rgba(0,0,0,0.35), 0 0 0 2px var(--accent), 0 0 0 6px var(--accent-muted)'`
- Inactive: `boxShadow: '0 20px 60px rgba(0,0,0,0.25)'`
- `cursor: 'pointer'` — click to set activeFrame
- Center frame (index 1): `transform: 'translateY(15px)'` — subtle depth

Platform label below each frame:
- `fontSize: 12px`, `color: 'var(--text-3)'`, `textAlign: 'center'`, `marginTop: 10px`

### Global Composer
- Stays at `position: absolute, top: 24px` floating above frames
- Glassmorphism: `background: rgba(30,30,30,0.45)`, `backdropFilter: blur(24px)`, `borderRadius: 24px`
- Send button: disabled + `opacity: 0.4` when `activeFrame === null`
- On Send click:
  1. Call `api.socialInjectText(FRAMES[activeFrame!].id, composerText)`
  2. Clear `composerText`

### Background
`var(--bg)` — follows app light theme.

---

## 4. Out of Scope
- Image upload functionality
- Actual cross-platform posting via social APIs
- TikTok platform (not in scope — Instagram, Facebook, Twitter only)
- Dark mode toggle for Social Hub section

---

## 5. Files Changed
| File | Change |
|------|--------|
| `electron/socialHub.ts` | Remove `enableDeviceEmulation`, add `injectSocialText` |
| `electron/main.ts` | Add `social:inject` IPC handler |
| `electron/preload.ts` | Add `socialInjectText` to contextBridge |
| `src/pages/SocialHub.tsx` | Debounce, active frame state, glow styling, composer Send logic, labels |
