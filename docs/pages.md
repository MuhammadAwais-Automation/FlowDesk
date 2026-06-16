# Pages

## Dashboard

Shows local workspace stats, prompt counts, AI account profile counts, recent
prompts, active accounts, and quick actions.

## AI Browser

Persistent multi-tab browser for AI tools and Gmail. The React page manages tab
UI while Electron owns the native browser view.

## Prompt Library

Local prompt editor with categories, search, variable highlighting, and save /
delete actions.

## Accounts

Gmail account manager. Adds accounts through an isolated Google login window,
stores account metadata locally, and can open Gmail inside the app.

## YouTube Studio

Multi-account YouTube Studio page. Each account uses a separate persistent
partition.

## Social Hub

Dock-based launcher for social platforms. Each platform opens in a native
`WebContentsView`.

## Workspace

Personal Google Calendar and Tasks page with one dedicated local account session.

## Settings

General app settings, global shortcuts, local workspaces, and about information.
