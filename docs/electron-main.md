# FlowDesk — Electron Main Process

> Source files: `electron/main.ts`, `electron/sessions.ts`, `electron/preload.ts`

---

## `electron/main.ts` — Entry Point & IPC

### App Initialization Sequence

```
1. app.whenReady()
    ↓
2. createWindow()
   - BrowserWindow (1200×780, min 900×600)
   - frame: false (custom title bar) or true
   - webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
    ↓
3. Load app
   - Dev: http://localhost:5173 (Vite dev server)
   - Prod: file:///path/to/out/renderer/index.html
    ↓
4. applySettings()
   - Launch on startup setting apply
   - Setup tray if minimizeToTray = true
   - Register global shortcuts
    ↓
5. Register all IPC handlers
```

### Window Configuration

```typescript
const win = new BrowserWindow({
  width: 1200,
  height: 780,
  minWidth: 900,
  minHeight: 600,
  frame: true,
  webPreferences: {
    preload: path.join(__dirname, '../preload/preload.mjs'),
    contextIsolation: true,
    nodeIntegration: false,
  },
});

// Remove application menu completely
Menu.setApplicationMenu(null);
```

### Tray Setup

```typescript
// On minimize/close (when minimizeToTray = true):
win.on('close', (event) => {
  if (settings.minimizeToTray) {
    event.preventDefault();
    win.hide();
  }
});

// Tray:
const tray = new Tray(iconPath);
tray.setContextMenu(Menu.buildFromTemplate([
  { label: 'Show FlowDesk', click: () => win.show() },
  { label: 'Quit', click: () => app.quit() }
]));
tray.on('double-click', () => win.show());
```

### Default Tools (pre-loaded in electron-store)

```typescript
const DEFAULT_TOOLS: CustomTool[] = [
  { id: 'default-chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', addedAt: '...' },
  { id: 'default-claude', name: 'Claude', url: 'https://claude.ai', addedAt: '...' },
  { id: 'default-gemini', name: 'Gemini', url: 'https://gemini.google.com', addedAt: '...' },
  { id: 'default-grok', name: 'Grok', url: 'https://grok.com', addedAt: '...' },
];
// Loaded on first run if tools list is empty
```

---

## Gmail IPC Handlers (in `main.ts`)

### `gmail:add` — Login + Auto-Detect Flow

```typescript
ipcMain.handle('gmail:add', async () => {
  const partition = `persist:gmail-${randomUUID()}`;
  
  // 1. Open login window
  const loginWin = new BrowserWindow({
    width: 500, height: 600,
    webPreferences: { partition },
    parent: mainWin,
    modal: true,
  });
  loginWin.loadURL('https://accounts.google.com/signin');
  
  // 2. Wait for window close
  await new Promise(resolve => loginWin.on('closed', resolve));
  
  // 3. Auto-detect email
  const email = await detectGmailEmail(partition);
  
  if (!email) {
    return { error: 'detect_failed', partition };
  }
  
  // 4. Check duplicate
  const sessions = store.get('gmail-sessions', []);
  if (sessions.find(s => s.email === email)) {
    return { error: 'duplicate' };
  }
  
  // 5. Save and return
  const session: GmailSession = { email, label: email, partition, addedAt: new Date().toISOString() };
  store.set('gmail-sessions', [...sessions, session]);
  return session;
});
```

### `detectGmailEmail(partition)` — Email Detection

```typescript
async function detectGmailEmail(partition: string): Promise<string | null> {
  // Create hidden window with same partition
  const detectWin = new BrowserWindow({
    show: false,
    webPreferences: { partition }
  });
  
  await detectWin.loadURL('https://accounts.google.com/');
  
  // Execute JS to find email
  const email = await detectWin.webContents.executeJavaScript(`
    document.querySelector('[data-email]')?.getAttribute('data-email') ||
    document.querySelector('.gb_A')?.textContent?.trim() ||
    null
  `);
  
  detectWin.destroy();
  return email;
}
```

---

## YouTube IPC Handlers

### `yt:detectChannelId(partition)` — Channel Detection

```typescript
ipcMain.handle('yt:detectChannelId', async (_, partition: string) => {
  const detectWin = new BrowserWindow({ 
    show: false,
    webPreferences: { partition }
  });
  
  await detectWin.loadURL('https://studio.youtube.com/');
  
  const channelId = await detectWin.webContents.executeJavaScript(`
    // Try to extract UC... channel ID from page
    window.ytconfig?.PAGE_CL || 
    document.querySelector('meta[property="og:url"]')?.content?.match(/UC[\\w-]+/)?.[0] ||
    null
  `);
  
  detectWin.destroy();
  return channelId;
});
```

---

## Provider Message Delivery (`injector.ts`)

### How injection works

Each AI tool has a different text input mechanism:

```typescript
const INJECTORS: Record<string, string> = {
  chatgpt: `
    const el = document.querySelector('#prompt-textarea');
    if (!el) throw new Error('no input');
    el.focus();
    document.execCommand('insertText', false, text);
  `,
  
  claude: `
    const el = document.querySelector('[contenteditable="true"]');
    if (!el) throw new Error('no input');
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, text);
  `,
  
  gemini: `
    const el = document.querySelector('rich-textarea .ql-editor');
    if (!el) throw new Error('no input');
    el.focus();
    document.execCommand('insertText', false, text);
  `,
  
  grok: `
    const el = document.querySelector('textarea[placeholder]');
    if (!el) throw new Error('no input');
    el.focus();
    document.execCommand('insertText', false, text);
  `,
};

async function injectPrompt(view: WebContentsView, text: string, tool: string): Promise<boolean> {
  const script = INJECTORS[tool];
  if (!script) return false;
  
  try {
    await view.webContents.executeJavaScript(
      `(async () => { const text = ${JSON.stringify(text)}; ${script} })()`
    );
    return true;
  } catch {
    return false;
  }
}
```

---

## `electron/sessions.ts` — WebContentsView Cache

### State

```typescript
const viewCache = new Map<string, WebContentsView>();
let activeTabId: string | null = null;
let mainWindow: BrowserWindow | null = null;
let NAV_WIDTH = 172;

const TOP_HEIGHT = {
  browser: 86,   // 44px tabs + 42px prompt bar
  youtube: 52,   // account bar only
  accounts: 0,   // custom bounds used
  workspace: 0,  // custom bounds used
};
```

### `showView(tabId, partition, url, pageType)`

```typescript
export async function showView(tabId: string, partition: string, url: string, pageType = 'browser') {
  // 1. Hide previous active view
  if (activeTabId && activeTabId !== tabId) {
    const prevView = viewCache.get(activeTabId);
    if (prevView) mainWindow.contentView.removeChildView(prevView);
  }
  
  // 2. Get or create view
  let view = viewCache.get(tabId);
  if (!view) {
    view = new WebContentsView({
      webPreferences: { partition, contextIsolation: true }
    });
    
    // Handle external links (open in system browser)
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    
    viewCache.set(tabId, view);
    view.webContents.loadURL(url);
  }
  
  // 3. Add to window
  mainWindow.contentView.addChildView(view);
  activeTabId = tabId;
  
  // 4. Calculate and set bounds
  updateBounds(view, pageType);
}
```

### Bounds Calculation

```typescript
function updateBounds(view: WebContentsView, pageType: string) {
  const { width, height } = mainWindow.getContentBounds();
  const topH = TOP_HEIGHT[pageType] || 86;
  
  view.setBounds({
    x: NAV_WIDTH,
    y: topH,
    width: width - NAV_WIDTH,
    height: height - topH,
  });
}

// On window resize:
mainWindow.on('resize', () => {
  const activeView = viewCache.get(activeTabId);
  if (activeView) updateBounds(activeView, currentPageType);
});
```

### `setCustomBounds(x, y, w, h)`

```typescript
export function setCustomBounds(x: number, y: number, w: number, h: number) {
  const activeView = viewCache.get(activeTabId);
  if (activeView) {
    activeView.setBounds({ x, y, width: w, height: h });
  }
}
```

Used by Accounts page (Gmail inbox) and Workspace page to set exact bounds for their embedded views.

### View Persistence

```
Tab switch flow:
┌──────────────────────────────────────────────────────┐
│ User clicks Tab 2                                    │
│   ↓                                                  │
│ switchView("tab2", partition, url)                   │
│   ↓                                                  │
│ Remove Tab 1 view from window (keep in cache)        │
│   ↓                                                  │
│ Add Tab 2 view to window                             │
│   ↓                                                  │
│ Tab 1 stays logged in (session preserved)            │
│ Tab 2 was never destroyed (no reload)                │
└──────────────────────────────────────────────────────┘
```

---

## `electron/preload.ts` — Context Bridge

```typescript
const electronAPI = {
  // Store
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  
  // Gmail
  gmailList: () => ipcRenderer.invoke('gmail:list'),
  gmailAdd: () => ipcRenderer.invoke('gmail:add'),
  // ... all other methods
  
  // Events (main → renderer)
  onInjectPanel: (cb) => ipcRenderer.on('inject-panel', cb),
  offInjectPanel: (cb) => ipcRenderer.removeListener('inject-panel', cb),
  onCaptureSelection: (cb) => ipcRenderer.on('capture-selection', cb),
  offCaptureSelection: (cb) => ipcRenderer.removeListener('capture-selection', cb),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

### Security Model
- `contextIsolation: true` — Renderer aur preload alag contexts
- `nodeIntegration: false` — Renderer mein Node.js APIs nahi
- `webviewTag: false` — `<webview>` tag disabled (WebContentsView use hota hai instead)
- Only whitelisted methods exposed via `contextBridge`

---

## Global Shortcuts

```typescript
// Registered in main.ts after window creation:
globalShortcut.register(settings.hotkeys.injectPanel, () => {
  mainWin.webContents.send('inject-panel');
});

globalShortcut.register(settings.hotkeys.captureSelection, () => {
  const text = getActiveViewSelection();
  mainWin.webContents.send('capture-selection', text);
});

// Unregistered on quit:
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyAllViews();
});
```

---

## App Lifecycle Events

```typescript
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS: re-create window when dock icon clicked
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyAllViews(); // sessions.ts
});
```

---

## electron-store Schema

```typescript
const store = new Store({
  defaults: {
    settings: {
      launchOnStartup: false,
      minimizeToTray: false,
      theme: 'system',
      hotkeys: {
        injectPanel: 'CommandOrControl+Shift+P',
        captureSelection: 'CommandOrControl+Shift+S',
        switchAccount: 'CommandOrControl+Tab',
      }
    },
    gmailSessions: [],
    ytAccounts: [],
    customTools: DEFAULT_TOOLS,
    prompts: [],
    promptCategories: [],
    workspaceEmail: null,
    activeWorkspaceId: null,
    workspaces: [],
    aiAccounts: [],
  }
});
```
