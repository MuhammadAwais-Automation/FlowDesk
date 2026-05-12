# AI Browser Redesign + Social Hub & Claude Login Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three connected fixes to FlowDesk: (1) Social Hub right-dock visibility bug, (2) Claude login OAuth popup routing, (3) AI Browser UX redesign — replace top tab bar with a right-side `ToolDock` (grouped tools + accounts).

**Architecture:**
- Social Hub: bounds calculation in `electron/socialHub.ts` subtracts the 56px right dock width.
- Claude login: `electron/sessions.ts` `setWindowOpenHandler` routes OAuth popups into a same-session child `BrowserWindow` instead of `shell.openExternal`.
- AI Browser: a new `ToolDock` component renders in the right side panel; tabs are still tracked in `AIBrowser.tsx` state, but rendered grouped by tool. Top tab strip removed; replaced by a 44px header bar showing the active tool + nav buttons.

**Tech Stack:** Electron 41 (main: TypeScript, renderer: React 18 + TypeScript + Tailwind + Vite). State: local React state + Zustand stores + `electron-store`. Tests: Vitest (existing setup for `src/lib/variables.test.ts` only).

**Project Notes:**
- The repo is **not** a git repository (per environment), so commit steps are written but optional — engineer may run them manually if a repo exists, otherwise skip.
- Verification is primarily through running the dev server (`npm run dev`) and exercising the UI. Unit tests are added only for the Electron-side URL helper functions where vitest is straightforward.

---

## File Structure

**Files Created:**
- `electron/oauthRouting.ts` — pure URL classification helpers (`isMailHost`, `isOAuthPopup`)
- `electron/oauthRouting.test.ts` — vitest tests for those helpers
- `src/components/browser/ToolDock.tsx` — right-side sidebar (grouped tools + accounts + footer)
- `src/components/browser/AccountContextMenu.tsx` — right-click menu for account rows
- `src/hooks/useDockExpanded.ts` — small persisted-state hook for collapse/expand

**Files Modified:**
- `electron/socialHub.ts` — bounds fix (subtract right dock width)
- `electron/sessions.ts` — popup handler refactored to use `oauthRouting` helpers
- `src/pages/AIBrowser.tsx` — remove top tab strip; mount `ToolDock`; rework header to 44px tool indicator row
- `src/components/browser/PromptBar.tsx` — remove inline back/forward/reload buttons (moved to header row of `AIBrowser.tsx`)
- `vitest.config.ts` (or equivalent) — only if vitest is not already configured to pick up `electron/**.test.ts` (verify in Task 2)

**Files Unchanged but Referenced:**
- `electron/preload.ts` — no API changes needed
- `src/types/browser.ts` — types stay the same
- `src/types/electron.d.ts` — no changes
- `src/pages/SocialHub.tsx` — no changes (bug is purely main-process bounds)

---

## Task 1: Social Hub Right-Dock Bounds Fix

**Files:**
- Modify: `electron/socialHub.ts`

- [ ] **Step 1: Read current file**

Run: open `electron/socialHub.ts` and verify the constants at top:
```typescript
const SOCIAL_NAV_H = 44
```

- [ ] **Step 2: Add `SOCIAL_DOCK_W` constant and update `updateBounds`**

Replace the constants and `updateBounds` function:

```typescript
const SOCIAL_NAV_H  = 44
const SOCIAL_DOCK_W = 56  // right AppDock width — keep in sync with src/components/social/AppDock.tsx
```

Then update `updateBounds`:

```typescript
function updateBounds(view: WebContentsView) {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()
  view.setBounds({
    x:      navWidth,
    y:      SOCIAL_NAV_H,
    width:  Math.max(bounds.width  - navWidth - SOCIAL_DOCK_W, 100),
    height: Math.max(bounds.height - SOCIAL_NAV_H, 100),
  })
}
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev`

Expected: Open Social Hub. Click any platform icon (e.g. Instagram). Confirm:
- The platform's web view does NOT cover the right `AppDock` (56px column with platform icons).
- All platform icons in the right dock remain clickable.
- Switching platforms preserves the dock visibility.
- Resizing the window keeps both the platform view and the dock correctly sized.

- [ ] **Step 4: Commit (only if a git repo exists)**

```bash
git add electron/socialHub.ts
git commit -m "fix(social-hub): subtract right AppDock width from WebContentsView bounds"
```

If not a git repo, skip.

---

## Task 2: Extract OAuth Routing Helpers (TDD)

**Files:**
- Create: `electron/oauthRouting.ts`
- Create: `electron/oauthRouting.test.ts`

- [ ] **Step 1: Verify vitest can run files in `electron/`**

Check `vitest.config.ts` (or `vite.config.ts`) for include patterns. If vitest only picks up `src/**`, adjust:

If a config file exists at the project root for vitest, ensure `electron/**/*.test.ts` is included. If no separate vitest config exists, create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
})
```

Run: `npx vitest run --reporter=verbose`
Expected: existing `src/lib/variables.test.ts` tests still pass; no new tests yet.

- [ ] **Step 2: Write failing tests**

Create `electron/oauthRouting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isMailHost, isOAuthPopup } from './oauthRouting'

describe('isMailHost', () => {
  it('returns true for mail.google.com', () => {
    expect(isMailHost('https://mail.google.com/mail/u/0/#inbox')).toBe(true)
  })

  it('returns true for subdomain of mail.google.com', () => {
    expect(isMailHost('https://x.mail.google.com/')).toBe(true)
  })

  it('returns false for accounts.google.com', () => {
    expect(isMailHost('https://accounts.google.com/signin')).toBe(false)
  })

  it('returns false for non-Google host', () => {
    expect(isMailHost('https://claude.ai/login')).toBe(false)
  })

  it('returns false for malformed URL', () => {
    expect(isMailHost('not a url')).toBe(false)
  })
})

describe('isOAuthPopup', () => {
  it('returns true for accounts.google.com root', () => {
    expect(isOAuthPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc')).toBe(true)
  })

  it('returns true for accounts.google.com signin', () => {
    expect(isOAuthPopup('https://accounts.google.com/signin/oauth')).toBe(true)
  })

  it('returns true for github oauth login', () => {
    expect(isOAuthPopup('https://github.com/login/oauth/authorize?client_id=abc')).toBe(true)
  })

  it('returns false for chatgpt.com root', () => {
    expect(isOAuthPopup('https://chatgpt.com/')).toBe(false)
  })

  it('returns false for claude.ai/chat/123', () => {
    expect(isOAuthPopup('https://claude.ai/chat/123')).toBe(false)
  })

  it('returns false for github.com root', () => {
    expect(isOAuthPopup('https://github.com/')).toBe(false)
  })

  it('returns false for malformed URL', () => {
    expect(isOAuthPopup('not a url')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `npx vitest run electron/oauthRouting.test.ts`
Expected: FAIL with "Cannot find module './oauthRouting'"

- [ ] **Step 4: Implement helpers**

Create `electron/oauthRouting.ts`:

```typescript
/**
 * URL classification helpers for Electron's setWindowOpenHandler.
 *
 * Pure functions. No Electron / Node-specific imports — testable in vitest.
 */

/** True if the URL belongs to Google Mail (or a subdomain thereof). */
export function isMailHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'mail.google.com' || host.endsWith('.mail.google.com')
  } catch {
    return false
  }
}

/**
 * True if the URL looks like an OAuth popup that needs to share the parent
 * session. Any window.open() to these endpoints should land in a child
 * BrowserWindow with the same partition so cookies / tokens persist.
 */
export function isOAuthPopup(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()

    // Google OAuth (consent screen, signin, OAuth flow)
    if (host === 'accounts.google.com') return true

    // GitHub OAuth (used by Anthropic / Claude in some flows)
    if (host === 'github.com' && u.pathname.startsWith('/login/oauth')) return true

    return false
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Run tests, confirm they pass**

Run: `npx vitest run electron/oauthRouting.test.ts`
Expected: All 12 tests PASS.

- [ ] **Step 6: Commit (optional)**

```bash
git add electron/oauthRouting.ts electron/oauthRouting.test.ts vitest.config.ts
git commit -m "feat(electron): add OAuth routing URL helpers + tests"
```

---

## Task 3: Wire OAuth Helpers Into `sessions.ts` (Claude Login Fix)

**Files:**
- Modify: `electron/sessions.ts`

- [ ] **Step 1: Read current `setWindowOpenHandler` block in `sessions.ts`**

Locate the block inside `showView`:

```typescript
const isGmail = partition.startsWith('gmail-')

view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
  if (isGmail) {
    shell.openExternal(openUrl)
  } else {
    view!.webContents.loadURL(openUrl)
  }
  return { action: 'deny' }
})
```

- [ ] **Step 2: Add import**

At the top of `electron/sessions.ts` (alongside the other imports):

```typescript
import { isMailHost, isOAuthPopup } from './oauthRouting'
```

- [ ] **Step 3: Replace handler logic**

Replace the entire `setWindowOpenHandler` block (and remove the `isGmail` constant — no longer needed) with:

```typescript
view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
  const tabUrl = view!.webContents.getURL()

  // Gmail tab: external links → system browser (existing behaviour)
  if (isMailHost(tabUrl)) {
    shell.openExternal(openUrl)
    return { action: 'deny' }
  }

  // AI tool tab: OAuth popups → same-session child window
  if (isOAuthPopup(openUrl)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 500,
        height: 660,
        webPreferences: {
          session: view!.webContents.session,
          nodeIntegration: false,
          contextIsolation: true,
        },
      },
    }
  }

  // Other links: load in same view (existing behaviour)
  view!.webContents.loadURL(openUrl)
  return { action: 'deny' }
})
```

Also delete the now-unused `partition` parameter check — `partition` is still passed in but `isGmail` is gone. Keep `partition` parameter for `session.fromPartition`.

- [ ] **Step 4: Add `clearPartitionStorage` IPC**

In `electron/main.ts`, add a new IPC handler near the other session-related handlers:

```typescript
// IPC: clear cookies/storage for a specific partition (used by AccountContextMenu "Clear Session")
ipcMain.handle('session:clearPartition', async (_e, partition: string) => {
  try {
    await session.fromPartition(`persist:${partition}`).clearStorageData()
    return true
  } catch {
    return false
  }
})
```

In `electron/preload.ts`, expose it inside the `electronAPI` object (place near the other view methods):

```typescript
clearPartitionStorage: (partition: string) =>
  ipcRenderer.invoke('session:clearPartition', partition),
```

Ensure `src/types/electron.d.ts` (if it explicitly declares the API surface) also has the new method. If `electronAPI` is typed `any` or via inference, no change needed there.

- [ ] **Step 5: Build to verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Manually verify Claude login**

Run: `npm run dev`

Expected manual flow:
1. Open AI Browser. If Claude is not in the tools library, add it: URL `https://claude.ai`.
2. Open a session: tool = Claude, gmail = any account.
3. On Claude's login page click "Continue with Google".
4. A small popup window (~500×660) opens **inside Electron** showing Google sign-in.
5. Complete sign-in. The popup closes (or you close it). Main Claude view is now logged in.
6. Verify Gmail tab still opens external links externally: open a Gmail session, click any external link in an email — should open in system browser, not in-app.

- [ ] **Step 7: Commit (optional)**

```bash
git add electron/sessions.ts electron/main.ts electron/preload.ts
git commit -m "fix(sessions): route OAuth popups to same-session child window + clearPartition IPC"
```

---

## Task 4: Build `ToolDock` Component

**Files:**
- Create: `src/components/browser/ToolDock.tsx`
- Create: `src/hooks/useDockExpanded.ts`

- [ ] **Step 1: Create the persisted-state hook**

Create `src/hooks/useDockExpanded.ts`:

```typescript
import { useState, useEffect } from 'react'

const LS_KEY = 'flowdesk:ai-browser-dock-expanded'

type ExpandedMap = Record<string, boolean>

function load(): ExpandedMap {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as ExpandedMap
  } catch {}
  return {}
}

function save(map: ExpandedMap) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch {}
}

/** Persisted "which tool sections are expanded" state. */
export function useDockExpanded() {
  const [expanded, setExpanded] = useState<ExpandedMap>(() => load())

  useEffect(() => { save(expanded) }, [expanded])

  function toggle(toolId: string) {
    setExpanded(m => ({ ...m, [toolId]: !m[toolId] }))
  }

  function isExpanded(toolId: string, defaultIfUnset: boolean): boolean {
    return expanded[toolId] ?? defaultIfUnset
  }

  return { isExpanded, toggle }
}
```

- [ ] **Step 2: Create the `ToolDock` component**

Create `src/components/browser/ToolDock.tsx`:

```typescript
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings, X } from 'lucide-react'
import { getFaviconUrl } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import { useDockExpanded } from '@/hooks/useDockExpanded'

interface Props {
  tabs:          BrowserTab[]
  activeId:      string | null
  customTools:   CustomTool[]
  onSelectTab:   (tabId: string) => void
  onCloseTab:    (tabId: string) => void
  onAddSession:  (toolId?: string) => void  // optional pre-selected tool
  onManageTools: () => void
  onContextMenu?: (e: React.MouseEvent, tab: BrowserTab) => void
}

export default function ToolDock({
  tabs, activeId, customTools,
  onSelectTab, onCloseTab, onAddSession, onManageTools, onContextMenu,
}: Props) {
  const { isExpanded, toggle } = useDockExpanded()
  const [hoverTabId, setHoverTabId] = useState<string | null>(null)

  // Group tabs by tool id
  const tabsByTool = useMemo(() => {
    const m = new Map<string, BrowserTab[]>()
    for (const t of tabs) {
      const list = m.get(t.tool.id) ?? []
      list.push(t)
      m.set(t.tool.id, list)
    }
    return m
  }, [tabs])

  return (
    <div style={{
      width: '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {customTools.length === 0 && (
          <div style={{
            padding: '20px 12px', textAlign: 'center',
            color: 'var(--text-3)', fontSize: '11px',
          }}>
            No tools yet — click <strong>+ New Tool</strong> below.
          </div>
        )}

        {customTools.map(tool => {
          const toolTabs = tabsByTool.get(tool.id) ?? []
          const expanded = isExpanded(tool.id, toolTabs.length > 0)
          const Chevron = expanded ? ChevronDown : ChevronRight

          return (
            <div key={tool.id} style={{ marginBottom: '4px' }}>
              {/* Tool header row */}
              <button
                onClick={() => toggle(tool.id)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: '7px',
                  padding: '7px 8px', borderRadius: '8px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-2)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <Chevron size={11} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
                <img
                  src={getFaviconUrl(tool.url)}
                  alt=""
                  style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, objectFit: 'contain' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
                <span style={{
                  flex: 1, textAlign: 'left',
                  fontSize: '12px', fontWeight: 600,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tool.name}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 600,
                  background: 'var(--surface-3, var(--surface-2))',
                  color: 'var(--text-3)',
                  borderRadius: '8px',
                  padding: '1px 7px',
                  flexShrink: 0,
                }}>
                  {toolTabs.length}
                </span>
              </button>

              {/* Account rows (only when expanded) */}
              {expanded && (
                <div style={{ paddingLeft: '14px' }}>
                  {toolTabs.map(tab => {
                    const isActive = tab.id === activeId
                    const color    = tab.gmail.color ?? '#6B7280'
                    const isHover  = hoverTabId === tab.id

                    return (
                      <div
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        onContextMenu={e => onContextMenu?.(e, tab)}
                        onMouseEnter={() => setHoverTabId(tab.id)}
                        onMouseLeave={() => setHoverTabId(null)}
                        title={tab.gmail.email}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '7px',
                          padding: '5px 8px', borderRadius: '7px',
                          margin: '2px 0',
                          cursor: 'pointer',
                          background:
                            isActive ? `${color}1F` :
                            isHover  ? 'var(--surface-2)' : 'transparent',
                          border: `1px solid ${isActive ? color + '55' : 'transparent'}`,
                          transition: 'all 0.1s',
                        }}
                      >
                        <div style={{
                          width: '6px', height: '6px',
                          borderRadius: '50%',
                          background: color,
                          flexShrink: 0,
                          boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                        }} />
                        <span style={{
                          flex: 1,
                          fontSize: '11px',
                          color: isActive ? 'var(--text)' : 'var(--text-2)',
                          fontWeight: isActive ? 600 : 400,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {tab.gmail.email}
                        </span>
                        {/* Hover X close */}
                        <button
                          onClick={e => { e.stopPropagation(); onCloseTab(tab.id) }}
                          aria-label="Close session"
                          style={{
                            width: '18px', height: '18px',
                            borderRadius: '5px', flexShrink: 0,
                            display: isHover || isActive ? 'flex' : 'none',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-3)',
                            transition: 'all 0.1s',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--danger-muted)'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--danger)'
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                          }}
                        >
                          <X size={11} strokeWidth={2.5} />
                        </button>
                      </div>
                    )
                  })}

                  {/* Per-tool "+" add account */}
                  <button
                    onClick={() => onAddSession(tool.id)}
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '5px 8px', borderRadius: '7px',
                      margin: '2px 0',
                      background: 'transparent', border: '1px dashed var(--border)',
                      cursor: 'pointer',
                      color: 'var(--text-3)',
                      fontSize: '10.5px',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                    }}
                  >
                    <Plus size={10} strokeWidth={2.5} />
                    Add account
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        padding: '8px',
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        <button
          onClick={() => onAddSession()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '7px 10px', borderRadius: '8px', cursor: 'pointer',
            background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
            color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
            ;(e.currentTarget as HTMLElement).style.color = 'white'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
          }}
        >
          <Plus size={12} strokeWidth={2.5} />
          New Session
        </button>

        <button
          onClick={onManageTools}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-2)', fontSize: '11px', fontWeight: 500,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <Settings size={11} />
          Manage Tools
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit (optional)**

```bash
git add src/components/browser/ToolDock.tsx src/hooks/useDockExpanded.ts
git commit -m "feat(browser): add ToolDock component (right sidebar, grouped tools)"
```

---

## Task 5: Build `AccountContextMenu` Component

**Files:**
- Create: `src/components/browser/AccountContextMenu.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/browser/AccountContextMenu.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import { RotateCcw, Trash2, Eraser } from 'lucide-react'
import type { BrowserTab } from '@/types/browser'

interface Props {
  tab:    BrowserTab
  x:      number
  y:      number
  onClose: () => void
  onReload:       (tab: BrowserTab) => void
  onClearSession: (tab: BrowserTab) => void
  onRemove:       (tab: BrowserTab) => void
}

export default function AccountContextMenu({
  tab, x, y, onClose, onReload, onClearSession, onRemove,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to viewport
  const left = Math.min(x, window.innerWidth  - 200)
  const top  = Math.min(y, window.innerHeight - 140)

  const items = [
    { icon: RotateCcw, label: 'Reload',         onClick: () => { onReload(tab); onClose() }, danger: false },
    { icon: Eraser,    label: 'Clear Session',  onClick: () => { onClearSession(tab); onClose() }, danger: false },
    { icon: Trash2,    label: 'Remove Account', onClick: () => { onRemove(tab); onClose() }, danger: true },
  ]

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top:  `${top}px`,
        zIndex: 100,
        minWidth: '180px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
        padding: '4px',
        animation: 'fadeIn 0.1s ease',
      }}
    >
      <div style={{
        padding: '6px 10px 8px',
        fontSize: '10.5px',
        color: 'var(--text-3)',
        borderBottom: '1px solid var(--border)',
        marginBottom: '4px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {tab.tool.name} — {tab.gmail.email}
      </div>

      {items.map(({ icon: Icon, label, onClick, danger }) => (
        <button
          key={label}
          onClick={onClick}
          style={{
            display: 'flex', alignItems: 'center', gap: '9px',
            width: '100%', textAlign: 'left',
            padding: '7px 10px', borderRadius: '6px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: danger ? 'var(--danger)' : 'var(--text-2)',
            fontSize: '12px',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background =
              danger ? 'var(--danger-muted)' : 'var(--surface-2)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors (component not yet wired, but compiles fine).

- [ ] **Step 3: Commit (optional)**

```bash
git add src/components/browser/AccountContextMenu.tsx
git commit -m "feat(browser): add AccountContextMenu component"
```

---

## Task 6: Refactor `AIBrowser.tsx` — Replace Top Tab Bar with `ToolDock`

**Files:**
- Modify: `src/pages/AIBrowser.tsx`
- Modify: `src/components/browser/PromptBar.tsx`

This is the biggest task. The diff approach: rewrite the page bottom-up.

- [ ] **Step 1: Remove inline nav buttons from `PromptBar.tsx`**

Open `src/components/browser/PromptBar.tsx`. Inside the bar JSX (lines ~204–231 — the array of `[ChevronLeft, ChevronRight, RotateCcw]`), DELETE that entire `[].map(...)` block AND the `<div style={{ flex: 1 }} />` spacer immediately before it. Keep the `Inject Prompt` button. Also remove the now-unused imports.

The new PromptBar inner JSX (between the outer `<div>` for `BAR_H`) becomes:

```typescript
<div
  style={{
    height: `${BAR_H}px`,
    display: 'flex', alignItems: 'center',
    gap: '6px', padding: '0 10px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  }}
>
  {/* Inject button */}
  <button
    onClick={openOverlay}
    style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      padding: '5px 11px', borderRadius: '7px', cursor: 'pointer',
      background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
      color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600,
      transition: 'all 0.12s', flexShrink: 0,
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
      ;(e.currentTarget as HTMLElement).style.color = 'white'
      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
      ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
    }}
  >
    <Zap size={11} fill="currentColor" />
    Inject Prompt
  </button>
</div>
```

Update the import line at the top to drop unused icons:

```typescript
import { useState, useEffect, useRef } from 'react'
import { Zap, X, Search, ArrowLeft, Send } from 'lucide-react'
import type { BrowserTab } from '@/types/browser'
import { getInjectTool } from '@/types/browser'
import type { Prompt, PromptCategory } from '@/types/electron'
```

(Keep everything else in PromptBar.tsx unchanged — overlay logic, etc.)

- [ ] **Step 2: TypeScript check after PromptBar edit**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Rewrite `AIBrowser.tsx`**

Replace the entire contents of `src/pages/AIBrowser.tsx` with:

```typescript
import { useState, useEffect } from 'react'
import { Plus, X, ChevronLeft, ChevronRight, RotateCcw, Settings, Trash2 } from 'lucide-react'
import { getFaviconUrl, getInjectTool } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import type { GmailSession } from '@/types/electron'
import PromptBar from '@/components/browser/PromptBar'
import ToolDock from '@/components/browser/ToolDock'
import AccountContextMenu from '@/components/browser/AccountContextMenu'
import { applyAccentForTool, resetAccent } from '@/lib/accentTheme'

interface AIBrowserProps {
  isActive: boolean
}

interface ContextMenuState {
  tab: BrowserTab
  x:   number
  y:   number
}

export default function AIBrowser({ isActive }: AIBrowserProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [customTools, setCustomTools] = useState<CustomTool[]>([])
  const [gmailSessions, setGmailSessions] = useState<GmailSession[]>([])

  // Modals
  const [showAddSession, setShowAddSession] = useState(false)
  const [selectedToolId, setSelectedToolId] = useState<string>('')
  const [selectedGmailEmail, setSelectedGmailEmail] = useState<string>('')

  const [showManageTools, setShowManageTools] = useState(false)
  const [addToolName, setAddToolName] = useState('')
  const [addToolUrl, setAddToolUrl] = useState('')
  const [addToolError, setAddToolError] = useState('')

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  const activeTab = tabs.find(t => t.id === activeId) ?? null

  useEffect(() => {
    loadTools()
    loadSessions()
  }, [])

  async function loadTools() {
    const tools = await window.electronAPI.toolsList()
    setCustomTools(tools)
  }

  async function loadSessions() {
    const sessions = await window.electronAPI.gmailList()
    setGmailSessions(sessions)
  }

  // Hide native view if any overlay is open
  const anyOverlayOpen = showAddSession || showManageTools

  useEffect(() => {
    if (!isActive || !activeTab || anyOverlayOpen) {
      window.electronAPI.hideView()
      return
    }
    window.electronAPI.switchView(activeTab.id, activeTab.gmail.partition, activeTab.tool.url)
  }, [activeId, isActive, anyOverlayOpen])

  // Dynamic accent
  useEffect(() => {
    if (!isActive || !activeTab) {
      resetAccent()
      return
    }
    const tool = getInjectTool(activeTab.tool.url)
    applyAccentForTool(tool)
  }, [activeTab?.tool.url, isActive])

  // ── Add session modal ──────────────────────────────────────────

  async function openAddSession(prefillToolId?: string) {
    const [tools, sessions] = await Promise.all([
      window.electronAPI.toolsList(),
      window.electronAPI.gmailList(),
    ])
    setCustomTools(tools)
    setGmailSessions(sessions)
    setSelectedToolId(prefillToolId ?? tools[0]?.id ?? '')
    setSelectedGmailEmail(sessions[0]?.email ?? '')
    setShowAddSession(true)
  }

  function closeAddSession() {
    setShowAddSession(false)
  }

  function handleAddSession() {
    const tool  = customTools.find(t => t.id === selectedToolId)
    const gmail = gmailSessions.find(s => s.email === selectedGmailEmail)
    if (!tool || !gmail) return

    const existing = tabs.find(t => t.tool.id === tool.id && t.gmail.email === gmail.email)
    if (existing) { setActiveId(existing.id); closeAddSession(); return }

    const tab: BrowserTab = {
      id:    `${tool.id}-${gmail.email}-${Date.now()}`,
      tool,
      gmail,
    }
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
    closeAddSession()
  }

  // ── Tab actions ───────────────────────────────────────────────

  function handleCloseTab(tabId: string) {
    window.electronAPI.closeView(tabId)
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      if (activeId === tabId) {
        const newActive = next[next.length - 1]?.id ?? null
        setActiveId(newActive)
        if (!newActive) window.electronAPI.hideView()
      }
      return next
    })
  }

  function handleSelectTab(tabId: string) {
    setActiveId(tabId)
  }

  function handleContextMenu(e: React.MouseEvent, tab: BrowserTab) {
    e.preventDefault()
    setCtxMenu({ tab, x: e.clientX, y: e.clientY })
  }

  function handleReloadTab(_tab: BrowserTab) {
    window.electronAPI.viewReload()
  }

  async function handleClearSession(tab: BrowserTab) {
    // Close view, clear partition cookies/localStorage, remove tab.
    window.electronAPI.closeView(tab.id)
    await window.electronAPI.clearPartitionStorage(tab.gmail.partition).catch(() => {})
    setTabs(prev => prev.filter(t => t.id !== tab.id))
    if (activeId === tab.id) setActiveId(null)
  }

  // ── Manage tools modal ────────────────────────────────────────

  function openManageTools() {
    setAddToolName('')
    setAddToolUrl('')
    setAddToolError('')
    setShowManageTools(true)
  }

  function closeManageTools() {
    setShowManageTools(false)
  }

  async function handleAddTool() {
    setAddToolError('')
    const name = addToolName.trim()
    let url = addToolUrl.trim()
    if (!name || !url) { setAddToolError('Name and URL are required'); return }
    if (!url.startsWith('http')) url = 'https://' + url
    try { new URL(url) } catch { setAddToolError('Invalid URL'); return }
    await window.electronAPI.toolsAdd(name, url)
    await loadTools()
    setAddToolName('')
    setAddToolUrl('')
  }

  async function handleRemoveTool(id: string) {
    const affectedTabs = tabs.filter(t => t.tool.id === id)
    for (const t of affectedTabs) window.electronAPI.closeView(t.id)
    setTabs(prev => prev.filter(t => t.tool.id !== id))
    if (activeId && affectedTabs.some(t => t.id === activeId)) {
      setActiveId(null)
      window.electronAPI.hideView()
    }
    await window.electronAPI.toolsRemove(id)
    await loadTools()
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex h-full" style={{ background: 'var(--bg)' }}>

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── HEADER ROW (44px): nav + active session indicator ── */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: '44px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            padding: '0 12px',
            gap: '6px',
          }}
        >
          {/* Nav buttons */}
          {[
            { icon: ChevronLeft,  title: 'Back',    onClick: () => window.electronAPI.viewGoBack() },
            { icon: ChevronRight, title: 'Forward', onClick: () => window.electronAPI.viewGoForward() },
            { icon: RotateCcw,    title: 'Reload',  onClick: () => window.electronAPI.viewReload() },
          ].map(({ icon: Icon, title, onClick }) => (
            <button
              key={title}
              onClick={onClick}
              title={title}
              disabled={!activeTab}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '7px',
                background: 'transparent', border: 'none',
                cursor: activeTab ? 'pointer' : 'not-allowed',
                color: activeTab ? 'var(--text-3)' : 'var(--text-3)',
                opacity: activeTab ? 1 : 0.4,
                transition: 'all 0.12s',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (!activeTab) return
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
              }}
            >
              <Icon size={14} strokeWidth={2} />
            </button>
          ))}

          {/* Divider */}
          <div style={{ width: '1px', height: '18px', background: 'var(--border)', margin: '0 4px' }} />

          {/* Active session indicator */}
          {activeTab ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <img
                src={getFaviconUrl(activeTab.tool.url)}
                alt=""
                style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, objectFit: 'contain' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
              <span style={{
                fontSize: '12px', fontWeight: 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
              }}>
                {activeTab.tool.name}
              </span>
              <div style={{
                width: '5px', height: '5px',
                borderRadius: '50%',
                background: activeTab.gmail.color ?? '#6B7280',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: '11px',
                color: 'var(--text-3)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {activeTab.gmail.email}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              Select a session from the right →
            </span>
          )}
        </div>

        {/* ── PROMPT BAR (40px) ── */}
        <PromptBar activeTab={activeTab} isActive={isActive} />

        {/* ── EMPTY STATE / VIEW PLACEHOLDER ── */}
        {!activeTab ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'Outfit, sans-serif', marginBottom: '4px' }}>
                AI Browser
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                {customTools.length === 0
                  ? 'Pehle tools library mein koi tool add karo'
                  : 'Right panel se naya session khol kar shuru karo'}
              </p>
            </div>

            {customTools.length === 0 ? (
              <button
                onClick={openManageTools}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '11px 18px', borderRadius: '11px', cursor: 'pointer',
                  background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
                  color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'white' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
              >
                <Plus size={14} />
                Tools Library Setup Karo
              </button>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                gap: '8px', width: '100%', maxWidth: '320px',
              }}>
                {customTools.slice(0, 6).map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => openAddSession(tool.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px',
                      padding: '13px 10px', borderRadius: '11px', cursor: 'pointer',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    }}
                  >
                    <img
                      src={getFaviconUrl(tool.url)}
                      alt=""
                      style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-2)', textAlign: 'center', lineHeight: 1.2 }}>
                      {tool.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1" style={{ background: 'var(--surface)' }} />
        )}
      </div>

      {/* ── TOOL DOCK (right sidebar) ── */}
      <ToolDock
        tabs={tabs}
        activeId={activeId}
        customTools={customTools}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onAddSession={openAddSession}
        onManageTools={openManageTools}
        onContextMenu={handleContextMenu}
      />

      {/* ── CONTEXT MENU ── */}
      {ctxMenu && (
        <AccountContextMenu
          tab={ctxMenu.tab}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onReload={handleReloadTab}
          onClearSession={handleClearSession}
          onRemove={t => handleCloseTab(t.id)}
        />
      )}

      {/* ── ADD SESSION MODAL ── (unchanged from before, content reused) */}
      {showAddSession && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/40 backdrop-blur-sm"
          onClick={closeAddSession}
        >
          <div
            className="w-full max-w-[420px] rounded-2xl overflow-hidden shadow-2xl bg-surface border border-border"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-base font-display text-tx">New Browser Session</h3>
              <button onClick={closeAddSession} className="p-1.5 rounded-lg transition-colors text-t3 hover:text-tx hover:bg-s2">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-5">
              {/* Tool */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3 text-t3">1. Tool</p>
                {customTools.length === 0 ? (
                  <div className="text-center py-5 rounded-xl bg-s2 border border-border">
                    <p className="text-sm font-medium text-t2">No tools in library</p>
                    <p className="text-xs mt-1 text-t3">Click Manage Tools to add one.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-[150px] overflow-y-auto pr-0.5">
                    {customTools.map(tool => {
                      const isSelected = selectedToolId === tool.id
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setSelectedToolId(tool.id)}
                          className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-all border ${
                            isSelected
                              ? 'bg-accent-m border-accent-border'
                              : 'bg-s2 border-border hover:border-accent-border hover:bg-s3'
                          }`}
                        >
                          <img
                            src={getFaviconUrl(tool.url)}
                            alt=""
                            style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                          <span className={`text-[10px] font-medium text-center leading-tight ${isSelected ? 'text-accent' : 'text-t2'}`}>
                            {tool.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Gmail */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3 text-t3">2. Gmail Account</p>
                {gmailSessions.length === 0 ? (
                  <div className="text-center py-5 rounded-xl bg-s2 border border-border">
                    <p className="text-sm font-medium text-t2">No Gmail accounts</p>
                    <p className="text-xs mt-1 text-t3">Add a Gmail from the Accounts page first.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-0.5">
                    {gmailSessions.map(s => {
                      const isSelected = selectedGmailEmail === s.email
                      const color = s.color ?? '#6B7280'
                      return (
                        <button
                          key={s.email}
                          onClick={() => setSelectedGmailEmail(s.email)}
                          className={`flex items-center gap-3 p-3 rounded-xl transition-all text-left border ${
                            isSelected
                              ? 'bg-accent-m border-accent-border'
                              : 'bg-s2 border-border hover:border-accent-border hover:bg-s3'
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center font-bold flex-shrink-0 text-sm text-white"
                            style={{ background: color }}
                          >
                            {s.email[0].toUpperCase()}
                          </div>
                          <span className={`text-xs font-medium truncate flex-1 ${isSelected ? 'text-accent' : 'text-tx'}`}>
                            {s.email}
                          </span>
                          <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center border-solid transition-colors ${
                            isSelected ? 'border-accent border-4 box-border bg-white' : 'border-border border-2'
                          }`} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={handleAddSession}
                disabled={!selectedToolId || !selectedGmailEmail || customTools.length === 0 || gmailSessions.length === 0}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 bg-accent hover:bg-accent-h"
              >
                Open Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MANAGE TOOLS MODAL ── (unchanged content, reused) */}
      {showManageTools && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/40 backdrop-blur-sm"
          onClick={closeManageTools}
        >
          <div
            className="w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl bg-surface border border-border"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-base font-display text-tx">Tools Library</h3>
              <button onClick={closeManageTools} className="p-1.5 rounded-lg transition-colors text-t3 hover:text-tx hover:bg-s2">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-t3">Add New Tool</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 text-xs rounded-lg px-3 py-2 bg-s2 border border-border text-tx focus:outline-none focus:border-accent transition-colors"
                    placeholder="Name"
                    value={addToolName}
                    onChange={e => setAddToolName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                  <input
                    className="flex-[2] text-xs rounded-lg px-3 py-2 bg-s2 border border-border text-tx focus:outline-none focus:border-accent transition-colors"
                    placeholder="URL (e.g. elevenlabs.io)"
                    value={addToolUrl}
                    onChange={e => setAddToolUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                  <button
                    onClick={handleAddTool}
                    className="flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-h transition-colors flex items-center justify-center"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {addToolError && <p className="text-[11px] text-red-500">{addToolError}</p>}
              </div>

              <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
                {customTools.length === 0 && (
                  <p className="text-xs text-center py-6 text-t3">No tools yet — add your first one above</p>
                )}
                {customTools.map(tool => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-s2 border border-border group"
                  >
                    <img
                      src={getFaviconUrl(tool.url)}
                      alt=""
                      style={{ width: '15px', height: '15px', objectFit: 'contain', flexShrink: 0 }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-tx truncate">{tool.name}</p>
                      <p className="text-[10px] text-t3 truncate">{tool.url}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveTool(tool.id)}
                      className="flex-shrink-0 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-t3 hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Successful build, no errors.

- [ ] **Step 6: Manually verify the redesign**

Run: `npm run dev`

Check the AI Browser page:
- Right sidebar (220px) shows every tool from your tools library with chevron + favicon + name + count badge.
- Tools with no open tabs are collapsed by default; clicking a tool toggles expand/collapse.
- Expanded tool shows account rows (Gmail color dot + email) and a dashed `+ Add account` button at the end.
- Active account row has a colored border + glow.
- Hovering an account row reveals an X close button (also visible on the active row).
- Right-clicking an account row opens a context menu with Reload / Clear Session / Remove Account.
- Bottom of sidebar has `[+ New Session]` (primary) and `[⚙ Manage Tools]` buttons.
- Header row (44px above PromptBar) shows back/forward/reload buttons and the active tool + Gmail email.
- PromptBar still works (Inject Prompt opens the overlay; injection works for ChatGPT/Claude/Gemini/Grok).
- Empty state: when no active tab, the centered quick-launch tiles open a pre-filled Add Session modal.
- Adding/removing a tool from the Manage Tools modal updates the sidebar.
- Restarting the app remembers which tool sections are expanded (via `useDockExpanded`).

- [ ] **Step 7: Commit (optional)**

```bash
git add src/pages/AIBrowser.tsx src/components/browser/PromptBar.tsx src/components/browser/ToolDock.tsx src/components/browser/AccountContextMenu.tsx src/hooks/useDockExpanded.ts
git commit -m "feat(ai-browser): redesign — right ToolDock + 44px header bar"
```

---

## Task 7: Final Cross-Page Verification

**Files:** none modified.

This task verifies that the three changes do not interfere with each other.

- [ ] **Step 1: Run the app**

Run: `npm run dev`

- [ ] **Step 2: Verify Social Hub**

- Open Social Hub → click Instagram → right `AppDock` is fully visible.
- Switch to LinkedIn → right dock still visible.
- Resize the window → both stay laid out correctly.
- Click the active platform icon to deactivate → empty state, dock visible.

- [ ] **Step 3: Verify AI Browser → Claude login**

- Open AI Browser. Add Claude (`https://claude.ai`) to Tools Library if not present.
- Open a session: tool = Claude, gmail = some account.
- On Claude's login page click "Continue with Google".
- Confirm: a popup window opens INSIDE the Electron app (not the system browser).
- Complete Google sign-in. The main Claude view becomes logged in.
- Reload Claude → still logged in (session persisted).

- [ ] **Step 4: Verify AI Browser redesign across tools**

- ChatGPT login still works (regression check — should redirect, not popup).
- Gemini login still works.
- Grok login still works.
- Switching between sessions in the right sidebar swaps the active view correctly.
- Inject Prompt overlay still works for each AI tool.

- [ ] **Step 5: Verify Gmail tab still opens external links externally**

- Open Accounts page → click a Gmail tab.
- Open any email with a link → click the link → opens in the **system** browser.

- [ ] **Step 6: Build the production bundle**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 7: Commit final state (optional)**

```bash
git add -A
git commit -m "chore: verify integrated changes"
```

---

## Summary of Deliverables

| # | Change | File(s) |
|---|---|---|
| 1 | Social Hub right-dock visible | `electron/socialHub.ts` |
| 2 | OAuth URL helpers + tests | `electron/oauthRouting.ts`, `electron/oauthRouting.test.ts` |
| 3 | Claude login OAuth popup routing | `electron/sessions.ts` |
| 4 | New ToolDock + persistence hook | `src/components/browser/ToolDock.tsx`, `src/hooks/useDockExpanded.ts` |
| 5 | New AccountContextMenu | `src/components/browser/AccountContextMenu.tsx` |
| 6 | AI Browser refactor + PromptBar slim-down | `src/pages/AIBrowser.tsx`, `src/components/browser/PromptBar.tsx` |
| 7 | Optional vitest config update | `vitest.config.ts` |
