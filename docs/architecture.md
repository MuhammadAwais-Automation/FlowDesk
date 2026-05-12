# FlowDesk — Architecture

## Project Structure

```
FlowDesk/
├── electron/                    # Main process (Node.js)
│   ├── main.ts                  # Entry point, IPC handlers, window setup
│   ├── sessions.ts              # WebContentsView cache + bounds management
│   └── preload.ts               # contextBridge — electronAPI exposed to renderer
│
├── src/                         # Renderer process (React)
│   ├── pages/                   # Top-level page components
│   │   ├── Dashboard.tsx
│   │   ├── AIBrowser.tsx
│   │   ├── PromptLibrary.tsx
│   │   ├── Accounts.tsx
│   │   ├── YTStudio.tsx
│   │   ├── Workspace.tsx
│   │   └── Settings.tsx
│   │
│   ├── components/              # Reusable UI components
│   │   ├── layout/
│   │   │   └── LeftNav.tsx      # Sidebar navigation
│   │   ├── browser/
│   │   │   ├── PromptBar.tsx    # Inject prompt bar + overlay
│   │   │   └── AccountSwitcher.tsx
│   │   └── prompt/
│   │       ├── PromptCard.tsx
│   │       ├── PromptDetail.tsx
│   │       └── PromptEditor.tsx
│   │
│   ├── store/                   # Zustand stores
│   │   ├── useWorkspaceStore.ts
│   │   ├── usePromptStore.ts
│   │   └── useAccountStore.ts
│   │
│   ├── types/                   # TypeScript types
│   │   ├── database.ts          # Supabase data models
│   │   ├── electron.d.ts        # ElectronAPI interface + IPC types
│   │   ├── browser.ts           # Browser tab + tool types
│   │   └── pages.ts             # Page name union type
│   │
│   ├── lib/                     # Utilities
│   │   ├── supabase.ts          # Supabase singleton client
│   │   ├── variables.ts         # {{var}} extraction + fill
│   │   └── utils.ts             # cn() class utility
│   │
│   └── App.tsx                  # Root component, page routing
│
├── resources/                   # Build resources (icon.ico)
├── supabase/                    # Supabase migrations/config
├── electron.vite.config.ts      # Build configuration
├── tailwind.config.js
└── package.json
```

---

## Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   main.ts    │  │ sessions.ts  │  │ electron-store│  │
│  │ IPC handlers │  │ View cache   │  │ Local persist │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │                 │                               │
│         └─────────────────┘                              │
│                    │ IPC                                  │
└────────────────────┼────────────────────────────────────┘
                     │ contextBridge (preload.ts)
┌────────────────────┼────────────────────────────────────┐
│                    │ Renderer Process (React)             │
│  ┌─────────────────▼──────────────────────────────────┐ │
│  │              window.electronAPI                     │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌───────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │  Zustand  │  │  Supabase  │  │  React Components  │  │
│  │  Stores   │  │  Client    │  │  Pages + Layout    │  │
│  └───────────┘  └────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────┐
                    │      WebContentsView Layer        │
                    │  (Native browser inside window)   │
                    │                                   │
                    │  ┌────────┐  ┌────────┐          │
                    │  │ Tab 1  │  │ Tab 2  │  ...     │
                    │  │ChatGPT │  │Claude  │          │
                    │  │gmail-A │  │gmail-B │          │
                    │  └────────┘  └────────┘          │
                    └──────────────────────────────────┘
```

---

## Data Storage Architecture

### 1. electron-store (Local, Persistent)
Electron main process mein save hota hai. App restart par bhi data rehta hai.

```typescript
// Stored keys:
{
  "settings": AppSettings,          // App configuration
  "gmail-sessions": GmailSession[], // Gmail accounts
  "yt-accounts": YouTubeAccount[],  // YouTube accounts
  "custom-tools": CustomTool[],     // Custom tool URLs
  "prompts": Prompt[],              // Local prompt library
  "prompt-categories": PromptCategory[], // Local categories
  "workspace-email": string,        // Personal workspace email
}
```

### 2. Supabase (Cloud, Optional)
React renderer process se direct access. Workspace-based multi-user data.

```
Tables:
├── workspaces          (id, name, description, color, created_at)
├── folders             (id, name, workspace_id, parent_id, position)
├── prompts             (id, title, content, folder_id, workspace_id, tags[], variables[], used_count, is_favorite, version)
├── prompt_versions     (id, prompt_id, content, version, created_at)
└── ai_accounts         (id, tool_name, tool_url, model_label, gmail, label, workspace_id, session_partition, is_active)
```

### 3. localStorage (Browser, UI Preferences)
React renderer mein save hota hai. Per-user UI state.

```javascript
{
  "navWidth": 172,      // Sidebar width in pixels
  "navCollapsed": false // Sidebar collapsed state
}
```

---

## WebContentsView System

### Key Concept
FlowDesk mein embedded browser windows ke liye **WebContentsView** use hota hai (Electron ka native API). Yeh regular BrowserView/webview se better hai kyunki:
- Persistent caching — tab switch par reload nahi hota
- Session isolation — har tab ka alag partition
- Bounds control — programmatically size/position set karo

### Bounds Calculation

```
Window (total)
├── LeftNav: NAV_WIDTH = 172px (dynamic, 120-280px range)
└── Content area: window.width - NAV_WIDTH
    ├── AIBrowser TOP_HEIGHT = 86px
    │   ├── Tab bar: 44px
    │   └── Prompt bar: 42px (inject button + nav controls)
    ├── YTStudio TOP_HEIGHT = 52px
    │   └── Account bar: 52px
    └── Accounts/Workspace: setCustomBounds() — custom per page
```

### View Lifecycle
```
1. switchView(tabId, partition, url)
   → Create WebContentsView if not in cache
   → Set partition (isolated cookies/storage)
   → Load URL
   → Add to BrowserWindow as child
   → Calculate bounds
   → Store in viewCache Map

2. hideView()
   → Remove all child views from window
   → Views still in cache (not destroyed)

3. closeView(tabId)
   → Remove from window
   → Destroy WebContentsView
   → Delete from viewCache

4. On window resize
   → Recalculate bounds for active view
   → Apply new bounds
```

---

## Session Isolation (Electron Partitions)

### Partition Naming Convention
```
Gmail accounts:    persist:gmail-{uuid}
YouTube accounts:  persist:yt-{uuid}
Personal workspace: persist:workspace-personal
```

### Why Partitions?
- Alag `uuid` partition = alag cookie jar + session storage
- Ek Gmail se login karo → sirf us partition mein session hogi
- Dusray partition pe jaao → completely fresh session
- `persist:` prefix = app restart ke baad bhi session rehti hai

---

## IPC Namespace Convention

```
gmail:*          → Gmail session management
yt:*             → YouTube account management
tools:*          → Custom tools library
prompts:*        → Local prompt library
prompts:categories:* → Local categories
view:*           → WebContentsView control
page:*           → Navigation events
workspace:*      → Personal workspace (Google)
store:*          → electron-store get/set
app:*            → App system (login settings, etc.)
```

---

## Global Keyboard Shortcuts

Registered in main process. Work even when window is not focused.

| Shortcut | Action | Handler |
|----------|--------|---------|
| Ctrl+Shift+P | Open inject panel | `onInjectPanel` event |
| Ctrl+Shift+S | Capture selected text | `onCaptureSelection` event |
| Ctrl+Tab | Switch account | (configurable) |

All hotkeys are configurable via Settings page → Shortcuts section.

---

## Build & Packaging

```bash
npm run dev          # Dev server with hot reload
npm run build        # Production build (current platform)
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS .app

# Output:
dist/                # Final packaged app
out/                 # Compiled JS (before packaging)
  ├── main/          # Electron main process
  ├── preload/       # Preload script
  └── renderer/      # React app
```

### App Identity
- App ID: `com.flowdesk.app`
- Product name: `FlowDesk`
- Internal name: `ai-manager` (package.json name)
- Window min size: 900×600
- Default window size: 1200×780
