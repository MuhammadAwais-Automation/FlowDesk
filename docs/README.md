# FlowDesk Documentation

FlowDesk is a local-first Electron + React desktop app for AI creator workflows.

## Current Architecture

- Desktop shell: Electron
- Renderer: React + TypeScript
- State: Zustand
- Local persistence: electron-store through typed IPC
- Embedded apps: Electron WebContentsView
- Tests: Vitest

## Documentation Files

| File | Purpose |
|---|---|
| [architecture.md](./architecture.md) | Process layout, storage, and session model |
| [features.md](./features.md) | User-facing feature summary |
| [pages.md](./pages.md) | Page-level behavior |
| [components.md](./components.md) | Main component reference |
| [ipc-api.md](./ipc-api.md) | Renderer/main process IPC API |
| [stores.md](./stores.md) | Local-first Zustand stores |
| [types.md](./types.md) | Shared data types |
| [electron-main.md](./electron-main.md) | Main process notes |
| [ui-guide.md](./ui-guide.md) | UI design guidance |

## Local Data

FlowDesk does not require a hosted database. Workspace metadata, prompt metadata,
prompt versions, AI account profiles, settings, and tool lists are stored locally.
Browser login state is stored in isolated Electron session partitions.
