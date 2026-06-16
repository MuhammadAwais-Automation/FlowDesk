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

## `usePromptStore`

Manages workspace-aware prompt metadata.

- Persists folders in `folders`.
- Persists prompt rows in `workspacePrompts`.
- Persists prompt history in `promptVersions`.
- Extracts `{{variables}}` when prompts are created or edited.
- Saves a history entry only when prompt content changes.
- Tracks usage count and last-used timestamps locally.

## `useAccountStore`

Manages local AI account profile metadata in `aiAccounts`.

This is separate from login/session storage. Actual browser login state is kept
inside Electron session partitions. The account store is for app metadata such
as tool name, label, model label, and workspace association.

## `useSocialStore`

Tracks the active Social Hub platform. Platform browser state is managed by the
Electron main process.

## Tests

`src/store/localData.test.ts` covers the core local-first data helpers:

- default workspace creation
- prompt variable extraction
- prompt version history behavior
