# FlowDesk — TypeScript Types & Data Models

> Saare types jo FlowDesk mein use hote hain. Source files: `src/types/`

---

## `src/types/database.ts` — Supabase Models

### `Workspace`
```typescript
interface Workspace {
  id: string;           // UUID
  name: string;         // e.g. "Personal", "Work"
  description?: string; // Optional notes
  color: string;        // Hex color for UI e.g. "#4F6EF7"
  created_at: string;   // ISO timestamp
}
```

### `Folder`
```typescript
interface Folder {
  id: string;
  name: string;
  workspace_id: string;  // Parent workspace
  parent_id?: string;    // For nested folders (null = root)
  position: number;      // Sort order
  created_at: string;
}
```

### `Prompt` (Supabase)
```typescript
interface Prompt {
  id: string;
  title: string;
  content: string;        // Full text with {{variables}}
  folder_id?: string;     // Null = uncategorized
  workspace_id: string;
  tags: string[];         // e.g. ["work", "email"]
  variables: string[];    // Extracted {{varName}} patterns
  used_count: number;     // Times injected
  last_used_at?: string;  // ISO timestamp
  is_favorite: boolean;
  version: number;        // Increments on each save
  created_at: string;
  updated_at: string;
}
```

### `PromptVersion`
```typescript
interface PromptVersion {
  id: string;
  prompt_id: string;   // FK to Prompt
  content: string;     // Snapshot of content at this version
  version: number;     // Version number
  created_at: string;
}
```

### `AIToolName`
```typescript
type AIToolName = 'chatgpt' | 'claude' | 'gemini' | 'grok';
```

### `AI_TOOL_URLS`
```typescript
const AI_TOOL_URLS: Record<AIToolName, string> = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com',
};
```

### `AI_TOOL_COLORS`
```typescript
const AI_TOOL_COLORS: Record<AIToolName, string> = {
  chatgpt: '#10A37F',  // OpenAI green
  claude:  '#D4A574',  // Anthropic warm
  gemini:  '#4285F4',  // Google blue
  grok:    '#1D9BF0',  // X/Twitter blue
};
```

### `AIAccount`
```typescript
interface AIAccount {
  id: string;
  tool_name: AIToolName;      // 'chatgpt' | 'claude' | etc
  tool_url: string;           // Actual URL (may be custom)
  model_label?: string;       // e.g. "GPT-4", "Claude Opus"
  gmail?: string;             // Associated Gmail (optional)
  label?: string;             // Custom display name
  workspace_id: string;
  session_partition: string;  // Electron partition string
  is_active: boolean;
  created_at: string;
}
```

### `AppSettings`
```typescript
interface AppSettings {
  supabaseUrl?: string;
  supabaseKey?: string;
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  autoSyncInterval: number;   // Seconds
  theme: 'light';             // Only light mode
  hotkeys: {
    injectPanel: string;       // e.g. "Ctrl+Shift+P"
    captureSelection: string;
    switchAccount: string;
  };
}
```

---

## `src/types/electron.d.ts` — IPC & Local Types

### `Prompt` (Local — electron-store)
**Different from Supabase Prompt!** Simpler structure.
```typescript
interface Prompt {
  id: string;
  name: string;        // Display name
  content: string;     // Full text
  categoryId: string | null;
  createdAt: string;
}
```

### `PromptCategory`
```typescript
interface PromptCategory {
  id: string;
  name: string;
  color: string;  // Hex color
}
```

### `GmailSession`
```typescript
interface GmailSession {
  email: string;      // Actual Gmail address (primary key)
  label: string;      // Display name (default = email)
  partition: string;  // "persist:gmail-{uuid}"
  addedAt: string;    // ISO timestamp
  color?: string;     // Custom hex color (optional)
}
```

### `YouTubeAccount`
```typescript
interface YouTubeAccount {
  id: string;             // UUID (primary key)
  email: string;          // Google email
  label: string;          // Display name
  partition: string;      // "persist:yt-{uuid}"
  addedAt: string;
  lastActiveTab?: string; // "dashboard" | "content" | "analytics"
}
```

### `ElectronAPI`
Full interface of `window.electronAPI` — see `ipc-api.md` for method details.

---

## `src/types/browser.ts` — Browser Session Types

### `CustomTool`
```typescript
interface CustomTool {
  id: string;     // UUID
  name: string;   // Display name e.g. "ChatGPT"
  url: string;    // Full URL e.g. "https://chatgpt.com"
  addedAt: string;
}
```

### `BrowserTab`
```typescript
interface BrowserTab {
  id: string;           // UUID for this tab instance
  tool: CustomTool;     // Which AI tool
  gmail: GmailSession;  // Which Gmail account
}
```

### `getInjectTool(url: string): AIToolName | null`
URL se tool name detect karta hai (injection ke liye):
```typescript
// chatgpt.com → "chatgpt"
// claude.ai → "claude"
// gemini.google.com → "gemini"
// grok.com → "grok"
// anything else → null
```

### `getFaviconUrl(url: string): string`
Google favicon service se favicon URL banata hai:
```typescript
// "https://chatgpt.com" → "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32"
```

### `getTabColor(gmail: GmailSession)`
Gmail account ke liye color scheme return karta hai:
```typescript
{
  text: string;        // e.g. "rgba(79, 110, 247, 1)"
  bg: string;          // Active tab background
  border: string;      // Active tab border
  dot: string;         // Active indicator dot
  bgLight: string;     // Inactive tab background
  borderLight: string; // Inactive tab border
  textLight: string;   // Inactive tab text
}
```
- Color from `gmail.color` (custom) ya email hash se derived

---

## `src/types/pages.ts` — Navigation Types

### `Page`
```typescript
type Page = 
  | 'dashboard' 
  | 'browser'    // AIBrowser
  | 'prompts'    // PromptLibrary
  | 'accounts'   // Gmail Accounts
  | 'settings'   // Settings
  | 'youtube'    // YTStudio
  | 'workspace'; // Google Calendar/Tasks
```

Used in:
- `App.tsx` → current page state
- `LeftNav.tsx` → nav items
- `pageChanged(page)` IPC call

---

## Type Relationships

```
Workspace (Supabase)
    ├── Folder[] (Supabase, workspace_id FK)
    └── Prompt[] (Supabase, workspace_id FK)
            └── PromptVersion[] (Supabase, prompt_id FK)

AIAccount (Supabase)
    └── workspace_id → Workspace

GmailSession (electron-store)
    └── Referenced in AIBrowser BrowserTab

BrowserTab (in-memory)
    ├── tool: CustomTool (from electron-store)
    └── gmail: GmailSession (from electron-store)

YouTubeAccount (electron-store)
    └── partition → Electron session

Prompt (electron-store) — LOCAL ONLY
    └── categoryId → PromptCategory (electron-store)

AppSettings (electron-store)
    └── hotkeys → global shortcuts
```

---

## Important: Two Different `Prompt` Types

FlowDesk mein DO alag `Prompt` types hain:

| Property | Local Prompt (electron-store) | Supabase Prompt |
|----------|-------------------------------|-----------------|
| File | `electron.d.ts` | `database.ts` |
| `id` | UUID string | UUID string |
| `name` vs `title` | `name` | `title` |
| `categoryId` | string | `folder_id` |
| `tags` | ❌ not present | ✅ string[] |
| `variables` | ❌ not present | ✅ string[] |
| `used_count` | ❌ not present | ✅ number |
| `version` | ❌ not present | ✅ number |
| `is_favorite` | ❌ not present | ✅ boolean |

**Local prompts** are used in `PromptLibrary.tsx` (simple local storage).
**Supabase prompts** are used in `usePromptStore.ts` (cloud sync with full metadata).

The inject overlay (`PromptBar.tsx`) uses **local prompts** from `promptsList()` IPC.
