# FlowDesk — Pages Reference

> Har page ka detailed breakdown: state, props, IPC calls, UI components, interactions.

---

## Page 1: Dashboard (`src/pages/Dashboard.tsx`)

### Purpose
App ka home screen. Quick stats overview aur frequently used prompts.

### State Used
- `useWorkspaceStore` → `workspaces`, `activeWorkspaceId`
- `usePromptStore` → `prompts`
- `useAccountStore` → `accounts`

### UI Components

**Stat Cards Row**
```tsx
<StatCard label="Total Prompts" value={prompts.length} />
<StatCard label="AI Accounts" value={accounts.length} />
<StatCard label="Workspaces" value={workspaces.length} />
<StatCard label="This Week" value={promptsThisWeek} />
```

**Recent Prompts List**
- Top 5 prompts sorted by `used_count` descending
- Each item: name, usage count badge, last used relative time
- Click → navigates to Prompts page with that prompt selected

**Active AI Sessions**
- Lists open AIBrowser tabs
- Each: favicon + tool name + gmail label

**Workspace Selector**
- Dropdown showing all workspaces
- Change workspace → all stores refresh

### Key Logic
```typescript
const promptsThisWeek = prompts.filter(p => {
  const created = new Date(p.created_at);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return created > weekAgo;
}).length;
```

---

## Page 2: AIBrowser (`src/pages/AIBrowser.tsx`)

### Purpose
Multi-tab browser sessions. Har tab = 1 custom tool URL + 1 Gmail account. Isolated Electron partitions.

### Local State
```typescript
const [tabs, setTabs] = useState<BrowserTab[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
const [showAddModal, setShowAddModal] = useState(false);
const [showToolsModal, setShowToolsModal] = useState(false);
const [tools, setTools] = useState<CustomTool[]>([]);
const [gmailAccounts, setGmailAccounts] = useState<GmailSession[]>([]);
```

### IPC Calls
| Call | When | Returns |
|------|------|---------|
| `toolsList()` | On mount | `CustomTool[]` |
| `gmailList()` | On mount + add modal | `GmailSession[]` |
| `toolsAdd(name, url)` | Add tool form | `CustomTool` |
| `toolsRemove(id)` | Delete tool | void |
| `switchView(tabId, partition, url)` | Tab click | void |
| `hideView()` | Before inject overlay | void |
| `closeView(tabId)` | Tab close (×) | void |
| `injectToTab(tabId, text, tool)` | Inject button | boolean |

### Tab Bar UI
```
┌──────────────────────────────────────────────────────┐
│ [🤖 ChatGPT · abc@gmail ×] [🔵 Claude · xyz ×] [+] [⚙] │
└──────────────────────────────────────────────────────┘
```
- Tab background = Gmail account's `bgLight` color
- Active tab = `bg` color + colored dot
- Drag handle (cursor: grab) for reordering
- `+` opens Add Session modal
- `⚙` opens Manage Tools modal

### Empty State (No Tabs)
```
┌─────────────────────────────────────────────────────┐
│                 Quick Launch                        │
│                                                     │
│  [ChatGPT]  [Claude]  [Gemini]  [Grok]             │
│  [Tool 5]   [Tool 6]                               │
│                                                     │
│  Click any tool to start a session                  │
└─────────────────────────────────────────────────────┘
```

### Add Session Modal
```
┌──────────────────────────────────┐
│  Add New Session                 │
│                                  │
│  Select Tool:                    │
│  ○ ChatGPT                       │
│  ● Claude                        │
│  ○ Gemini                        │
│                                  │
│  Select Gmail:                   │
│  ○ abc@gmail (My Main)           │
│  ● xyz@gmail (Work)              │
│                                  │
│  [Cancel]  [Open Session]        │
└──────────────────────────────────┘
```

### Manage Tools Modal
```
┌──────────────────────────────────┐
│  Tools Library            [+]    │
│  ─────────────────────────────── │
│  ChatGPT    chatgpt.com    [🗑]   │
│  Claude     claude.ai      [🗑]   │
│  My Tool    mytool.com     [🗑]   │
│                                  │
│  Add new:                        │
│  Name: [__________]              │
│  URL:  [__________]              │
│  [Add Tool]                      │
└──────────────────────────────────┘
```

### Tab Drag Reorder
- `draggable={true}` on each tab
- `onDragStart`, `onDragOver`, `onDrop` handlers
- Drop swaps positions in `tabs` array
- Visual feedback: opacity drop on dragged tab

---

## Page 3: PromptLibrary (`src/pages/PromptLibrary.tsx`)

### Purpose
Full-featured prompt management. Local categories (electron-store) + Supabase prompts (optional).

### Local State
```typescript
const [categories, setCategories] = useState<PromptCategory[]>([]);
const [prompts, setPrompts] = useState<Prompt[]>([]);
const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState('');
const [editingPrompt, setEditingPrompt] = useState<Partial<Prompt> | null>(null);
const [isDirty, setIsDirty] = useState(false);
const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'saving'>('idle');
```

### IPC Calls
| Call | When | Returns |
|------|------|---------|
| `promptsList()` | On mount | `Prompt[]` |
| `promptsCategoriesList()` | On mount | `PromptCategory[]` |
| `promptsSave(id, name, content, catId)` | Save button | `Prompt` |
| `promptsDelete(id)` | Delete button | void |
| `promptsCategoriesSave(id, name, color)` | Save category | `PromptCategory` |
| `promptsCategoriesDelete(id)` | Delete category | void |

### 3-Pane Layout

**Left Pane — Categories (min-width: 180px)**
```
All Prompts (24)
──────────────
Work (8)
  color dot + name + count
Personal (12)
Meeting Notes (4)
──────────────
[+ New Category]
```

**Center Pane — Prompt List**
```
[🔍 Search prompts...]
──────────────────────
● Email Writer         ← selected
  Hello {{name}}, I...
  used 12×  |  🏷️ work, email

  Code Reviewer
  Review this code for...
  used 8×   |  🏷️ dev
```

**Right Pane — Editor**
```
Title: [_________________________]

Content:
┌─────────────────────────────┐
│ Hello {{name}}!             │
│ ...                         │
│                             │
└─────────────────────────────┘

Variables: {{name}} {{topic}}
           (amber chips)

Category: [Work ▼]

[Cancel]  [Save]
```

### Save Status Indicator
- "Saving..." during IPC call
- "Saved ✓" for 2 seconds after success
- Then back to idle

### Variable Extraction
```typescript
// Regex: /\{\{(\w+)\}\}/g
const extractVars = (content: string): string[] => {
  const matches = content.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
};
```

---

## Page 4: Accounts (`src/pages/Accounts.tsx`)

### Purpose
Gmail accounts manage karo. Add, remove, rename, color change, aur inbox view.

### Local State
```typescript
const [accounts, setAccounts] = useState<GmailSession[]>([]);
const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
const [activeTab, setActiveTab] = useState<'info' | 'gmail'>('info');
const [editingLabel, setEditingLabel] = useState(false);
const [showColorPicker, setShowColorPicker] = useState(false);
const [toast, setToast] = useState<{msg: string; type: 'success'|'error'} | null>(null);
const [showEmailFallback, setShowEmailFallback] = useState(false);
const [pendingPartition, setPendingPartition] = useState<string | null>(null);
```

### IPC Calls
| Call | When | Returns |
|------|------|---------|
| `gmailList()` | On mount | `GmailSession[]` |
| `gmailAdd()` | Add button | `GmailSession \| {error, partition?}` |
| `gmailFinalizeAdd(email, partition)` | Manual fallback | `GmailSession \| {error}` |
| `gmailUpdateLabel(email, label)` | Save label | void |
| `gmailUpdateColor(email, color)` | Color picker change | void |
| `gmailOpenInbox(tabId, partition)` | Gmail tab click | void |
| `gmailOpenLogin(email, partition)` | Re-auth button | void |
| `gmailRemove(email)` | Remove button | void |
| `setCustomBounds(x, y, w, h)` | Gmail tab visible | void |

### Left Sidebar
```
┌──────────────────┐
│  Gmail Accounts  │
│                  │
│  🟣 abc@gmail    │  ← colored avatar (initials)
│  🔵 xyz@gmail    │
│  🟢 work@gmail   │
│                  │
│  [+ Add Account] │
└──────────────────┘
```

- Avatar color: `gmailUpdateColor` se set, ya email hash se default
- Initials: first letter of label or email
- Click → right panel update

### Right Panel — Info Tab
```
┌──────────────────────────────────┐
│  🟣 A                            │
│  abc@gmail.com                   │
│  Display name: [My Main ✏]       │
│  Added: 3 days ago               │
│                                  │
│  [Change Color]                  │
│  [Open Gmail Login]              │
│  [Remove Account]                │
└──────────────────────────────────┘
```

### Right Panel — Gmail Tab
- WebContentsView renders Gmail inbox
- ResizeObserver watches panel size
- `setCustomBounds(x, y, w, h)` called on size change
- Usi partition ki Gmail open hoti hai

### Add Account Flow
```
User clicks "Add"
    ↓
gmailAdd() IPC
    ↓
Login popup opens (BrowserWindow)
    ↓
User signs in to Google
    ↓
Window closes
    ↓
[success] → GmailSession returned → list update
[error: detect_failed] → showEmailFallback = true
    ↓
User types email manually
    ↓
gmailFinalizeAdd(email, partition) → GmailSession
```

### Color System
```typescript
// Default color derived from email hash
function hashColor(email: string): string {
  let hash = 0;
  for (const c of email) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 55%)`;
}
```

---

## Page 5: YTStudio (`src/pages/YTStudio.tsx`)

### Purpose
Multiple YouTube channels manage karo. Har channel ka YouTube Studio isolated session mein.

### Local State
```typescript
const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
const [activeId, setActiveId] = useState<string | null>(null);
const [switching, setSwitching] = useState(false);
const [showEmailFallback, setShowEmailFallback] = useState(false);
const [pendingPartition, setPendingPartition] = useState<string | null>(null);
const [editingId, setEditingId] = useState<string | null>(null);
const [navWidth, setNavWidth] = useState(172);
```

### IPC Calls
| Call | When | Returns |
|------|------|---------|
| `ytList()` | On mount | `YouTubeAccount[]` |
| `ytAdd()` | + button | `YouTubeAccount \| {error, partition?}` |
| `ytFinalizeAdd(email, partition)` | Manual fallback | `YouTubeAccount \| {error}` |
| `ytRemove(id)` | Remove button | void |
| `ytUpdateLabel(id, label)` | Rename | void |
| `ytSetLastTab(id, tab)` | Tab change | void |
| `ytOpenLoginWindow(partition)` | Re-auth | void |
| `ytDetectChannelId(partition)` | After login | `string \| null` |
| `ytOpenExternal(url)` | External link | void |
| `switchView(id, partition, url)` | Account switch | void |

### Account Bar UI
```
┌─────────────────────────────────────────────────────┐
│  [🟣 Channel 1 ●] [🔵 Channel 2] [+ - - -]         │
└─────────────────────────────────────────────────────┘
```
- Active pill: glow effect + filled dot indicator
- "+" pill: dashed border (add new)
- Long press or right-click: rename/remove options

### WebContentsView Content
- URL: `https://studio.youtube.com/`
- Per-account partition: `persist:yt-{uuid}`
- `switching` state shows loading spinner during view change

### Inline Rename
```typescript
// Double-click label → input appears
<input
  value={editLabel}
  onBlur={() => saveLabel()}
  onKeyDown={e => e.key === 'Enter' && saveLabel()}
/>
```

### sidebar width awareness
```typescript
useEffect(() => {
  const handler = (e: CustomEvent) => setNavWidth(e.detail);
  window.addEventListener('nav-resize', handler);
  return () => window.removeEventListener('nav-resize', handler);
}, []);
```

---

## Page 6: Workspace (`src/pages/Workspace.tsx`)

### Purpose
Personal Google Calendar + Tasks. Ek fixed Google account ke saath.

### Local State
```typescript
type ConnectionState = 'loading' | 'not-connected' | 'connecting' | 'confirming' | 'connected';

const [state, setConnectionState] = useState<ConnectionState>('loading');
const [email, setEmail] = useState<string | null>(null);
const [activeTool, setActiveTool] = useState<'calendar' | 'tasks'>('calendar');
const [navWidth, setNavWidth] = useState(172);
const [showConfirmModal, setShowConfirmModal] = useState(false);
```

### IPC Calls
| Call | When | Returns |
|------|------|---------|
| `workspaceGetEmail()` | On mount | `string \| null` |
| `workspaceSetEmail(email)` | After confirm | void |
| `workspaceOpenLogin()` | Connect button | void |
| `workspaceLogout()` | Logout button | void |
| `switchView(id, partition, url)` | Tool switch | void |
| `setCustomBounds(x, y, w, h)` | Layout ready | void |

### State Machine Flow
```
loading
  → workspaceGetEmail()
  → email exists? → connected
  → no email? → not-connected

not-connected
  → [Connect Google Account] button
  → workspaceOpenLogin()
  → connecting

connecting
  → Login popup closes (event)
  → setConnectionState('confirming')
  → showConfirmModal = true

confirming
  → User sees: "You logged in as X@gmail.com. Correct?"
  → [Yes] → workspaceSetEmail(email) → connected
  → [No] → workspaceLogout() → not-connected

connected
  → switchView() with calendar/tasks URL
  → setCustomBounds() to fill area
```

### Toolbar (when connected)
```
[Calendar] [Tasks]  |  user@gmail.com  |  [↺ Refresh] [⎋ Logout]
```

### Not Connected Screen
```
┌─────────────────────────────────────────────┐
│                                             │
│    📅  Personal Workspace                   │
│                                             │
│    Connect your Google account to access    │
│    Calendar and Tasks in one place.         │
│                                             │
│    [Connect Google Account]                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Page 7: Settings (`src/pages/Settings.tsx`)

### Purpose
App-wide configuration. Hotkeys, startup, tray, workspaces.

### Sections

**General Section**
```typescript
interface GeneralSettings {
  launchOnStartup: boolean;   // electron loginItemSettings
  minimizeToTray: boolean;    // window close → tray
  autoSyncInterval: number;   // seconds between Supabase syncs
  theme: 'light';             // only light for now
}
```

**Shortcuts Section**
```typescript
interface HotkeySettings {
  injectPanel: string;     // e.g. "Ctrl+Shift+P"
  captureSelection: string; // e.g. "Ctrl+Shift+S"
  switchAccount: string;   // e.g. "Ctrl+Tab"
}
```

HotkeyInput Component:
```
[  Ctrl + Shift + P  ] ← click to record
         ↓ click
[ Recording... press keys ] ← captures keydown
         ↓ press keys
[  Ctrl + Shift + P  ] ← saved
```

**Workspaces Section**
```
┌─────────────────────────────────┐
│  Workspaces                [+]  │
│                                 │
│  🟣 Personal         [active]   │
│  🔵 Work                [🗑]    │
│  🟢 Client A             [🗑]   │
│                                 │
│  New workspace:                 │
│  Name: [_________]              │
│  Color: [🎨]                    │
│  [Create]                       │
└─────────────────────────────────┘
```

### IPC + Store Calls
| Action | Method |
|--------|--------|
| Load settings | `storeGet('settings')` |
| Save setting | `storeSet('settings', newSettings)` |
| Toggle startup | `getLoginItemSettings()` |
| Create workspace | `useWorkspaceStore.create()` |
| Delete workspace | `useWorkspaceStore.remove()` |
| Register hotkey | `storeSet` + restart prompt |
