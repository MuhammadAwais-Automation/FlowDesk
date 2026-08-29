# FlowDesk Architecture

FlowDesk is a desktop app with two cooperating layers:

- Electron main process: owns native windows, embedded browser views, global shortcuts, app settings, local persistence, and account session partitions.
- React renderer process: owns UI, page routing, local state, and user interactions.

## Process Model

```text
React renderer
  -> window.electronAPI
  -> preload contextBridge
  -> Electron IPC handlers
  -> electron-store / WebContentsView / session partitions
```

The renderer never receives Node.js access directly. The preload script exposes a
small IPC API while `nodeIntegration` stays disabled and `contextIsolation` stays
enabled.

## Local Storage

FlowDesk is local-first. App data is persisted through `electron-store`.

Important keys:

- `settings`
- `workspaces`
- `activeWorkspaceId`
- `aiAccounts`
- `gmailSessions`
- `ytAccounts`
- `customTools`
- `workspaceEmail`


## Session Isolation

Embedded websites run inside native `WebContentsView` instances. Each account or
tool session uses a separate persistent Electron partition:

- Gmail sessions: `persist:gmail-<uuid>`
- YouTube sessions: `persist:yt-<uuid>`
- Personal workspace: `persist:workspace-personal`

This keeps cookies and storage separated between accounts.

## Renderer State

Zustand stores provide local UI-facing state:

- `useWorkspaceStore`: local workspaces and active workspace selection.
- `useAccountStore`: AI account profiles for workspace metadata.

## Embedded Browser Views

`electron/sessions.ts` manages AI Browser, Gmail, YouTube Studio, and Workspace
views. Views are cached and hidden instead of reloaded when switching tabs where possible.

## Build Outputs

```text
out/   compiled Electron and renderer output
dist/  packaged installers/apps
```
