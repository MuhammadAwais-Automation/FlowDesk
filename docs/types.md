# Types

Shared TypeScript types live in `src/types/`.

## `src/types/database.ts`

These are app data models. The name is historical; the current implementation
stores these records locally.

- `Workspace`
- `AIAccount`
- `AppSettings`

## `src/types/electron.d.ts`

Defines the renderer-facing `window.electronAPI` interface exposed through the
preload script.

Main groups:

- generic local store access
- embedded browser view controls
- Gmail session management
- YouTube account management
- custom AI tool management
- personal workspace management
- main-process events

## `src/types/browser.ts`

Defines AI Browser tabs, custom tools, account display helpers, tool detection,
and favicon/color helpers.

## `src/types/pages.ts`

Defines the app's page IDs used by the React router-like page switcher.
