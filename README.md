# FlowDesk

Local-first AI creator workstation built with Electron, React, and TypeScript.

FlowDesk helps creators manage AI tools, reusable prompts, social platforms, Gmail accounts, YouTube Studio, Calendar, and Tasks from one desktop app. The core workflow runs on the user's machine, so no hosted database or cloud account is required.

## Why FlowDesk

- Manage multiple AI tool sessions without constant login switching.
- Keep Gmail, YouTube, and AI tool accounts isolated in Electron session partitions.
- Save reusable prompt templates with `{{variables}}`.
- Inject prompts into supported AI tools from the AI Browser.
- Open social platforms, YouTube Studio, Gmail, Calendar, and Tasks in persistent native browser views.
- Store prompts, workspaces, account metadata, and settings locally with `electron-store`.

## Features

### AI Browser

- Open ChatGPT, Claude, Gemini, Grok, or custom AI tools.
- Pair AI tool tabs with isolated account sessions.
- Use back, forward, reload, clear-session, and prompt-injection controls.

### Prompt Library

- Create and organize reusable prompts locally.
- Use fillable `{{variable}}` placeholders.
- Search prompts and group them by category.
- Track prompt metadata, version history, and last-used state locally.

### Creator Workspaces

- Create local workspaces for personal projects, channels, clients, or brands.
- Keep workspace prompts, folders, versions, and AI account profiles organized.

### Accounts

- Add multiple Gmail accounts through isolated login windows.
- Rename accounts, set colors, and open Gmail inboxes inside the app.

### YouTube Studio

- Add multiple YouTube or Google accounts.
- Switch between isolated YouTube Studio sessions.
- Re-authenticate, rename, reload, remove, or open Studio externally.

### Social Hub

- Open Instagram, Facebook, X/Twitter, LinkedIn, TikTok, Threads, Reddit, YouTube, Telegram, Discord, WhatsApp, and more.
- Keep each platform in a persistent native `WebContentsView`.

### Personal Workspace

- Connect one personal Google account.
- Use Google Calendar and Google Tasks from an isolated local session.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Renderer | React 18, TypeScript |
| Bundler | electron-vite, Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Local storage | electron-store |
| Icons | Lucide React |
| Testing | Vitest |
| Packaging | electron-builder |

## Project Structure

```text
FlowDesk/
  electron/          Electron main and preload process
  src/               React renderer
    components/      Reusable UI components
    config/          Social platform definitions
    lib/             Utilities and local continuity logic
    pages/           Dashboard, browser, prompts, accounts, social, settings
    store/           Local-first Zustand stores
    types/           Shared TypeScript types
  docs/              Project documentation
  resources/         App icons
  flowdesk-promo/    Promo prototype assets
```

## Run Locally

```bash
npm install
npm run dev
```

## Test and Build

```bash
npm test
npm run typecheck
npm run build
```

## Package

```bash
npm run build:win
npm run build:mac
```

## Privacy Model

FlowDesk is local-first. Application data is stored locally through Electron storage, while account sessions stay isolated through Electron session partitions. No Supabase project, hosted database, or external backend is required for the core app.

## License

MIT
