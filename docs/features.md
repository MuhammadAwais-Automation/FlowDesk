# FlowDesk — Complete Features List

> Har feature ka description, UI ka appearance, aur kaise kaam karta hai.

---

## Feature 1: Multi-Tab AI Browser (AIBrowser)

### What it does
Ek hi window mein multiple AI tools (ChatGPT, Claude, Gemini, Grok, any custom URL) alag alag Gmail accounts ke saath open karo. Har tab = 1 tool + 1 Gmail account = isolated session.

### UI Layout
```
┌─────────────────────────────────────────────────────┐
│  [Tab 1: ChatGPT · abc@gmail]  [Tab 2: Claude · xyz@] [+] [⚙] │  ← Tab bar (44px)
├─────────────────────────────────────────────────────┤
│  [Inject Prompt]  [← → ↺]                          │  ← Prompt bar (42px)
├─────────────────────────────────────────────────────┤
│                                                     │
│          Native WebContentsView                     │
│         (actual AI tool website)                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Tab Appearance
- Tab color = Gmail account ka color (custom or hash-derived)
- Tab shows: favicon + tool name + gmail label
- Active tab = highlighted background + colored left border
- Close (×) button on each tab
- Drag tabs to reorder

### When no tabs open
- Quick launch grid: top 6 tools shown as cards (icon + name)
- Each card click opens "Add Session" modal

### Add Session Modal
- Left column: Tool selector (from custom tools list)
- Right column: Gmail account selector
- Confirm → creates new tab

### Manage Tools (⚙ button)
- List of all custom tools
- Add: name + URL input
- Remove: delete button per tool
- Default tools: ChatGPT, Claude, Gemini, Grok

---

## Feature 2: Prompt Injection

### What it does
Kisi bhi AI tab mein prompt automatically type/insert karo — bina copy-paste ke.

### How it works
1. AI tab open ho
2. "Inject Prompt" button click karo (ya Ctrl+Shift+P)
3. Native view temporarily hide hoti hai
4. React overlay appear hota hai (prompt selector)
5. Prompt select karo, variables fill karo
6. "Inject" click → JavaScript AI tool ke text area mein text type karta hai
7. Overlay band hoti hai, view wapas aata hai

### Inject Overlay UI
```
┌────────────────────────────────────┐
│  🔍 Search prompts...              │
├────────────────────────────────────┤
│  [Greeting template]               │
│  [Code review prompt]              │
│  [Email writer]                    │
│  ...                               │
└────────────────────────────────────┘
     ↓ (after selecting)
┌────────────────────────────────────┐
│  Fill variables:                   │
│  {{name}}: [_____________]         │
│  {{topic}}: [_____________]        │
│                                    │
│  Preview:                          │
│  Hello John! Today's topic is...   │
│                                    │
│  [Cancel]  [Inject]                │
└────────────────────────────────────┘
```

### Supported AI Tools for Injection
- ChatGPT (`chatgpt.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- Grok (`grok.com`)
- Other tools: injection not supported

---

## Feature 3: Prompt Library

### What it does
Prompts ka library manage karo — categories, variables, versioning, search sab kuch.

### UI Layout (3-pane)
```
┌──────────────┬───────────────┬──────────────────────────┐
│   CATEGORIES │   PROMPTS     │      EDITOR / DETAIL      │
│              │               │                           │
│ All Prompts  │ [Search...]   │  Title: ___________       │
│              │               │                           │
│ ▸ Work       │ • Greeting    │  Content:                 │
│ ▸ Personal   │ • Code review │  ┌───────────────────┐   │
│ + New Cat    │ • Email draft │  │ Hello {{name}}!   │   │
│              │               │  │ ...               │   │
│              │ • ...         │  └───────────────────┘   │
│              │               │                           │
│              │               │  Variables: {{name}}      │
│              │               │                           │
│              │               │  [Save]  [Delete]         │
└──────────────┴───────────────┴──────────────────────────┘
```

### Prompt Features
- **Title** — Prompt ka naam
- **Content** — Full text with `{{variable}}` placeholders
- **Category** — Folder-based organization
- **Tags** — Comma-separated tags for filtering
- **Variables** — Auto-detected `{{varName}}` patterns, shown as amber chips
- **Usage count** — Kitni baar inject hua
- **Last used** — Relative time (e.g., "2 days ago")
- **Version history** — Har save par version increment, history viewable
- **Favorite** — Star to favorite
- **Duplicate** — Copy with "(Copy)" suffix

### Category Features
- **Create** — Name + color picker
- **Rename** — Inline edit
- **Delete** — Prompts remain (uncategorized), category deleted
- **Color** — Each category ka custom color

### Search & Filter
- Search: name + content mein search
- Filter by tag: tag click karo
- Sort: by usage, recent, A-Z, newest
- Show favorites only: toggle

---

## Feature 4: Gmail Account Management

### What it does
Multiple Gmail accounts add karo, manage karo, aur unka inbox directly app mein dekho.

### UI Layout
```
┌──────────────────┬──────────────────────────────┐
│   ACCOUNTS       │  ACCOUNT DETAIL               │
│                  │                               │
│ ● abc@gmail  ✏  │  [Info]  [Gmail Inbox]        │
│ ● xyz@gmail  ✏  │                               │
│ ● ...            │  --- Info Tab ---             │
│                  │  Name: My Main Account        │
│ [+ Add Account]  │  Email: abc@gmail.com         │
│                  │  Added: 3 days ago            │
│                  │                               │
│                  │  [Change Color] [Open Login]  │
│                  │  [Remove Account]             │
└──────────────────┴──────────────────────────────┘
```

### Gmail Inbox Tab
- Account select karo → "Gmail" tab click karo
- WebContentsView andar Gmail inbox load hoti hai
- Bounds dynamically ResizeObserver se sync hote hain
- Yeh usi partition mein khulti hai jahan login hua tha

### Adding an Account
1. "+ Add Account" click
2. Login popup window khulti hai (Gmail OAuth)
3. User signs in
4. Email auto-detect hota hai
5. Duplicate check
6. Account list mein appear hota hai
7. Agar auto-detect fail → manual email input modal

### Account Properties
- **Email** — Actual Gmail address
- **Label** — Custom display name (editable)
- **Color** — Hex color picker (default: hash of email)
- **addedAt** — Timestamp
- **Partition** — `persist:gmail-{uuid}` (never changes)

---

## Feature 5: YouTube Studio Multi-Channel

### What it does
Multiple YouTube channels manage karo. Har channel ka YouTube Studio alag session mein khulta hai.

### UI Layout
```
┌─────────────────────────────────────────────────────┐
│  [● ch1@gmail] [ch2@gmail] [ch3@gmail] [+]          │  ← Account bar (52px)
├─────────────────────────────────────────────────────┤
│                                                     │
│         YouTube Studio (WebContentsView)            │
│         youtube.com/studio                          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Account Pill Appearance
- Colored avatar (initials, color from email hash)
- Label text
- Active account: dot indicator with glow
- Inactive: hover highlight

### Add Channel Flow
1. "+" dashed button click
2. Login popup (Google/YouTube OAuth)
3. Email auto-detected
4. Channel saved with partition
5. Pill appears in bar

### Account Actions (right-click or button)
- **Rename** — Inline edit label
- **Re-auth** — Open login popup again
- **Remove** — Delete with confirmation toast
- **External** — Open in system browser

---

## Feature 6: Personal Workspace (Google Calendar + Tasks)

### What it does
Apna personal Google Calendar aur Google Tasks directly app mein dekho aur use karo.

### UI Layout
```
┌─────────────────────────────────────────────────────┐
│  [Calendar]  [Tasks]  ⬜ user@gmail.com  [↺] [⎋]   │  ← Toolbar
├─────────────────────────────────────────────────────┤
│                                                     │
│         Google Calendar / Tasks                     │
│         (WebContentsView)                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Connection Flow (State Machine)
```
not-connected
    ↓ (click "Connect Google Account")
connecting
    ↓ (login popup opens, user signs in)
confirming
    ↓ (email confirmation modal shown)
connected
    ↓ (Calendar/Tasks loads)
```

### Toolbar Controls
- **Calendar tab** — google.com/calendar load karo
- **Tasks tab** — tasks.google.com load karo
- **Email pill** — Connected account show karta hai
- **Refresh** — Reload current view
- **Logout** — Session clear karo, back to not-connected

### Session
- Fixed partition: `persist:workspace-personal`
- Ek hi Google account (personal use)
- App restart ke baad bhi logged in rehta hai

---

## Feature 7: Settings

### What it does
App behavior configure karo — startup, hotkeys, tray, workspaces.

### Sections

#### General
| Setting | Type | Description |
|---------|------|-------------|
| Launch on startup | Toggle | Windows startup mein add |
| Minimize to tray | Toggle | Close karo → system tray mein jao |
| Auto-sync interval | Dropdown | Supabase sync frequency |
| Theme | Dropdown | Light (only option currently) |

#### Shortcuts
| Shortcut | Default | Description |
|----------|---------|-------------|
| Inject panel | Ctrl+Shift+P | Prompt inject overlay kholo |
| Capture selection | Ctrl+Shift+S | Selected text capture karo |
| Switch account | Ctrl+Tab | Next account pe jao |

- **Hotkey Recorder:** Click → press keys → recorded. Live capture.
- Format shown as `kbd` styled chips: `Ctrl` `Shift` `P`

#### Workspaces
- List of all Supabase workspaces
- Active workspace indicator
- Create new: name + color picker
- Delete workspace (confirmation required)

#### About
- App name, version, copyright info

---

## Feature 8: Dashboard

### What it does
App ka home page — quick overview aur navigation.

### UI Layout
```
┌─────────────────────────────────────────────────────┐
│  Good morning! ☀️                                   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Prompts │  │ Accounts │  │Workspaces│         │
│  │    24    │  │    5     │  │    3     │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  Recent Prompts (top 5 by usage):                   │
│  • Code reviewer        (used 42×)                  │
│  • Email template       (used 28×)                  │
│  • ...                                              │
│                                                     │
│  Active AI Sessions:                                │
│  • ChatGPT · abc@gmail                              │
│  • Claude · xyz@gmail                               │
└─────────────────────────────────────────────────────┘
```

### Stat Cards
- **Total Prompts** — All prompts in current workspace
- **AI Accounts** — Gmail + YT accounts combined
- **Workspaces** — Total Supabase workspaces
- **This Week** — Prompts created this week

### Quick Actions
- Each card is clickable → navigates to relevant page

---

## Feature 9: Left Navigation Sidebar

### What it does
App ka main navigation. Har page pe visible rehta hai.

### UI Layout
```
┌──────────────┐
│  ⚡ FlowDesk │  ← Logo (Zap icon)
├──────────────┤
│  ⊞ Dashboard │  ← Active: left border + bg highlight
│  🌐 AI Browser│
│  📝 Prompts   │
│  👤 Accounts  │
│  ▶ YT Studio  │
│  📅 Workspace │
├──────────────┤
│  ⚙ Settings  │  ← Bottom
│  ◀ Collapse  │  ← Toggle
└──────────────┘
```

### Resizable
- Right edge drag karo → width adjust hoti hai
- Min: 120px, Max: 280px, Default: 172px
- Collapsed: 48px (icons only, no text)
- Width saved to `localStorage`
- Width change → IPC via `view:setNavWidth` → WebContentsView bounds update

### Nav Item States
- **Active** — Blue left border + blue text + light blue background
- **Inactive** — Gray text
- **Hover** — Light gray background

---

## Feature 10: System Tray

### What it does
App ko background mein chalaao — taskbar se band karo, tray mein rehta hai.

### Behavior
- Tray icon: FlowDesk logo
- Double-click tray → window restore
- Right-click tray → context menu:
  - Show FlowDesk
  - Quit

### Enable
Settings → General → "Minimize to tray" toggle ON

---

## Feature 11: Variable Templates in Prompts

### What it does
Prompts mein `{{varName}}` patterns use karo. Inject karte waqt values fill karo.

### Syntax
```
Hello {{name}}! Today we'll discuss {{topic}} for {{duration}} minutes.
```

### How it works
1. Prompt save karo with `{{...}}` patterns
2. Variables auto-detected aur stored
3. Inject karo → if variables exist → fill modal appears
4. Har variable ke liye input field
5. Preview shows filled content
6. Inject karo → variable replace ho ke AI mein type hota hai

### Display
- Variable chips: amber/yellow background, monospace font
- In prompt detail: listed as clickable chips (copy to clipboard)
- In fill modal: input fields labeled with var names

---

## Feature 12: Version History for Prompts

### What it does
Har prompt edit pe version save hota hai. Purani versions dekh sako.

### How it works
- Prompt save → `version` number increment
- Old content → `prompt_versions` table mein save
- "History" button → modal opens
- Timeline of versions with content preview
- Restore previous version: click → editor mein load

---

## Feature 13: Multi-Workspace Support

### What it does
Supabase ke through multiple workspaces. Har workspace ka alag prompts, folders, accounts.

### Use case
- Personal workspace: personal prompts
- Work workspace: work prompts + accounts
- Client A workspace: client specific stuff

### Management
- Settings → Workspaces section
- Create: name + color
- Delete: removes workspace (prompts remain if not cascaded)
- Switch: sidebar ya Dashboard pe dropdown

---

## Summary Feature Matrix

| Feature | UI Location | Local/Cloud | Native/Web |
|---------|-------------|-------------|------------|
| Multi-tab AI Browser | AIBrowser page | Local (electron-store) | Native (WebContentsView) |
| Prompt Injection | PromptBar overlay | Local | JS injection |
| Prompt Library | Prompts page | Cloud (Supabase) | Web (React) |
| Gmail Management | Accounts page | Local (electron-store) | Both |
| YouTube Studio | YTStudio page | Local (electron-store) | Native (WebContentsView) |
| Google Calendar/Tasks | Workspace page | Local (session) | Native (WebContentsView) |
| Settings | Settings page | Local (electron-store) | Web (React) |
| Dashboard | Dashboard page | Cloud (Supabase) | Web (React) |
| Left Nav | All pages | Local (localStorage) | Web (React) |
| System Tray | Background | Local (electron-store) | Native |
| Variable Templates | Prompts + inject | Cloud (Supabase) | Web (React) |
| Version History | Prompts page | Cloud (Supabase) | Web (React) |
| Multi-Workspace | Settings + Dashboard | Cloud (Supabase) | Web (React) |
