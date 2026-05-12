# FlowDesk — Components Reference

> Reusable UI components. Source: `src/components/`

---

## `src/components/layout/LeftNav.tsx`

### Purpose
App ka main sidebar navigation. Always visible, resizable.

### Props
```typescript
interface LeftNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}
```

### Features

#### Nav Items
```typescript
const NAV_ITEMS = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'browser', label: 'AI Browser', icon: Globe },
  { page: 'prompts', label: 'Prompts', icon: FileText },
  { page: 'accounts', label: 'Accounts', icon: Users },
  { page: 'youtube', label: 'YT Studio', icon: Youtube },
  { page: 'workspace', label: 'Workspace', icon: Calendar },
];
```

#### Resize Logic
```typescript
const MIN_WIDTH = 120;
const MAX_WIDTH = 280;
const DEFAULT_WIDTH = 172;

// Drag right edge to resize:
const handleDrag = (e: MouseEvent) => {
  const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
  setWidth(newWidth);
  localStorage.setItem('navWidth', String(newWidth));
  
  // Notify other components
  window.dispatchEvent(new CustomEvent('nav-resize', { detail: newWidth }));
  
  // Update native view bounds
  window.electronAPI.viewSetNavWidth(newWidth);
};
```

#### Collapse Logic
```typescript
const COLLAPSED_WIDTH = 48; // icon-only

// Toggle:
const toggle = () => {
  const collapsed = !isCollapsed;
  setIsCollapsed(collapsed);
  localStorage.setItem('navCollapsed', String(collapsed));
  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width;
  window.electronAPI.viewSetNavWidth(effectiveWidth);
};
```

### Visual States
```css
/* Active nav item */
.nav-item.active {
  border-left: 2px solid var(--accent);  /* #4F6EF7 */
  background: rgba(79, 110, 247, 0.08);
  color: var(--accent);
}

/* Hover */
.nav-item:hover {
  background: var(--surface-2);
}

/* Collapsed - icon only */
.nav-item.collapsed {
  justify-content: center;
  padding: 0;
}
```

### Logo
```
⚡ FlowDesk
↑ Zap icon (lucide-react) + "FlowDesk" text in Outfit font
```

---

## `src/components/browser/PromptBar.tsx`

### Purpose
AIBrowser ka bottom bar. Prompt injection + navigation controls.

### Props
```typescript
interface PromptBarProps {
  activeTab: BrowserTab | null;
  onHideView: () => void;
  onShowView: () => void;
}
```

### Layout
```
┌──────────────────────────────────────────────┐ ← 42px height
│  [💉 Inject Prompt]    [← → ↺]              │
└──────────────────────────────────────────────┘
```

### Inject Overlay (when open)

```
┌─────────────────────────────────────────┐
│                              [✕ Close]  │
│  🔍 [Search prompts...]                 │
│  ─────────────────────────────────────  │
│  Work                                   │
│    📝 Email Writer                       │
│    📝 Code Reviewer                      │
│  Personal                               │
│    📝 Quick Reply                        │
│  ─────────────────────────────────────  │
└─────────────────────────────────────────┘
```

Two-step flow:

**Step 1: Select Prompt**
- Categories with prompts listed under each
- Search filters across names
- Click prompt → go to Step 2 (if has variables) or inject directly

**Step 2: Fill Variables** (if prompt has `{{vars}}`)
```
┌─────────────────────────────────────────┐
│  ← Back                                 │
│  Fill variables for "Email Writer":     │
│                                         │
│  name: [_________________________]      │
│  topic: [________________________]      │
│                                         │
│  Preview:                               │
│  ┌─────────────────────────────────┐   │
│  │ Hello John! Today's topic is... │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Inject ↗]                            │
└─────────────────────────────────────────┘
```

### Injection Status
```typescript
type InjectStatus = 'idle' | 'injecting' | 'success' | 'error' | 'unsupported';

// 'unsupported': tool URL not recognized (non-AI tool)
// 'error': injection script failed
// 'success': auto-close after 1.5s
```

### IPC Calls Used
```typescript
window.electronAPI.hideView()                // Before opening overlay
window.electronAPI.switchView(...)           // After closing overlay
window.electronAPI.promptsList()             // Load prompts
window.electronAPI.promptsCategoriesList()  // Load categories
window.electronAPI.injectToTab(tabId, text, tool) // Inject
window.electronAPI.viewGoBack()             // ← button
window.electronAPI.viewGoForward()          // → button
window.electronAPI.viewReload()             // ↺ button
```

---

## `src/components/browser/AccountSwitcher.tsx`

### Purpose
Horizontal account pills for switching between accounts of same tool.

### Props
```typescript
interface AccountSwitcherProps {
  accounts: GmailSession[];
  activeEmail: string | null;
  onSwitch: (email: string) => void;
  onAdd: () => void;
}
```

### UI
```
[🟣 abc@gmail] [🔵 xyz@gmail] [+ Add]
```
- Active pill: filled background + dot
- Add pill: dashed border

---

## `src/components/prompt/PromptCard.tsx`

### Purpose
Compact prompt item for list views.

### Props
```typescript
interface PromptCardProps {
  prompt: Prompt;
  isSelected: boolean;
  onClick: () => void;
  onTagClick: (tag: string) => void;
}
```

### Layout
```
┌──────────────────────────────────────────┐
│ ★ Email Writer                          │  ← title + favorite star
│   Hello {{name}}, I wanted to follow... │  ← preview (120 chars)
│   ───────────────────────────────────── │
│   42× used  |  2 days ago  |  2 vars    │  ← stats
│   🏷 work  🏷 email                     │  ← tags (max 3)
└──────────────────────────────────────────┘
```

### Hover Effect
```css
.prompt-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
```

### Selected State
```css
.prompt-card.selected {
  border-color: var(--accent);
  background: rgba(79, 110, 247, 0.04);
}
```

---

## `src/components/prompt/PromptDetail.tsx`

### Purpose
Full prompt view with all metadata, actions, and editor.

### Props
```typescript
interface PromptDetailProps {
  prompt: Prompt;
  onClose?: () => void;
}
```

### Layout
```
┌──────────────────────────────────────────────────┐
│  Email Writer                                    │
│  [★ Fav] [📋 Copy] [⊞ Duplicate] [✏ Edit]      │
│  [🕐 History] [🗑 Delete]                        │
├──────────────────────────────────────────────────┤
│  42× used  |  2024-01-15  |  v3  |  2 variables  │
├──────────────────────────────────────────────────┤
│  🏷 work  🏷 email                               │
├──────────────────────────────────────────────────┤
│  Content:                                        │
│  ┌──────────────────────────────────────────┐   │
│  │ Hello {{name}},                          │   │
│  │ I wanted to follow up about {{topic}}.   │   │
│  │ ...                                      │   │
│  └──────────────────────────────────────────┘   │
├──────────────────────────────────────────────────┤
│  Variables:                                      │
│  [{{name}}]  [{{topic}}]     ← amber chips       │
│  Click to copy                                   │
├──────────────────────────────────────────────────┤
│  💡 Use AI Browser → Inject Prompt to fill       │
│     variables and send directly to AI            │
└──────────────────────────────────────────────────┘
```

### Actions
| Button | Action |
|--------|--------|
| ★ | Toggle `is_favorite` |
| Copy | Clipboard → full content |
| Duplicate | `usePromptStore.duplicatePrompt(id)` |
| Edit | Open PromptEditor modal |
| History | Open version history modal |
| Delete | Confirm dialog → `usePromptStore.removePrompt(id)` |

### Variable Chips
```typescript
// Amber styled chips
<span 
  className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-sm font-mono cursor-pointer"
  onClick={() => navigator.clipboard.writeText(varName)}
>
  {`{{${varName}}}`}
</span>
```

---

## `src/components/prompt/PromptEditor.tsx`

### Purpose
Modal for creating or editing prompts.

### Props
```typescript
interface PromptEditorProps {
  prompt?: Prompt;        // undefined = create new
  folderId?: string;      // Pre-selected folder
  onSave: (p: Prompt) => void;
  onClose: () => void;
}
```

### Layout
```
┌─────────────────────────────────────────────┐
│  ✕  Edit Prompt                             │
│  ─────────────────────────────────────────  │
│  Title: [______________________________]   │
│                                             │
│  Content:                                   │
│  ┌─────────────────────────────────────┐   │
│  │ Hello {{name}}!                     │   │
│  │ ...                                 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Folder: [Work ▼]                          │
│                                             │
│  Tags: [work, email]   (comma separated)   │
│                                             │
│  Variables detected:                        │
│  [{{name}}]  (amber chips, auto-updated)   │
│                                             │
│  [Cancel]          [Save]                  │
└─────────────────────────────────────────────┘
```

### Dirty State
```typescript
// Track if changes were made
const [isDirty, setIsDirty] = useState(false);

// Show unsaved warning on close:
const handleClose = () => {
  if (isDirty) {
    if (confirm('Discard changes?')) onClose();
  } else {
    onClose();
  }
};
```

---

## Common UI Patterns

### Toggle Switch
```tsx
<button
  role="switch"
  aria-checked={value}
  className={cn(
    "relative w-10 h-5 rounded-full transition-colors",
    value ? "bg-accent" : "bg-surface-3"
  )}
  onClick={() => onChange(!value)}
>
  <span className={cn(
    "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
    value && "translate-x-5"
  )} />
</button>
```

### Toast Notification
```typescript
type Toast = { msg: string; type: 'success' | 'error' };

// Show:
setToast({ msg: 'Account added!', type: 'success' });

// Auto-dismiss after 3s:
useEffect(() => {
  if (toast) {
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }
}, [toast]);
```

### Modal Backdrop
```tsx
<div 
  className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center"
  onClick={(e) => e.target === e.currentTarget && onClose()}
>
  <div className="bg-white rounded-2xl shadow-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
    {children}
  </div>
</div>
```

### Colored Avatar
```tsx
// Initials avatar with hash-derived color
function Avatar({ label, color }: { label: string; color?: string }) {
  const bg = color || hashColor(label);
  const initials = label.slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
      style={{ background: bg }}>
      {initials}
    </div>
  );
}
```

### Relative Time
```typescript
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}
```

---

## Utility Functions

### `src/lib/variables.ts`

```typescript
// Extract all {{varName}} from content
export function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

// Replace {{varName}} with values
export function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || `{{${key}}}`);
}
```

### `src/lib/utils.ts`

```typescript
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merge Tailwind classes safely
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### `src/lib/supabase.ts`

```typescript
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  }
  return client;
}
```
