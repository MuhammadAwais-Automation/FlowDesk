# Social Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the segmentation fault crash when switching to Social Hub, add debounced bounds sync, active frame tracking with glow styling, platform labels, and a functional Global Composer that injects text into the selected social frame.

**Architecture:** Remove the `enableDeviceEmulation` call (crash root cause) from `socialHub.ts`, add `injectSocialText` for IPC-driven text injection, then update `SocialHub.tsx` with debounce, active frame state, styling improvements, and a wired Send button.

**Tech Stack:** Electron 41, React 18, TypeScript, IPC (ipcMain/ipcRenderer), WebContentsView, `document.execCommand`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `electron/socialHub.ts` | Modify | Remove `enableDeviceEmulation` block; add `injectSocialText` export |
| `electron/main.ts` | Modify | Add `social:inject` IPC handler |
| `electron/preload.ts` | Modify | Add `socialInjectText` to contextBridge |
| `src/pages/SocialHub.tsx` | Modify | Debounce, `activeFrame` state, FRAMES labels, glow styling, Send logic |

---

## Task 1: Fix Crash — Remove `enableDeviceEmulation`

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Remove the `enableDeviceEmulation` block**

In `electron/socialHub.ts`, delete lines 30–37. The `showSocialView` function should go from this:

```typescript
export function showSocialView(id: string, partition: string, url: string) {
  if (!mainWindow) return

  let view = socialCache.get(id)
  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    
    // User Agent Spoofing
    view.webContents.setUserAgent(USER_AGENT_IOS)

    // Device Emulation (Touch, Mobile Screen)
    view.webContents.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: { width: 390, height: 844 },
      viewPosition: { x: 0, y: 0 },
      viewSize: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      scale: 1,
    })

    // Open external links safely
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      view!.webContents.loadURL(openUrl)
      return { action: 'deny' }
    })

    viewCacheAndLoad(view, id, url)
  }

  // Ensure it's attached
  try { mainWindow.contentView.addChildView(view) } catch {}
}
```

To this (enableDeviceEmulation block removed):

```typescript
export function showSocialView(id: string, partition: string, url: string) {
  if (!mainWindow) return

  let view = socialCache.get(id)
  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })

    view.webContents.setUserAgent(USER_AGENT_IOS)

    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      view!.webContents.loadURL(openUrl)
      return { action: 'deny' }
    })

    viewCacheAndLoad(view, id, url)
  }

  try { mainWindow.contentView.addChildView(view) } catch {}
}
```

- [ ] **Step 2: Verify the app no longer crashes on Social Hub switch**

Run `npm run dev`. Switch to Social Hub in the sidebar. The app should open without segfault. The 3 frames will appear as black bezels — that's expected (WebContentsViews attach later after bounds sync).

- [ ] **Step 3: Commit**

```bash
git add electron/socialHub.ts
git commit -m "fix: remove enableDeviceEmulation — crashes Electron 41 WebContentsView"
```

---

## Task 2: Add `injectSocialText` to `socialHub.ts`

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Add `injectSocialText` export at the bottom of `electron/socialHub.ts`**

Append after the existing `setSocialBounds` function:

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

- [ ] **Step 2: Commit**

```bash
git add electron/socialHub.ts
git commit -m "feat: add injectSocialText to socialHub"
```

---

## Task 3: Wire IPC — `social:inject`

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add import for `injectSocialText` in `electron/main.ts`**

Find the existing import line (line 49):
```typescript
import { setSocialMainWindow, showSocialView, hideAllSocialViews, setSocialBounds } from './socialHub'
```

Replace with:
```typescript
import { setSocialMainWindow, showSocialView, hideAllSocialViews, setSocialBounds, injectSocialText } from './socialHub'
```

- [ ] **Step 2: Add IPC handler in `electron/main.ts`**

Find the social IPC block (around line 437):
```typescript
ipcMain.handle('social:show', (_e, id: string, partition: string, url: string) => showSocialView(id, partition, url))
ipcMain.handle('social:hide', () => hideAllSocialViews())
ipcMain.handle('social:setBounds', (_e, id: string, bounds: {x: number, y: number, width: number, height: number}) => setSocialBounds(id, bounds.x, bounds.y, bounds.width, bounds.height))
```

Add one line after `social:setBounds`:
```typescript
ipcMain.handle('social:inject', (_e, id: string, text: string) => injectSocialText(id, text))
```

- [ ] **Step 3: Add `socialInjectText` to `electron/preload.ts`**

Find the Social Hub section in preload.ts:
```typescript
  // Social Hub
  socialShow: (id: string, partition: string, url: string) => ipcRenderer.invoke('social:show', id, partition, url),
  socialHide: () => ipcRenderer.invoke('social:hide'),
  socialSetBounds: (id: string, bounds: {x: number, y: number, width: number, height: number}) => ipcRenderer.invoke('social:setBounds', id, bounds),
```

Add one line after `socialSetBounds`:
```typescript
  socialInjectText: (id: string, text: string) => ipcRenderer.invoke('social:inject', id, text),
```

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: add social:inject IPC handler and preload binding"
```

---

## Task 4: Update `SocialHub.tsx` — Debounce + State + Styling + Composer

**Files:**
- Modify: `src/pages/SocialHub.tsx`

- [ ] **Step 1: Replace the entire `src/pages/SocialHub.tsx` with the updated version**

```tsx
import { useState, useEffect, useRef } from 'react'
import { ImagePlus, Send } from 'lucide-react'

interface Props { isActive: boolean }

const FRAMES = [
  { id: 'social-0', partition: 'social-hub-0', defaultUrl: 'https://www.instagram.com/', label: 'Instagram' },
  { id: 'social-1', partition: 'social-hub-1', defaultUrl: 'https://www.facebook.com/', label: 'Facebook' },
  { id: 'social-2', partition: 'social-hub-2', defaultUrl: 'https://twitter.com/',      label: 'Twitter'   },
]

export default function SocialHub({ isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const f0 = useRef<HTMLDivElement>(null)
  const f1 = useRef<HTMLDivElement>(null)
  const f2 = useRef<HTMLDivElement>(null)
  const frameRefs = [f0, f1, f2]
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [composerText, setComposerText] = useState('')
  const [activeFrame, setActiveFrame] = useState<number | null>(null)

  const api = window.electronAPI as any

  useEffect(() => {
    if (!isActive) {
      if (api?.socialHide) api.socialHide().catch(() => {})
      return
    }

    if (api?.socialShow) {
      FRAMES.forEach(f => {
        api.socialShow(f.id, f.partition, f.defaultUrl).catch(() => {})
      })
    }

    // Immediate sync on mount, then debounced for subsequent changes
    syncBounds()

    const observer = new ResizeObserver(syncBoundsDebounced)
    frameRefs.forEach(ref => { if (ref.current) observer.observe(ref.current) })

    window.addEventListener('resize', syncBoundsDebounced)
    window.addEventListener('nav-resize', syncBoundsDebounced)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBoundsDebounced)
      window.removeEventListener('nav-resize', syncBoundsDebounced)
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current)
    }
  }, [isActive])

  function syncBoundsDebounced() {
    if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current)
    boundsTimerRef.current = setTimeout(syncBounds, 50)
  }

  function syncBounds() {
    if (!isActive || !api?.socialSetBounds) return
    frameRefs.forEach((ref, i) => {
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        const border = 10
        api.socialSetBounds(FRAMES[i].id, {
          x: Math.round(r.left + border),
          y: Math.round(r.top + border),
          width: Math.round(r.width - border * 2),
          height: Math.round(r.height - border * 2),
        }).catch(() => {})
      }
    })
  }

  async function handleSend() {
    if (activeFrame === null || !composerText.trim() || !api?.socialInjectText) return
    await api.socialInjectText(FRAMES[activeFrame].id, composerText).catch(() => {})
    setComposerText('')
  }

  const sendDisabled = activeFrame === null || !composerText.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', position: 'relative' }}>

      {/* Global Composer */}
      <div style={{
        position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)',
        width: '600px', zIndex: 50,
        background: 'rgba(30, 30, 30, 0.45)', backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '24px', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '14px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
      }}>
        <textarea
          placeholder={activeFrame !== null ? `Compose for ${FRAMES[activeFrame].label}...` : 'Select a frame, then compose...'}
          value={composerText}
          onChange={e => setComposerText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          rows={1}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'white', fontSize: '14.5px', resize: 'none', fontFamily: 'inherit',
          }}
        />
        <button
          style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.2s', padding: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'white'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
        >
          <ImagePlus size={22} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleSend}
          disabled={sendDisabled}
          title={activeFrame === null ? 'Select a frame first' : 'Send (Enter)'}
          style={{
            background: 'var(--accent)', border: 'none', color: 'white', cursor: sendDisabled ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', borderRadius: '12px',
            boxShadow: sendDisabled ? 'none' : '0 6px 20px var(--accent-muted)',
            opacity: sendDisabled ? 0.4 : 1,
            transition: 'opacity 0.2s, transform 0.1s',
          }}
          onMouseDown={e => { if (!sendDisabled) e.currentTarget.style.transform = 'scale(0.95)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Phone Grid */}
      <div
        ref={containerRef}
        style={{
          flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px',
          padding: '120px 40px 40px', overflowY: 'auto', overflowX: 'auto',
          backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(79,110,247,0.04) 0%, transparent 60%)',
        }}
      >
        {frameRefs.map((ref, idx) => {
          const isFrameActive = activeFrame === idx
          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div
                ref={ref}
                onClick={() => setActiveFrame(idx)}
                style={{
                  position: 'relative',
                  width: '390px', height: '844px', flexShrink: 0,
                  borderRadius: '50px',
                  border: `10px solid ${isFrameActive ? 'var(--accent)' : '#141415'}`,
                  background: '#000',
                  boxShadow: isFrameActive
                    ? '0 25px 80px rgba(0,0,0,0.35), 0 0 0 4px var(--accent-muted)'
                    : '0 20px 60px rgba(0,0,0,0.25)',
                  transform: `translateY(${idx === 1 ? '15px' : '0px'})`,
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
              >
                {/* Dynamic Island */}
                <div style={{
                  position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
                  width: '125px', height: '36px', borderRadius: '18px', background: '#000',
                  zIndex: 10, pointerEvents: 'none',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0 12px',
                }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#111', boxShadow: 'inset 0 -1px 2px rgba(255,255,255,0.2)' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(135deg, #0a0a0a, #2a2a2a)' }} />
                </div>
              </div>

              {/* Platform label */}
              <span style={{
                fontSize: '12px', color: 'var(--text-3)', textAlign: 'center',
                transform: `translateY(${idx === 1 ? '15px' : '0px'})`,
                transition: 'color 0.2s',
                ...(isFrameActive ? { color: 'var(--accent)' } : {}),
              }}>
                {FRAMES[idx].label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run the app and verify**

```
npm run dev
```

Check:
1. Switching to Social Hub no longer crashes
2. Three phone frames appear with Dynamic Islands
3. Clicking a frame highlights its border in accent color and changes label color
4. Platform labels (Instagram, Facebook, Twitter) appear below each frame
5. Composer placeholder changes to show active platform name
6. Send button is disabled (opacity 0.4) until a frame is selected and text is typed
7. Typing text and pressing Enter (or clicking Send) calls inject — if the social site has a compose box open, text appears in it

- [ ] **Step 3: Commit**

```bash
git add src/pages/SocialHub.tsx
git commit -m "feat: social hub — active frame tracking, glow styling, labels, composer inject"
```

---

## Final Verification Checklist

- [ ] `npm run dev` starts without segfault
- [ ] Switching to Social Hub loads 3 frames without crashing
- [ ] Frames are visible inside bezels (black area fills with site content after short load)
- [ ] Clicking a frame: accent border glow appears, label turns accent color
- [ ] Composer placeholder shows active platform name
- [ ] Send disabled when no frame selected or text empty
- [ ] Send (Enter key or button) injects text into active social site's compose area (must open compose on that site first)
- [ ] Switching away from Social Hub hides views cleanly
- [ ] Window resize / nav resize does not cause IPC flood (debounced)
