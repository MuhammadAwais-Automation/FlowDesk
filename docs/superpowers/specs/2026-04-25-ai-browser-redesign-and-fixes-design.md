# AI Browser Redesign + Social Hub & Claude Login Fixes

**Date:** 2026-04-25
**Status:** Approved (pending implementation plan)

## Overview

Three connected improvements to FlowDesk:

1. **Social Hub bug fix** — `WebContentsView` overlaps the right `AppDock` because bounds calculation does not subtract the dock's width.
2. **AI Browser UX redesign** — Replace the top tab bar with a right-side `ToolDock` (grouped tools + accounts), matching the Social Hub pattern for consistency.
3. **Claude login fix** — OAuth popups currently open in the system browser and lose the session. Route them into a same-session child `BrowserWindow` instead.

## 1. Social Hub Bounds Fix

### Problem
`electron/socialHub.ts` `updateBounds()` subtracts only `navWidth` (left nav). The right `AppDock` (56px) is rendered behind the `WebContentsView`, hiding it whenever a platform is open.

### Fix
Add a `SOCIAL_DOCK_W = 56` constant and subtract it from `width`:

```typescript
const SOCIAL_DOCK_W = 56

view.setBounds({
  x:      navWidth,
  y:      SOCIAL_NAV_H,
  width:  Math.max(bounds.width - navWidth - SOCIAL_DOCK_W, 100),
  height: Math.max(bounds.height - SOCIAL_NAV_H, 100),
})
```

No other changes required. The dock width is fixed in `AppDock.tsx`.

## 2. AI Browser Redesign

### Goals
- Match Social Hub layout pattern (right sidebar) for consistency.
- Scale to 10+ tools and multiple accounts per tool without crowding.
- Make adding accounts and tools a clear two-tier operation.
- Keep the existing PromptBar workflow.

### Layout

```
┌─────┬──────────────────────────────┬──────────────┐
│     │ [←][→][↺]  ● ChatGPT awais@  │ ▼ ChatGPT (2)│
│Left │──────────────────────────────│  ○ awais@.[X]│
│Nav  │ [Inject prompt...]    [Send] │  ○ work@...  │
│     │──────────────────────────────│             +│
│     │                              │ ▼ Claude  (1)│
│     │                              │  ○ awais@.   │
│     │     WebContentsView          │             +│
│     │     (active tool + account)  │ ▶ Gemini  (1)│
│     │                              │ ▶ Grok    (0)│
│     │                              │ ───────────  │
│     │                              │ [+ New Tool] │
│     │                              │ [⚙ Manage]   │
└─────┴──────────────────────────────┴──────────────┘
```

### Components

**`ToolDock`** (new, ~220px right sidebar)
- Lists every tool from `customTools` store.
- Each tool row: favicon, name, account count badge, expand/collapse chevron.
- Expanded state shows account rows: Gmail color avatar, email, hover-X close button.
- Active account: colored border + soft glow (matches existing Gmail color scheme).
- Per-tool inline `+` button at the end of the expanded list → opens "Add Account to <tool>" modal pre-filled with the tool selected.
- Sticky footer:
  - `[+ New Tool]` → opens existing Tools Library modal (add tool form)
  - `[⚙ Manage]` → opens Tools Library full management modal

**`TopBar`** (2 rows, ~88px total)
- Row 1 (44px): back / forward / reload buttons + active tool color dot + tool name + account email
- Row 2 (44px): existing `PromptBar` component (unchanged behaviour)

**`EmptyState`**
- Centered when no session active.
- "Open a session from the right panel →" message.
- Quick-launch tiles for the first 4 tools (click → opens Add Session modal pre-selected to that tool).

**`AccountContextMenu`** (right-click on account row)
- Reload
- Clear Session (destroy the partition's storage)
- Remove Account
- Switch to Another Tool (opens picker)

### State Changes

`AIBrowser.tsx` already manages `tabs[]` and `activeId`. No new top-level store needed. Instead:
- Replace top tab list rendering with `<ToolDock />`.
- Pass `tabs`, `activeId`, `customTools`, `gmailSessions` and callback handlers as props.
- Add a per-tool `expanded: Record<string, boolean>` state inside `ToolDock`, persisted to `localStorage` (key: `flowdesk:ai-browser-dock-expanded`).
- Tab close behavior unchanged — uses existing `electronAPI.closeView`.

### Flow Changes

| Action | Before | After |
|---|---|---|
| Add new account to existing tool | Top "+ Add" → modal → pick tool + Gmail | Right sidebar tool row → small "+" → modal pre-filled with tool |
| Add new tool | Top settings icon → manage modal | Sidebar footer `[+ New Tool]` |
| Switch session | Click top tab | Click account row in sidebar |
| Close session | Top tab X | Hover account row → X (or right-click → Remove) |

### What Stays
- `sessions.ts` view-management code (untouched by redesign — only by Claude fix).
- Tools Library modal contents (only the entry points change).
- Add Session modal contents (only its trigger and pre-fill change).
- PromptBar component.
- Drag-to-reorder is removed (sidebar grouping replaces it; can revisit if missed).

## 3. Claude Login Fix

### Root Cause
`electron/sessions.ts`:

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

Every AI Browser tab uses a Gmail partition (`gmail-{uuid}`), so `isGmail` is always true. ChatGPT/Gemini/Grok happen to use redirect-based OAuth (full-page redirect, no popup) so the handler is never triggered for them. Claude uses **popup-based OAuth** (`window.open()` to Google) — that popup is sent to the external system browser, where the user logs in but the cookies never make it back to the Electron session.

### Fix

Distinguish tab type by the **tab's URL**, not its partition. Route OAuth popups into a same-session child `BrowserWindow`:

```typescript
function isMailHost(url: string) {
  try { return new URL(url).hostname.endsWith('mail.google.com') } catch { return false }
}

function isOAuthPopup(url: string) {
  try {
    const h = new URL(url).hostname
    return h === 'accounts.google.com'
        || h.endsWith('.google.com') && url.includes('/oauth')
        || h === 'github.com' && url.includes('/login/oauth')
  } catch { return false }
}

view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
  const tabUrl = view!.webContents.getURL()

  // Gmail tab: external links go to system browser (existing behaviour)
  if (isMailHost(tabUrl)) {
    shell.openExternal(openUrl)
    return { action: 'deny' }
  }

  // AI tool tab: OAuth popups → same-session child window (auto-closes after auth)
  if (isOAuthPopup(openUrl)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 500,
        height: 660,
        webPreferences: {
          session: view!.webContents.session,
        },
      },
    }
  }

  // Other links: load in same view (existing behaviour)
  view!.webContents.loadURL(openUrl)
  return { action: 'deny' }
})
```

Cookies and storage land in the shared session, so once the popup closes, the main `WebContentsView` is logged in.

## Out of Scope
- Visual redesign of the Tools Library / Add Session modals.
- Drag-to-reorder in the new `ToolDock` (can be added later if missed).
- Multi-window AI sessions.
- Other social platforms' login issues (Instagram, TikTok bot detection — separate problem).

## Implementation Order
1. Social Hub bounds fix (smallest, independent).
2. Claude login fix (independent, ~30 min).
3. AI Browser redesign (largest):
   - `ToolDock` component
   - `AIBrowser.tsx` refactor (remove top tab bar, mount `ToolDock`)
   - Account context menu
   - Empty state quick-launch tiles
   - Persisted expand/collapse state

## Files Affected
- `electron/socialHub.ts` — bounds fix
- `electron/sessions.ts` — Claude login fix (handler logic, helpers)
- `src/pages/AIBrowser.tsx` — major refactor
- `src/components/browser/ToolDock.tsx` — **new**
- `src/components/browser/AccountContextMenu.tsx` — **new**
- `src/components/browser/PromptBar.tsx` — minor (placement only, no behaviour change)
- `src/types/browser.ts` — minor type additions if needed
