# Components

## Layout

- `LeftNav`: main app navigation, collapse/resize behavior, page selection.

## AI Browser

- `ToolDock`: right-side tool/account launcher.
- `PromptBar`: prompt injection entry point.
- `NewSessionDialog`: choose an AI tool and Gmail account.
- `AccountContextMenu`: reload, clear session, remove tab actions.

## Prompt UI

- `PromptEditor`: modal editor for workspace prompt metadata.
- `PromptDetail`: prompt detail/actions for metadata flows.
- `PromptCard`: compact prompt display.
- `VariableFillModal`: fills variables and injects prompts.

The current `PromptLibrary` page also contains its own local editor UI for the
simple local prompt library.

## Social

- `AppDock`: icon dock for social platforms.

## Local Data Helpers

- `src/store/localData.ts`: pure helpers for default workspaces, prompt rows,
  version history, folders, and AI account rows.
