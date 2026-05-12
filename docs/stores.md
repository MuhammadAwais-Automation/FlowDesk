# FlowDesk — Zustand Stores

> React state management. Source: `src/store/`
> All stores connect to Supabase (cloud) — NOT electron-store.

---

## `useWorkspaceStore` (`src/store/useWorkspaceStore.ts`)

### Purpose
Supabase `workspaces` table manage karo. Active workspace track karo.

### State Shape
```typescript
interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  loading: boolean;

  // Actions
  fetch: () => Promise<void>;
  create: (name: string, color: string) => Promise<void>;
  update: (id: string, patch: Partial<Workspace>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string) => void;
}
```

### Actions

#### `fetch()`
```typescript
// Loads all workspaces from Supabase
// Auto-selects first workspace if none active
const { data } = await supabase.from('workspaces').select('*').order('created_at');
set({ workspaces: data, loading: false });
if (!activeWorkspaceId && data.length > 0) set({ activeWorkspaceId: data[0].id });
```

#### `create(name, color)`
```typescript
const { data } = await supabase.from('workspaces').insert({ name, color }).select().single();
set(state => ({ workspaces: [...state.workspaces, data] }));
```

#### `remove(id)`
```typescript
await supabase.from('workspaces').delete().eq('id', id);
set(state => ({ workspaces: state.workspaces.filter(w => w.id !== id) }));
```

#### `setActive(id)`
```typescript
// Synchronous — just updates local state
set({ activeWorkspaceId: id });
// Other stores should re-fetch after this
```

### Usage in Components
```typescript
const { workspaces, activeWorkspaceId, setActive, fetch } = useWorkspaceStore();

// On mount:
useEffect(() => { fetch(); }, []);

// On workspace change:
useEffect(() => {
  if (activeWorkspaceId) promptStore.fetchPrompts(activeWorkspaceId);
}, [activeWorkspaceId]);
```

---

## `usePromptStore` (`src/store/usePromptStore.ts`)

### Purpose
Supabase `prompts` + `folders` + `prompt_versions` manage karo. Full prompt lifecycle.

### State Shape
```typescript
interface PromptStore {
  // Data
  folders: Folder[];
  prompts: Prompt[];
  
  // Selection
  selectedPromptId: string | null;
  selectedFolderId: string | null;
  
  // Filters
  searchQuery: string;
  sortBy: 'used' | 'recent' | 'az' | 'new';
  tagFilter: string | null;
  showFavoritesOnly: boolean;
  
  loading: boolean;

  // Actions (see below)
}
```

### Folder Actions

#### `fetchFolders(workspaceId: string)`
```typescript
const { data } = await supabase
  .from('folders')
  .select('*')
  .eq('workspace_id', workspaceId)
  .order('position');
set({ folders: data });
```

#### `createFolder(name, workspaceId, parentId?)`
```typescript
const { data } = await supabase
  .from('folders')
  .insert({ name, workspace_id: workspaceId, parent_id: parentId, position: folders.length })
  .select().single();
set(state => ({ folders: [...state.folders, data] }));
```

#### `renameFolder(id, name)`
```typescript
await supabase.from('folders').update({ name }).eq('id', id);
set(state => ({ folders: state.folders.map(f => f.id === id ? { ...f, name } : f) }));
```

#### `removeFolder(id)`
```typescript
await supabase.from('folders').delete().eq('id', id);
// Prompts in this folder become uncategorized (folder_id not auto-updated)
set(state => ({ folders: state.folders.filter(f => f.id !== id) }));
```

### Prompt Actions

#### `fetchPrompts(workspaceId: string)`
```typescript
const { data } = await supabase
  .from('prompts')
  .select('*')
  .eq('workspace_id', workspaceId)
  .order('updated_at', { ascending: false });
set({ prompts: data });
```

#### `createPrompt(data: Partial<Prompt>)`
```typescript
// Extract variables from content
const variables = extractVariables(data.content || '');

const { data: prompt } = await supabase
  .from('prompts')
  .insert({ ...data, variables, version: 1, used_count: 0 })
  .select().single();

set(state => ({ prompts: [prompt, ...state.prompts] }));
```

#### `updatePrompt(id, patch)`
```typescript
// 1. Save current version to history
const current = prompts.find(p => p.id === id);
if (patch.content && patch.content !== current.content) {
  await supabase.from('prompt_versions').insert({
    prompt_id: id,
    content: current.content,
    version: current.version
  });
}

// 2. Update prompt with incremented version
const newVersion = (current.version || 1) + 1;
const variables = extractVariables(patch.content || current.content);

await supabase.from('prompts').update({ 
  ...patch, variables, version: newVersion, updated_at: new Date().toISOString() 
}).eq('id', id);

set(state => ({
  prompts: state.prompts.map(p => p.id === id ? { ...p, ...patch, variables, version: newVersion } : p)
}));
```

#### `removePrompt(id)`
```typescript
await supabase.from('prompts').delete().eq('id', id);
set(state => ({
  prompts: state.prompts.filter(p => p.id !== id),
  selectedPromptId: state.selectedPromptId === id ? null : state.selectedPromptId
}));
```

#### `incrementUsed(id)`
```typescript
const prompt = prompts.find(p => p.id === id);
await supabase.from('prompts').update({
  used_count: (prompt.used_count || 0) + 1,
  last_used_at: new Date().toISOString()
}).eq('id', id);

set(state => ({
  prompts: state.prompts.map(p => p.id === id 
    ? { ...p, used_count: p.used_count + 1, last_used_at: new Date().toISOString() } 
    : p)
}));
```

#### `duplicatePrompt(id)`
```typescript
const original = prompts.find(p => p.id === id);
await createPrompt({
  ...original,
  title: `${original.title} (Copy)`,
  id: undefined,
  used_count: 0,
  version: 1
});
```

#### `getVersionHistory(promptId: string): Promise<PromptVersion[]>`
```typescript
const { data } = await supabase
  .from('prompt_versions')
  .select('*')
  .eq('prompt_id', promptId)
  .order('version', { ascending: false });
return data;
```

### Filter Actions
```typescript
setSelectedPrompt: (id: string | null) => set({ selectedPromptId: id })
setSelectedFolder: (id: string | null) => set({ selectedFolderId: id })
setSearchQuery: (q: string) => set({ searchQuery: q })
setSortBy: (sort: SortBy) => set({ sortBy: sort })
setTagFilter: (tag: string | null) => set({ tagFilter: tag })
setShowFavoritesOnly: (show: boolean) => set({ showFavoritesOnly: show })
```

### Computed (derived from state)
```typescript
// Filtered + sorted prompts list
const filteredPrompts = prompts
  .filter(p => selectedFolderId ? p.folder_id === selectedFolderId : true)
  .filter(p => showFavoritesOnly ? p.is_favorite : true)
  .filter(p => tagFilter ? p.tags.includes(tagFilter) : true)
  .filter(p => searchQuery 
    ? p.title.toLowerCase().includes(searchQuery.toLowerCase()) 
      || p.content.toLowerCase().includes(searchQuery.toLowerCase())
    : true
  )
  .sort((a, b) => {
    if (sortBy === 'used') return b.used_count - a.used_count;
    if (sortBy === 'az') return a.title.localeCompare(b.title);
    if (sortBy === 'new') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(); // 'recent'
  });
```

---

## `useAccountStore` (`src/store/useAccountStore.ts`)

### Purpose
Supabase `ai_accounts` table manage karo. ChatGPT, Claude, Gemini, Grok accounts.

### State Shape
```typescript
interface AccountStore {
  accounts: AIAccount[];
  activeTab: AIToolName;           // Current AI tool tab
  activeAccountId: string | null;
  loading: boolean;

  fetch: () => Promise<void>;
  create: (data: Partial<AIAccount>) => Promise<void>;
  update: (id: string, patch: Partial<AIAccount>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActiveTab: (tool: AIToolName) => void;
  setActiveAccount: (id: string) => void;
  getAccountsForTool: (tool: AIToolName) => AIAccount[];
}
```

### Actions

#### `fetch()`
```typescript
const { data } = await supabase
  .from('ai_accounts')
  .select('*')
  .order('created_at');
set({ accounts: data, loading: false });
```

#### `setActiveTab(tool)`
```typescript
// Switch tab + auto-select first account for that tool
const toolAccounts = accounts.filter(a => a.tool_name === tool);
set({ 
  activeTab: tool, 
  activeAccountId: toolAccounts[0]?.id || null 
});
```

#### `getAccountsForTool(tool)`
```typescript
return accounts.filter(a => a.tool_name === tool);
```

### Note
`useAccountStore` tracks Supabase AI accounts (ChatGPT, Claude accounts with model labels, Gmail associations). This is **different** from:
- `GmailSession` (electron-store) — Gmail login sessions
- `YouTubeAccount` (electron-store) — YouTube channels

---

## Store Initialization Pattern

```typescript
// In App.tsx or page component:
const { fetch: fetchWorkspaces } = useWorkspaceStore();
const { fetchPrompts } = usePromptStore();
const { fetch: fetchAccounts } = useAccountStore();
const { activeWorkspaceId } = useWorkspaceStore();

useEffect(() => {
  fetchWorkspaces();
  fetchAccounts();
}, []);

useEffect(() => {
  if (activeWorkspaceId) {
    fetchPrompts(activeWorkspaceId);
  }
}, [activeWorkspaceId]);
```

---

## electron-store vs Zustand

| | Zustand Stores | electron-store |
|--|----------------|----------------|
| **Location** | Renderer (React) | Main process (Electron) |
| **Data** | Supabase (cloud) | Local disk |
| **Access** | Direct import | Via IPC (`storeGet/Set`) |
| **What** | Prompts, Folders, Workspaces, AI Accounts | Gmail sessions, YT accounts, Custom tools, Settings, Local prompts |
| **Sync** | Real-time (Supabase) | On-demand (IPC calls) |
