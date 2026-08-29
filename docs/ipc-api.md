# FlowDesk — IPC API Reference

> `window.electronAPI` — Renderer se main process communication.
> Defined in: `electron/preload.ts` (contextBridge), `electron/main.ts` (handlers), `src/types/electron.d.ts` (TypeScript types)

---

## How IPC Works

```
Renderer (React)                    Main Process (Electron)
─────────────────                   ──────────────────────
window.electronAPI.gmailList()  →   ipcMain.handle('gmail:list', ...)
                                ←   returns GmailSession[]
```

**Security:** `contextIsolation: true` — preload script mein `contextBridge.exposeInMainWorld` se safe API expose hoti hai.

---

## Namespace: `store` — electron-store Access

```typescript
storeGet(key: string): Promise<unknown>
storeSet(key: string, value: unknown): Promise<void>
```

**Keys used:**
- `"settings"` → AppSettings object
- `"gmail-sessions"` → GmailSession[]
- `"yt-accounts"` → YouTubeAccount[]
- `"custom-tools"` → CustomTool[]
- `"prompts"` → Prompt[]
- `"prompt-categories"` → PromptCategory[]
- `"workspace-email"` → string

---

## Namespace: `gmail` — Gmail Session Management

### `gmailList(): Promise<GmailSession[]>`
Returns all saved Gmail sessions.
```typescript
// Returns:
[
  { email: "abc@gmail.com", label: "My Main", partition: "persist:gmail-uuid1", addedAt: "2024-01-15T...", color: "#4F6EF7" },
  { email: "xyz@gmail.com", label: "Work", partition: "persist:gmail-uuid2", addedAt: "2024-01-16T...", color: null }
]
```

### `gmailAdd(): Promise<GmailSession | { error: string; partition?: string }>`
Opens Gmail login BrowserWindow. Auto-detects email.
```typescript
// Success:
{ email: "new@gmail.com", label: "new@gmail.com", partition: "persist:gmail-abc123", addedAt: "...", color: null }

// Error cases:
{ error: "detect_failed", partition: "persist:gmail-abc123" }  // need manual email
{ error: "duplicate" }                                           // already added
{ error: "cancelled" }                                           // window closed
```

### `gmailFinalizeAdd(email: string, partition: string): Promise<GmailSession | { error: string }>`
Manual fallback when auto-detection fails.
- `email` — User-typed Gmail address
- `partition` — From previous `gmailAdd()` error response

### `gmailRemove(email: string): Promise<void>`
Deletes session from electron-store. Does NOT clear cookies.

### `gmailOpenLogin(email: string, partition: string): Promise<void>`
Opens re-authentication popup for existing account.

### `gmailUpdateLabel(email: string, label: string): Promise<void>`
Sets custom display name for account.

### `gmailUpdateColor(email: string, color: string): Promise<void>`
Sets hex color string (e.g. `"#FF5733"`). Used for avatar + tab coloring.

### `gmailOpenInbox(tabId: string, partition: string): Promise<void>`
Shows Gmail inbox (mail.google.com) in WebContentsView.
- `tabId` — Unique identifier for the view (typically email address)
- `partition` — Session partition string

---

## Namespace: `yt` — YouTube Account Management

### `ytList(): Promise<YouTubeAccount[]>`
```typescript
[
  { id: "uuid1", email: "ch1@gmail.com", label: "Channel 1", partition: "persist:yt-uuid1", addedAt: "...", lastActiveTab: "overview" }
]
```

### `ytAdd(): Promise<YouTubeAccount | { error: string; partition?: string }>`
Opens YouTube/Google login. Same flow as `gmailAdd()`.

### `ytFinalizeAdd(email: string, partition: string): Promise<YouTubeAccount | { error: string }>`
Manual email fallback for YouTube accounts.

### `ytRemove(id: string): Promise<void>`
Removes account by UUID.

### `ytUpdateLabel(id: string, label: string): Promise<void>`
Sets display name.

### `ytSetLastTab(id: string, tab: string): Promise<void>`
Saves which YT Studio section was last viewed.
- `tab` values: `"overview"` | `"content"` | `"analytics"`

### `ytOpenLoginWindow(partition: string): Promise<void>`
Re-authentication popup.

### `ytDetectChannelId(partition: string): Promise<string | null>`
Loads hidden YouTube Studio page, executes JS to extract `UC...` channel ID.
Returns `null` if detection fails.

### `ytOpenExternal(url: string): Promise<void>`
Opens URL in system default browser (not in app).

---

## Namespace: `tools` — Custom Tools Library

### `toolsList(): Promise<CustomTool[]>`
```typescript
[
  { id: "uuid1", name: "ChatGPT", url: "https://chatgpt.com", addedAt: "..." },
  { id: "uuid2", name: "Claude", url: "https://claude.ai", addedAt: "..." }
]
```

### `toolsAdd(name: string, url: string): Promise<CustomTool>`
Creates new tool entry with random UUID.

### `toolsRemove(id: string): Promise<void>`
Deletes tool by ID.

### `toolsReorder(tools: CustomTool[]): Promise<void>`
Saves full reordered array (replaces existing).

---

## Namespace: `view` — WebContentsView Control

### `switchView(tabId: string, partition: string, url: string): Promise<void>`
Shows a persistent browser view.
- Creates WebContentsView if `tabId` not in cache
- Sets partition (isolated session)
- Loads URL
- Removes previous active view from window
- Adds new view to window
- Calculates bounds from `NAV_WIDTH + TOP_HEIGHT`

### `closeView(tabId: string): Promise<void>`
Destroys WebContentsView and removes from cache.

### `hideView(): Promise<void>`
Removes all WebContentsViews from window (they stay in cache). Used before showing React overlays.

### `getSelectedText(): Promise<string>`
Gets currently selected text from active WebContentsView. Returns empty string if nothing selected.

### `pageChanged(page: string): Promise<void>`
Notifies main process which React page is active.
- `page` values: `"browser"` | `"universalChat"` | `"agent"` | `"notebooklm"` | `"accounts"` | `"settings"` | `"youtube"` | `"workspace"`

### `setCustomBounds(x: number, y: number, w: number, h: number): Promise<void>`
Sets active view to exact pixel bounds. Used by:
- Accounts page (Gmail inbox area)
- Workspace page (Calendar/Tasks area)

### `viewGoBack(): Promise<void>`
History.back() on active view.

### `viewGoForward(): Promise<void>`
History.forward() on active view.

### `viewReload(): Promise<void>`
Reloads active view.

### `viewNavigate(url: string): Promise<void>`
Navigate active view to URL.

### `viewSetNavWidth(w: number): Promise<void>`
Updates nav width in sessions.ts. Triggers bounds recalculation for active view.
Called by `LeftNav.tsx` when user resizes sidebar.

---

## Namespace: `workspace` — Personal Google Account

### `workspaceGetEmail(): Promise<string | null>`
Returns saved Google email or null if not connected.

### `workspaceSetEmail(email: string): Promise<void>`
Saves email after user confirms it.

### `workspaceOpenLogin(): Promise<void>`
Opens Google sign-in popup with partition `persist:workspace-personal`.

### `workspaceLogout(): Promise<void>`
Clears session storage for workspace partition + clears saved email.

---

## Namespace: `app` — System

### `getLoginItemSettings(): Promise<{ openAtLogin: boolean }>`
Returns current Windows startup setting.

---

## Error Handling Patterns

```typescript
// Pattern 1: Check for error property
const result = await window.electronAPI.gmailAdd();
if ('error' in result) {
  if (result.error === 'detect_failed') {
    // Show manual input
    setPendingPartition(result.partition);
    setShowFallback(true);
  } else {
    showToast(result.error, 'error');
  }
} else {
  // Success — result is GmailSession
  setAccounts(prev => [...prev, result]);
}

// Pattern 2: Null check
const email = await window.electronAPI.workspaceGetEmail();
if (!email) setConnectionState('not-connected');
```
