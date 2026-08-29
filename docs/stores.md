# State Stores

FlowDesk stores are local-first Zustand stores. They persist through
`window.electronAPI.storeGet()` and `storeSet()`, which write to `electron-store`
in the main process.

## `useWorkspaceStore`

Manages local creator workspaces.

- Creates a default `Personal` workspace when no workspaces exist.
- Persists `workspaces`.
- Persists the current `activeWorkspaceId`.
- Supports create, update, remove, and set active.

## `useAccountStore`

Manages local AI account profile metadata in `aiAccounts`.

This is separate from login/session storage. Actual browser login state is kept
inside Electron session partitions. The account store is for app metadata such
as tool name, label, model label, and workspace association.

## Tests

Workspace data helpers should be covered alongside their owning store.
